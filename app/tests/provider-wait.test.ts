import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { channel } from "node:diagnostics_channel";
import { createServer as createTcpServer, type Socket } from "node:net";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgent } from "undici";
import { buildLaoZhangRequest } from "../server/providers/laozhang";
import { generationTransport, requestLaoZhangImage } from "../server/providers/laozhang-transport";

const body = buildLaoZhangRequest({ prompt: "test", base64Image: "test", mimeType: "image/png", aspectRatio: "1:1", imageSize: "4K" });
const image = { candidates: [{ content: { parts: [{ inlineData: { data: "aW1hZ2U=", mimeType: "image/png" } }] } }] };
const input = { endpoint: "https://provider.test/generate", apiKey: "test-secret", body };
let mock: MockAgent | undefined;

it.each(["gzip", "deflate", "br"])("decodes a complete %s image response without another request", async encoding => {
  const bytes = Buffer.from(JSON.stringify(image));
  const compressed = encoding === "gzip" ? gzipSync(bytes) : encoding === "br" ? brotliCompressSync(bytes) : deflateSync(bytes);
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": encoding });
    res.end(compressed);
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await expect(requestLaoZhangImage({ ...input,
      endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/generate`
    })).resolves.toEqual({ data: "aW1hZ2U=", mimeType: "image/png" });
    expect(calls).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("keeps waiting past the old connection timeout during a stalled TLS handshake", async () => {
  const sockets = new Set<Socket>();
  const server = createTcpServer(socket => { sockets.add(socket); socket.on("error", () => {}); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const controller = new AbortController();
  let settled = false;
  const connected = once(server, "connection");
  const result = requestLaoZhangImage({ ...input, endpoint: `https://127.0.0.1:${address.port}/generate`, signal: controller.signal })
    .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  try {
    await connected;
    await new Promise(resolve => setTimeout(resolve, 11_000));
    expect(settled).toBe(false);
    controller.abort();
    expect(await result).toMatchObject({ error: { name: "AbortError" } });
  } finally {
    controller.abort();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 15_000);

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await mock?.close();
  mock = undefined;
});

function provider() {
  mock = new MockAgent();
  mock.disableNetConnect();
  const dispatcher = generationTransport.createDispatcher();
  vi.spyOn(dispatcher, "dispatch").mockImplementation((options, handler) => mock!.dispatch(options, handler));
  vi.spyOn(generationTransport, "createDispatcher").mockReturnValue(dispatcher);
  return mock.get("https://provider.test").intercept({ path: "/generate", method: "POST" });
}

it("receives a late image without resubmitting or imposing a response deadline", async () => {
  vi.useFakeTimers();
  provider().reply(200, image).delay(600_000);
  const dispatch = vi.spyOn(mock!, "dispatch");
  const signal = new AbortController().signal;
  let settled = false;
  const result = requestLaoZhangImage({ ...input, signal }).then(value => { settled = true; return value; });
  await vi.advanceTimersByTimeAsync(599_999);
  expect(settled).toBe(false);
  expect(signal.aborted).toBe(false);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0][0]).toMatchObject({ headersTimeout: 0, bodyTimeout: 0, idempotent: false });
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ data: "aW1hZ2U=", mimeType: "image/png" });
  mock!.assertNoPendingInterceptors();
});

