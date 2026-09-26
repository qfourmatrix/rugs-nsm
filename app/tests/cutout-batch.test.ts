import { expect, it } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CutoutBatchQueue } from "../server/cutout-batch";
import type { MainImageCutout } from "../server/main-image-cutouts";
import type { CutoutBatch } from "../shared/cutout-batch";
const record = (productId: string, id: string, status: MainImageCutout["status"] = "ready"): MainImageCutout => ({ id, productId, sourceSha256: "a".repeat(64), status, approved: false, createdAt: new Date().toISOString(), uncertainty: null, error: null, provider: "photoroom" });
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error("Batch did not settle");
}
it("queues the whole selection once, overlaps four requests, persists results, and isolates failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-batch-"));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0, active = 0, peak = 0;
  const queue = new CutoutBatchQueue(root, () => "test", {
    list: async () => [],
    create: async (_root, productId, id) => { calls++; active++; peak = Math.max(active, peak); await gate; active--; if (productId === "rug-1") throw new Error("Bad image"); return record(productId, id); }
  });
  try {
    const id = randomUUID(), products = Array.from({ length: 9 }, (_, i) => `rug-${i}`);
    await queue.start(id, products);
    await until(async () => active === 4);
    await queue.start(id, products); expect(calls).toBe(4);
    release(); await until(async () => (await queue.get())?.status === "complete");
    const completed = await queue.get();
    expect(peak).toBe(4); expect(calls).toBe(9);
    expect(completed?.items.filter(item => item.status === "ready")).toHaveLength(8);
    expect(completed?.items.filter(item => item.status === "failed")).toHaveLength(1);
    const persisted = JSON.parse(await readFile(path.join(root, ".product-shot-queue", "cutout-batch.json"), "utf8"));
    expect(persisted.items.filter((item: {status:string}) => item.status === "ready")).toHaveLength(8);
  } finally { release(); await rm(root, { recursive: true, force: true }); }
});
it("reuses saved successes, leaves historical failures for an explicit batch retry, then retries only failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-retry-"));
  const calls: string[] = [];
  const queue = new CutoutBatchQueue(root, () => "test", {
    list: async (_root, id) => [record(id, randomUUID(), id === "good" ? "ready" : "failed")],
    create: async (_root, id, request) => { calls.push(id); return record(id, request); }
  });
  try {
    await queue.start(randomUUID(), ["good", "bad"]);
    await until(async () => (await queue.get())?.status === "complete");
    expect(calls).toEqual([]);
    expect((await queue.get())?.items[1].status).toBe("attention");
    // Allow the run promise's finalizer to finish before explicit retry.
    await new Promise(resolve => setTimeout(resolve, 10));
    await queue.control("retry");
    await until(async () => (await queue.get())?.items[1].status === "ready");
    expect(calls).toEqual(["bad"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("recovers a persisted queue without repeating an ambiguous in-flight provider request", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-recover-"));
  const requestId = randomUUID();
  const saved: CutoutBatch = { id: randomUUID(), status: "running", updatedAt: new Date().toISOString(), items: [{ productId: "old", requestId, status: "processing" }, { productId: "new", requestId: randomUUID(), status: "queued" }] };
  let paid = 0;
  try {
    await mkdir(path.join(root, ".product-shot-queue"));
    await writeFile(path.join(root, ".product-shot-queue", "cutout-batch.json"), JSON.stringify(saved));
    const queue = new CutoutBatchQueue(root, () => "test", {
      list: async (_root, id) => id === "old" ? [record(id, requestId, "processing")] : [],
      create: async (_root, id, request) => { if (id === "old") return record(id, request, "processing"); paid++; return record(id, request); }
    });
    await queue.get(); await until(async () => (await queue.get())?.status === "complete");
    expect(paid).toBe(1); expect((await queue.get())?.items.map(item => item.status)).toEqual(["attention", "ready"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("pauses new submissions on exhausted credits, preserves queued work, and resumes after explicit action", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-credit-"));
  let funded = false, calls = 0;
  const queue = new CutoutBatchQueue(root, () => "test", {
    list: async () => [],
    create: async (_root, id, request) => { calls++; return funded ? record(id, request) : { ...record(id, request, "failed"), error: "Photoroom returned HTTP 402." }; }
  });
  try {
    await queue.start(randomUUID(), Array.from({length:12}, (_, i) => `rug-${i}`));
    await until(async () => { const batch = await queue.get(); return batch?.status === "paused" && batch.items.every(item => item.status !== "processing"); });
    expect(calls).toBeLessThanOrEqual(4);
    const failed = calls;
    expect((await queue.get())?.items.filter(item => item.status === "queued")).toHaveLength(12-failed);
    funded = true;
    await new Promise(resolve => setTimeout(resolve, 10));
    await queue.control("retry");
    await until(async () => (await queue.get())?.status === "complete");
    expect((await queue.get())?.items.every(item => item.status === "ready")).toBe(true);
    expect(calls).toBe(12+failed);
  } finally { await rm(root, { recursive:true, force:true }); }
});
