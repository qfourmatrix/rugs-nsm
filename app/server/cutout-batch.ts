import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { type CutoutBatch, type CutoutBatchItem } from "../shared/cutout-batch";
import { createCutout, listCutouts, readCutoutRecords, type MainImageCutout } from "./main-image-cutouts";
import { atomicWriteJson, ensureDir } from "./fsUtils";
import { conflictError } from "./errors";

import { PHOTOROOM_PARALLEL_REQUESTS } from "./photoroom-limits";

type Operations = { list: typeof listCutouts; create: typeof createCutout; listRecords?: typeof readCutoutRecords };
/** One persisted batch per catalog. Workers survive tab closure; saved request IDs
 * prevent a process restart from silently resubmitting an ambiguous paid request. */
export class CutoutBatchQueue {
  private records: MainImageCutout[] | undefined;
  private batch: CutoutBatch | null = null;
  private loaded = false;
  private running = false;
  private serial: Promise<unknown> = Promise.resolve();
  private writes: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(private root: string, private apiKey: () => string | undefined, private operations: Operations = { list: listCutouts, create: createCutout, listRecords: readCutoutRecords }) {
    this.file = path.join(root, ".product-shot-queue", "cutout-batch.json");
  }
  private save() {
    if (!this.batch) return Promise.resolve();
    this.batch.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(this.batch);
    const write = this.writes.then(async () => { await ensureDir(path.dirname(this.file)); await atomicWriteJson(this.file, snapshot); });
    this.writes = write.catch(() => undefined);
    return write;
  }
  private async load() {
    if (this.loaded) return;
    try {
      this.batch = JSON.parse(await fs.readFile(this.file, "utf8"));
      // Reconcile with the durable cutout attempt before deciding whether to send.
      for (const item of this.batch!.items) if (item.status === "processing") item.status = "queued";
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.loaded = true;
  }
  private locked<T>(action: () => Promise<T>): Promise<T> {
    const next = this.serial.then(action); this.serial = next.catch(() => undefined); return next;
  }
  get() { return this.locked(async () => { await this.load(); this.launch(); await this.writes; return structuredClone(this.batch); }); }
  start(id: string, productIds: string[]) {
    return this.locked(async () => {
      await this.load();
      if (this.batch?.id === id) {
        if (JSON.stringify(this.batch.items.map(item => item.productId).sort()) !== JSON.stringify([...new Set(productIds)].sort())) throw conflictError("CUTOUT_BATCH_REQUEST_REUSED", "This batch request belongs to a different selection.");
        this.launch(); return structuredClone(this.batch);
      }
      if (this.running || this.batch?.items.some(item => item.status === "queued" || item.status === "processing")) {
        if (JSON.stringify(this.batch!.items.map(item => item.productId).sort()) === JSON.stringify([...new Set(productIds)].sort())) return structuredClone(this.batch!);
        throw conflictError("CUTOUT_BATCH_ACTIVE", "A background-removal batch is already saved. Finish or resume it before starting another selection.");
      }
      this.batch = { id, status: "running", items: [...new Set(productIds)].map(productId => ({ productId, requestId: randomUUID(), status: "queued" })), updatedAt: new Date().toISOString() };
      await this.save(); this.launch(); return structuredClone(this.batch);
    });
  }
  control(action: "pause" | "resume" | "retry") {
    return this.locked(async () => {
      await this.load(); if (!this.batch) throw new Error("No background-removal batch.");
      if (action === "retry" && this.running) throw conflictError("CUTOUT_BATCH_BUSY", "Wait for current requests to finish before retrying.");
      if (action === "retry") for (const item of this.batch.items) {
        if (item.status === "failed" || item.status === "attention") { item.status = "queued"; item.requestId = randomUUID(); item.error = undefined; item.retryAuthorized = true; }
      }
      this.batch.status = action === "pause" ? "paused" : "running";
      this.batch.error = undefined;
      await this.save(); this.launch(); return structuredClone(this.batch);
    });
  }
  private launch() {
    if (this.running || this.batch?.status !== "running") return;
    this.running = true;
    void this.run().catch(async error => {
      this.batch!.status = "paused"; this.batch!.error = error instanceof Error ? error.message : "Batch interrupted.";
      await this.save().catch(() => undefined);
    }).finally(() => { this.records = undefined; this.running = false; if (this.batch?.status === "running") this.launch(); });
  }
  private async process(item: CutoutBatchItem) {
    try {
      const saved = await this.operations.list(this.root, item.productId, this.records);
      const ready = saved.find(value => value.status === "ready" && value.approved) ?? saved.find(value => value.status === "ready");
      const existing = saved.find(value => value.id === item.requestId);
      // Historical failed attempts do not hold up other products. A fresh batch
      // parks them for the explicit Retry failed action; same-request recovery is safe.
      if (!ready && !existing && saved.some(value => value.status === "failed" || value.status === "processing") && !item.retryAuthorized) {
        item.status = "attention"; item.error = "Previous attempt needs an explicit retry."; return;
      }
      const cutout: MainImageCutout = ready ?? await this.operations.create(this.root, item.productId, item.requestId, this.apiKey());
      item.status = cutout.status === "processing" ? "attention" : cutout.status;
      item.error = cutout.status === "processing" ? "Interrupted attempt: check before retrying." : cutout.error ?? undefined;
      if (cutout.status === "ready") { item.cutoutId = cutout.id; item.sourceSha256 = cutout.sourceSha256; }
      if (cutout.error && /HTTP (401|402|403|429)/.test(cutout.error)) { this.batch!.status = "paused"; this.batch!.error = cutout.error; }
    } catch (error) { item.status = "failed"; item.error = error instanceof Error ? error.message : "Background removal failed."; }
  }
  private async run() {
    this.records = await this.operations.listRecords?.(this.root);
    const worker = async () => {
      while (this.batch?.status === "running") {
        const item = this.batch.items.find(value => value.status === "queued");
        if (!item) return;
        item.status = "processing"; await this.save();
        await this.process(item); await this.save();
      }
    };
    await Promise.all(Array.from({ length: PHOTOROOM_PARALLEL_REQUESTS }, worker));
    if (this.batch!.status === "running" && !this.batch!.items.some(item => item.status === "queued")) this.batch!.status = "complete";
    await this.save();
  }
}
