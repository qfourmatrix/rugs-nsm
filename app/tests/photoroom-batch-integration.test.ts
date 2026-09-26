import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { CutoutBatchQueue } from "../server/cutout-batch";
import { photoroomTransport } from "../server/main-image-cutouts";
import { photoroomRateLimit } from "../server/photoroom-limits";

async function until(check: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 1000; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error("Integration condition did not settle");
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("runs a real 65-image batch through HTTP, pauses only unsent work, resumes and recovers without duplicate submissions", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "photoroom-batch-http-"));
  const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: "transparent" } }).png().toBuffer();
  const products = Array.from({length:65}, (_, i) => `rug-${i}`);
  for (const id of products) { await fs.mkdir(path.join(root, id)); await fs.writeFile(path.join(root, id, "base.png"), image); }
  const responses: ServerResponse[] = [];
  const server = createServer((req, res) => {
    req.resume();
    // Consume the real streamed multipart upload before responding.
    req.on("end", () => { responses.push(res); });
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const factory = photoroomTransport.createDispatcher;
  const agents: ReturnType<typeof factory>[] = [];
  vi.spyOn(photoroomTransport, "createDispatcher").mockImplementation(() => {
    const agent = factory(), dispatch = agent.dispatch.bind(agent); agents.push(agent);
    vi.spyOn(agent, "dispatch").mockImplementation((options, handler) => dispatch({ ...options, origin }, handler));
    return agent;
  });
  const temporary: string[] = [];
  const mkdtemp = fs.mkdtemp.bind(fs);
  vi.spyOn(fs, "mkdtemp").mockImplementation((async (prefix: string) => {
    const folder = await mkdtemp(prefix); if (prefix.includes("studio-cutout-")) temporary.push(folder); return folder;
  }) as typeof fs.mkdtemp);
  const admission = vi.spyOn(photoroomRateLimit, "acquire");
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = Date.now();
  const queue = new CutoutBatchQueue(root, () => "local-test");
  const batchId = randomUUID();
  try {
    await queue.start(batchId, products);
    await until(() => responses.length === 60);
    expect((await queue.get())!.items.filter(item => item.status === "processing")).toHaveLength(60);
    responses.slice(0, 10).forEach(response => response.end(image));
    await until(() => admission.mock.calls.length === 65);
    expect(responses).toHaveLength(60);
    const recordsPath = path.join(root, ".product-shot-queue", "main-image-cutouts");
    expect((await fs.readdir(recordsPath)).filter(file => file.endsWith(".json"))).toHaveLength(60);
    await queue.control("pause");
    await until(async () => (await queue.get())!.items.filter(item => item.status === "queued").length === 5);
    expect(responses).toHaveLength(60);
    responses.slice(10).forEach(response => { expect(response.destroyed).toBe(false); response.end(image); });
    await until(async () => (await queue.get())!.items.every(item => item.status !== "processing"));
    expect((await queue.get())!.status).toBe("paused");
    vi.setSystemTime(start + 60_001);
    await queue.control("resume");
    await until(() => responses.length === 65);
    responses.slice(60).forEach(response => response.end(image));
    await until(async () => (await queue.get())!.status === "complete");
    const completed = await queue.get();
    expect(completed!.items.every(item => item.status === "ready")).toBe(true);
    expect(new Set(completed!.items.map(item => item.cutoutId)).size).toBe(65);
    const recovered = new CutoutBatchQueue(root, () => "local-test");
    expect(await recovered.get()).toEqual(completed);
    await recovered.start(batchId, products);
    expect(responses).toHaveLength(65);
    expect(await fs.readFile(path.join(root, products[0], "base.png"))).toEqual(image);
    for (const folder of temporary) await expect(fs.access(folder)).rejects.toMatchObject({code:"ENOENT"});
  } finally {
    await queue.control("pause").catch(() => {});
    server.closeAllConnections();
    await Promise.all(agents.map(agent => agent.destroy()));
    await until(async () => (await queue.get())!.items.every(item => item.status !== "processing")).catch(() => {});
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
