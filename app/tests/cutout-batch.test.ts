import * as disk from "../server/fsUtils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CutoutBatchQueue } from "../server/cutout-batch";
import type { MainImageCutout } from "../server/main-image-cutouts";
import type { CutoutBatch } from "../shared/cutout-batch";
const record = (productId: string, id: string, status: MainImageCutout["status"] = "ready"): MainImageCutout => ({ id, productId, sourceSha256: "a".repeat(64), status, approved: false, createdAt: new Date().toISOString(), uncertainty: null, error: null, provider: "photoroom" });
// Disk-heavy installer tests need a laptop-sized budget. These deadlines belong
// only to Vitest; they never affect provider requests or the running app.
const batchTest = (name: string, run: () => Promise<void>) => it(name, run, 90_000);
const fixtures = new Map<string, CutoutBatchQueue>();
function makeQueue(...args: ConstructorParameters<typeof CutoutBatchQueue>) {
  const queue = new CutoutBatchQueue(...args); fixtures.set(args[0], queue); return queue;
}
async function until(check: () => Promise<boolean>) {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error("Batch did not settle within the test's 30-second wait budget");
}
async function idle(queue: CutoutBatchQueue) {
  await until(async () => !(queue as unknown as {running:boolean}).running);
  await queue.get(); // Drain the final persisted snapshot before retry or cleanup.
}
async function cleanup(root: string) {
  const queue = fixtures.get(root);
  if (queue) {
    if (await queue.get()) await queue.control("pause");
    await idle(queue);
    fixtures.delete(root);
  }
  await rm(root, { recursive: true, force: true });
}
// Optional fault-injection for installer QA, scoped to this test file only.
// Delays every real atomic write without removing fsync or correctness assertions.
const atomicWrite = disk.atomicWriteJson;
const delayedWrite: typeof atomicWrite = async (...args) => {
  const delay = Number(process.env.RUGS_TEST_CUTOUT_DISK_DELAY_MS ?? 0);
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  return atomicWrite(...args);
};
beforeEach(() => {
  if (Number(process.env.RUGS_TEST_CUTOUT_DISK_DELAY_MS ?? 0) > 0) {
    vi.spyOn(disk, "atomicWriteJson").mockImplementation(delayedWrite);
  }
});
afterEach(() => vi.restoreAllMocks());
batchTest("queues the whole selection once, overlaps sixty requests, persists results, and isolates failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-batch-"));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0, active = 0, peak = 0;
  const queue = makeQueue(root, () => "test", {
    list: async () => [],
    create: async (_root, productId, id) => { calls++; active++; peak = Math.max(active, peak); await gate; active--; if (productId === "rug-1") throw new Error("Bad image"); return record(productId, id); }
  });
  try {
    const id = randomUUID(), products = Array.from({ length: 65 }, (_, i) => `rug-${i}`);
    await queue.start(id, products);
    await until(async () => active === 60);
    await queue.start(id, products); expect(calls).toBe(60);
    release(); await until(async () => (await queue.get())?.status === "complete");
    const completed = await queue.get();
    expect(peak).toBe(60); expect(calls).toBe(65);
    expect(completed?.items.filter(item => item.status === "ready")).toHaveLength(64);
    expect(completed?.items.filter(item => item.status === "failed")).toHaveLength(1);
    const persisted = JSON.parse(await readFile(path.join(root, ".product-shot-queue", "cutout-batch.json"), "utf8"));
    expect(persisted.items.filter((item: {status:string}) => item.status === "ready")).toHaveLength(64);
  } finally { release(); await cleanup(root); }
});
batchTest("reuses saved successes, leaves historical failures for an explicit batch retry, then retries only failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-retry-"));
  const calls: string[] = [];
  const queue = makeQueue(root, () => "test", {
    list: async (_root, id) => [record(id, randomUUID(), id === "good" ? "ready" : "failed")],
    create: async (_root, id, request) => { calls.push(id); return record(id, request); }
  });
  try {
    await queue.start(randomUUID(), ["good", "bad"]);
    await until(async () => (await queue.get())?.status === "complete");
    expect(calls).toEqual([]);
    expect((await queue.get())?.items[1].status).toBe("attention");
    await idle(queue);
    await queue.control("retry");
    await until(async () => (await queue.get())?.items[1].status === "ready");
    expect(calls).toEqual(["bad"]);
  } finally { await cleanup(root); }
});
batchTest("recovers a persisted queue without repeating an ambiguous in-flight provider request", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-recover-"));
  const requestId = randomUUID();
  const saved: CutoutBatch = { id: randomUUID(), status: "running", updatedAt: new Date().toISOString(), items: [{ productId: "old", requestId, status: "processing" }, { productId: "new", requestId: randomUUID(), status: "queued" }] };
  let paid = 0;
  try {
    await mkdir(path.join(root, ".product-shot-queue"));
    await writeFile(path.join(root, ".product-shot-queue", "cutout-batch.json"), JSON.stringify(saved));
    const queue = makeQueue(root, () => "test", {
      list: async (_root, id) => id === "old" ? [record(id, requestId, "processing")] : [],
      create: async (_root, id, request) => { if (id === "old") return record(id, request, "processing"); paid++; return record(id, request); }
    });
    await queue.get(); await until(async () => (await queue.get())?.status === "complete");
    expect(paid).toBe(1); expect((await queue.get())?.items.map(item => item.status)).toEqual(["attention", "ready"]);
  } finally { await cleanup(root); }
});
batchTest("pauses new submissions on exhausted credits, preserves queued work, and resumes after explicit action", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-credit-"));
  let funded = false, calls = 0;
  const queue = makeQueue(root, () => "test", {
    list: async () => [],
    create: async (_root, id, request) => { calls++; return funded ? record(id, request) : { ...record(id, request, "failed"), error: "Photoroom returned HTTP 402." }; }
  });
  try {
    await queue.start(randomUUID(), Array.from({length:72}, (_, i) => `rug-${i}`));
    await until(async () => { const batch = await queue.get(); return batch?.status === "paused" && batch.items.every(item => item.status !== "processing"); });
    expect(calls).toBeLessThanOrEqual(60);
    const failed = calls;
    expect((await queue.get())?.items.filter(item => item.status === "queued")).toHaveLength(72-failed);
    funded = true;
    await idle(queue);
    await queue.control("retry");
    await until(async () => (await queue.get())?.status === "complete");
    expect((await queue.get())?.items.every(item => item.status === "ready")).toBe(true);
    expect(calls).toBe(72+failed);
  } finally { await cleanup(root); }
});

