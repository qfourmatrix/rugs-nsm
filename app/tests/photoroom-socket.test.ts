import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { channel } from "node:diagnostics_channel";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { photoroomTransport, removeWithPhotoroom } from "../server/main-image-cutouts";
import { photoroomRateLimit } from "../server/photoroom-limits";
// Undici explicitly exports this clock for tests. Exercise the real socket/parser
// timers, rather than bypassing them with MockAgent's delayed-reply implementation.
const timers = createRequire(import.meta.url)("undici/lib/util/timers.js") as { tick: (ms: number) => void };
afterEach(() => vi.restoreAllMocks());
it.each(["headers", "body"])("waits beyond ten minutes for real HTTP %s, without retry or cancellation", async phase => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "transparent" } }).png().toBuffer();
  let response!: ServerResponse, calls = 0, notify!: () => void;
  const arrived = new Promise<void>(resolve => { notify = resolve; });
  const server = createServer((req, res) => {
    calls++; req.resume(); response = res;
    if (phase === "body") { res.writeHead(200, { "Content-Type": "image/png" }); res.write(bytes.subarray(0, 8)); }
    notify();
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  let headersNotify!: () => void;
  const headers = new Promise<void>(resolve => { headersNotify = resolve; });
  const diagnostics = channel("undici:request:headers");
  const onHeaders = (message: unknown) => { if (String((message as {request:{origin:unknown}}).request.origin) === origin) headersNotify(); };
  diagnostics.subscribe(onHeaders);
  const agent = photoroomTransport.createDispatcher(), dispatch = agent.dispatch.bind(agent);
  vi.spyOn(agent, "dispatch").mockImplementation((options, handler) => dispatch({ ...options, origin }, handler));
  vi.spyOn(photoroomTransport, "createDispatcher").mockReturnValue(agent);
  vi.spyOn(photoroomRateLimit, "acquire").mockResolvedValue();
  let settled = false;
  const result = removeWithPhotoroom(bytes, "test").then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  try {
    await arrived;
    if (phase === "body") await headers;
    timers.tick(1); timers.tick(600_001);
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false); expect(response.destroyed).toBe(false);
    response.end(phase === "body" ? bytes.subarray(8) : bytes);
    expect(await result).toMatchObject({ value: { image: bytes } });
    expect(calls).toBe(1);
  } finally {
    diagnostics.unsubscribe(onHeaders);
    server.closeAllConnections(); await agent.destroy(); await result;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