it("still honors manual cancellation before response headers", async () => {
  vi.useFakeTimers();
  provider().reply(200, image).delay(600_000);
  const controller = new AbortController();
  const result = expect(requestLaoZhangImage({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(180_001);
  controller.abort();
  await result;
});

it.each([401, 429, 503])("does not retry provider HTTP %i errors", async status => {
  provider().reply(status, { error: "upstream error test-secret" });
  const dispatch = vi.spyOn(mock!, "dispatch");
  await expect(requestLaoZhangImage(input)).rejects.toMatchObject({
    code: status === 401 ? "AUTH_ERROR" : status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR",
    message: `Provider returned HTTP ${status}.`
  });
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it.each([429, 503])("rejects HTTP %i on headers even if the error body never finishes", async status => {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    res.writeHead(status, { "Content-Type": "application/json" });
    res.write('{"error":"unfinished');
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const controller = new AbortController();
  try {
    const result = requestLaoZhangImage({ ...input,
      endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/generate`,
      signal: controller.signal
    }).then(value => ({ value }), error => ({ error }));
    // A test watchdog only: production must resolve from the HTTP status, not a timer.
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([result, new Promise(resolve => {
        watchdog = setTimeout(() => resolve({ stalled: true }), 1000);
      })]);
      expect(outcome).toMatchObject({ error: { code: status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR" } });
      expect(calls).toBe(1);
    } finally { clearTimeout(watchdog); }
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("keeps eleven real HTTP calls alive when one of twelve is cancelled", async () => {
  const responses: ServerResponse[] = [];
  let allArrived!: () => void;
  const arrived = new Promise<void>(resolve => { allArrived = resolve; });
  const server = createServer((req, res) => {
    req.resume();
    responses[Number(req.url!.slice(1))] = res;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"candidates":');
    if (responses.filter(Boolean).length === 12) allArrived();
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const controllers = Array.from({ length: 12 }, () => new AbortController());
  const results = controllers.map((controller, index) => requestLaoZhangImage({ ...input,
    endpoint: `${origin}/${index}`, signal: controller.signal
  }).then(value => ({ value }), error => ({ error })));
  try {
    await arrived;
    controllers[0].abort();
    expect(await results[0]).toMatchObject({ error: { name: "AbortError" } });
    for (const response of responses.slice(1)) {
      expect(response.destroyed).toBe(false);
      response.end(JSON.stringify(image.candidates) + "}");
    }
    for (const result of await Promise.all(results.slice(1))) {
      expect(result).toMatchObject({ value: { data: "aW1hZ2U=", mimeType: "image/png" } });
    }
    expect(responses).toHaveLength(12);
  } finally {
    controllers.forEach(controller => controller.abort());
    server.closeAllConnections();
    await Promise.all(results);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("reports an uncertain connection loss without retrying a paid request", async () => {
  provider().replyWithError(new Error("socket lost"));
  const dispatch = vi.spyOn(mock!, "dispatch");
  await expect(requestLaoZhangImage(input)).rejects.toMatchObject({ code: "PROVIDER_OUTCOME_UNKNOWN" });
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("distinguishes complete invalid JSON from an interrupted response", async () => {
  provider().reply(200, "not json");
  await expect(requestLaoZhangImage(input)).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_RESPONSE" });
});

it.each(["cancel", "disconnect", "complete"])("handles %s after real response headers arrive", async action => {
  let response!: ServerResponse;
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    response = res;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"candidates":');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const headersChannel = channel("undici:request:headers");
  let headersReceived!: () => void;
  const headersReady = new Promise<void>(resolve => { headersReceived = resolve; });
  const onHeaders = (message: unknown) => {
    if (String((message as { request: { origin: unknown } }).request.origin) === origin) headersReceived();
  };
  headersChannel.subscribe(onHeaders);
  const controller = new AbortController();
  // Attach the rejection handler immediately, including during body download.
  const result = requestLaoZhangImage({ ...input, endpoint: `${origin}/generate`, signal: controller.signal })
    .then(value => ({ value }), error => ({ error }));
  try {
    await headersReady;
    if (action === "cancel") controller.abort();
    else if (action === "disconnect") response.destroy();
    else response.end(JSON.stringify(image.candidates) + "}");
    expect(await result).toMatchObject(action === "complete"
      ? { value: { data: "aW1hZ2U=", mimeType: "image/png" } }
      : { error: action === "cancel" ? { name: "AbortError" } : { code: "PROVIDER_OUTCOME_UNKNOWN" } });
    expect(calls).toBe(1);
  } finally {
    headersChannel.unsubscribe(onHeaders);
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