batchTest("does not submit work that finishes its local checks after the batch was paused", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-pause-"));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let checking = 0, calls = 0;
  const queue = makeQueue(root, () => "test", {
    list: async () => { checking++; await gate; return []; },
    create: async (_root, id, request) => { calls++; return record(id, request); }
  });
  try {
    await queue.start(randomUUID(), ["a", "b", "c"]);
    await until(async () => checking === 3);
    await queue.control("pause"); release();
    await until(async () => (await queue.get())!.items.every(item => item.status !== "processing"));
    expect(calls).toBe(0);
    expect((await queue.get())!.items.every(item => item.status === "queued")).toBe(true);
    await queue.control("resume");
    await until(async () => (await queue.get())!.status === "complete");
    expect(calls).toBe(3);
  } finally { release(); await cleanup(root); }
});

batchTest("keeps ownership of active requests after a sibling result fails to persist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-disk-"));
  let releaseA!: () => void, releaseB!: () => void;
  const a = new Promise<void>(resolve => { releaseA = resolve; });
  const b = new Promise<void>(resolve => { releaseB = resolve; });
  let calls = 0, failed = false;
  const write = delayedWrite;
  const spy = vi.spyOn(disk, "atomicWriteJson").mockImplementation(async (file, value, options) => {
    const batch = value as CutoutBatch;
    if (!failed && file === path.join(root, ".product-shot-queue", "cutout-batch.json") && batch.items?.[0].status === "ready" && batch.items?.[1].status === "processing") {
      failed = true; throw new Error("Disk write failed");
    }
    await write(file, value, options);
  });
  const queue = makeQueue(root, () => "test", {
    list: async () => [],
    create: async (_root, id, request) => { calls++; await (id === "a" ? a : b); return record(id, request); }
  });
  try {
    await queue.start(randomUUID(), ["a", "b"]);
    await until(async () => calls === 2); releaseA();
    await until(async () => (await queue.get())!.status === "paused");
    await expect(queue.control("retry")).rejects.toMatchObject({ code: "CUTOUT_BATCH_BUSY" });
    await expect(queue.start(randomUUID(), ["c"])).rejects.toMatchObject({ code: "CUTOUT_BATCH_ACTIVE" });
    releaseB();
    await until(async () => !(queue as unknown as {running:boolean}).running);
    expect((await queue.get())!.items.every(item => item.status === "ready")).toBe(true);
    await queue.control("resume");
    await until(async () => (await queue.get())!.status === "complete");
    expect(calls).toBe(2);
  } finally { releaseA(); releaseB(); await cleanup(root); spy.mockRestore(); }
});

batchTest("keeps an item queued when its pre-submission batch save fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-disk-before-"));
  let fail = true, calls = 0;
  const write = delayedWrite;
  const spy = vi.spyOn(disk, "atomicWriteJson").mockImplementation(async (file, value, options) => {
    if (fail && file === path.join(root, ".product-shot-queue", "cutout-batch.json") && (value as CutoutBatch).items?.some(item => item.status === "processing")) { fail = false; throw new Error("Disk unavailable"); }
    await write(file, value, options);
  });
  const queue = makeQueue(root, () => "test", {
    list: async () => [], create: async (_root, id, request) => { calls++; return record(id, request); }
  });
  try {
    await queue.start(randomUUID(), ["a"]);
    await until(async () => (await queue.get())!.status === "paused" && !(queue as unknown as {running:boolean}).running);
    expect(calls).toBe(0); expect((await queue.get())!.items[0].status).toBe("queued");
    await queue.control("resume");
    await until(async () => (await queue.get())!.status === "complete");
    expect(calls).toBe(1);
  } finally { await cleanup(root); spy.mockRestore(); }
});
