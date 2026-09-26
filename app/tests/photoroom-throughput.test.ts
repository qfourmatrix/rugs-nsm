import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgent } from "undici";
import sharp from "sharp";
import { PhotoroomRateLimit, photoroomRateLimit } from "../server/photoroom-limits";
import { photoroomTransport, removeWithPhotoroom } from "../server/main-image-cutouts";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("admits sixty immediately, then admits the next minute without waiting for responses", async () => {
  vi.useFakeTimers();
  const limiter = new PhotoroomRateLimit();
  const starts: number[] = [];
  const requests = Array.from({ length: 125 }, () => limiter.acquire().then(() => { starts.push(Date.now()); }));
  await vi.advanceTimersByTimeAsync(0);
  expect(starts).toHaveLength(60);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(starts).toHaveLength(60);
  await vi.advanceTimersByTimeAsync(1);
  expect(starts).toHaveLength(120);
  await vi.advanceTimersByTimeAsync(60_000);
  await Promise.all(requests);
  expect(starts).toHaveLength(125);
  for (const time of starts) expect(starts.filter(start => start > time - 60_000 && start <= time).length).toBeLessThanOrEqual(60);
});

it("uses a rolling window across callers rather than resetting at the minute boundary", async () => {
  vi.useFakeTimers();
  const limiter = new PhotoroomRateLimit();
  await Promise.all(Array.from({ length: 30 }, () => limiter.acquire()));
  await vi.advanceTimersByTimeAsync(30_000);
  await Promise.all(Array.from({ length: 30 }, () => limiter.acquire()));
  let admitted = 0;
  const next = Array.from({ length: 60 }, () => limiter.acquire().then(() => { admitted++; }));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(admitted).toBe(30);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(admitted).toBe(30);
  await vi.advanceTimersByTimeAsync(1);
  await Promise.all(next);
  expect(admitted).toBe(60);
});

it("accepts a ten-minute response without aborting or repeating the paid request", async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "transparent" } }).png().toBuffer();
  const mock = new MockAgent(); mock.disableNetConnect();
  mock.get("https://sdk.photoroom.com").intercept({ path: "/v1/segment", method: "POST" }).reply(200, bytes).delay(600_000);
  const agent = photoroomTransport.createDispatcher();
  const dispatch = vi.spyOn(agent, "dispatch").mockImplementation((options, handler) => mock.dispatch(options, handler));
  vi.spyOn(photoroomTransport, "createDispatcher").mockReturnValue(agent);
  vi.spyOn(photoroomRateLimit, "acquire").mockResolvedValue();
  vi.useFakeTimers();
  let settled = false;
  const result = removeWithPhotoroom(bytes, "test").then(value => { settled = true; return value; });
  try {
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(599_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).image).toEqual(bytes);
    expect(dispatch).toHaveBeenCalledTimes(1);
    mock.assertNoPendingInterceptors();
  } finally { vi.useRealTimers(); await mock.close(); }
});

it("keeps a real stalled TLS connection alive beyond Undici's old ten-second deadline", async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: "transparent" } }).png().toBuffer();
  const sockets = new Set<Socket>();
  const server = createServer(socket => { sockets.add(socket); socket.on("error", () => {}); }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const agent = photoroomTransport.createDispatcher();
  const dispatch = agent.dispatch.bind(agent);
  // Route the real production transport to a local socket; never contact Photoroom.
  vi.spyOn(agent, "dispatch").mockImplementation((options, handler) => dispatch({ ...options, origin: `https://127.0.0.1:${(server.address() as {port:number}).port}` }, handler));
  vi.spyOn(photoroomTransport, "createDispatcher").mockReturnValue(agent);
  vi.spyOn(photoroomRateLimit, "acquire").mockResolvedValue();
  let settled = false;
  const connected = once(server, "connection");
  const result = removeWithPhotoroom(bytes, "test").then(() => { settled = true; }, () => { settled = true; });
  try {
    await connected;
    await new Promise(resolve => setTimeout(resolve, 11_000));
    expect(settled).toBe(false);
  } finally {
    for (const socket of sockets) socket.destroy();
    await agent.destroy();
    await result;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 15_000);
