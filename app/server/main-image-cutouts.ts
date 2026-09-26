import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Agent, FormData as ProviderFormData, fetch as providerFetch } from "undici";
import sharp from "sharp";
import { z } from "zod";
import { scanProducts } from "./scanner";
import { atomicWriteJson, ensureDir, regularFileExists, safeChildPath, sha256File } from "./fsUtils";
import { conflictError, notFoundError, validationError } from "./errors";
import { WorkScheduler } from "./work-scheduler";

import { PHOTOROOM_PARALLEL_REQUESTS, photoroomRateLimit } from "./photoroom-limits";

export const CutoutRequestSchema = z.object({ productId: z.string().min(1).max(240), requestId: z.string().uuid() }).strict();
export const CutoutApprovalSchema = z.object({ approved: z.boolean() }).strict();
export interface MainImageCutout {
  id: string; productId: string; sourceSha256: string; outputSha256?: string;
  status: "processing" | "ready" | "failed"; approved: boolean; createdAt: string;
  uncertainty: number | null; error: string | null; provider: "photoroom";
}
const scheduler = new WorkScheduler(PHOTOROOM_PARALLEL_REQUESTS, 5000);
// Bound CPU-heavy normalization independently from network concurrency.
const preparation = new WorkScheduler(2, 5000);
const productPending = new Map<string, Promise<MainImageCutout>>();
const pending = new Map<string, Promise<MainImageCutout>>();
const directory = (root: string) => path.join(root, ".product-shot-queue", "main-image-cutouts");
const recordPath = (root: string, id: string) => safeChildPath(directory(root), `${z.string().uuid().parse(id)}.json`);
const imagePath = (root: string, id: string) => safeChildPath(directory(root), `${z.string().uuid().parse(id)}.png`);

async function sourceImage(root: string, productId: string) {
  const product = (await scanProducts({ productRoot: root, productId })).products.find(product => product.id === productId);
  if (!product?.baseImage) throw notFoundError("MAIN_IMAGE_NOT_FOUND", "Main image not found.");
  const file = safeChildPath(path.join(root, product.id), product.baseImage);
  if (!(await regularFileExists(file))) throw validationError("INVALID_MAIN_IMAGE", "Main image is not a regular file.");
  const source = await fs.readFile(file);
  return { source, hash: createHash("sha256").update(source).digest("hex") };
}
export async function getCutout(root: string, id: string): Promise<MainImageCutout> {
  try { return JSON.parse(await fs.readFile(recordPath(root, id), "utf8")); }
  catch { throw notFoundError("CUTOUT_NOT_FOUND", "Saved cutout not found."); }
}
export async function readCutoutRecords(root: string) {
  await ensureDir(directory(root));
  const files = (await fs.readdir(directory(root))).filter(file => file.endsWith(".json"));
  const records: MainImageCutout[] = [];
  for (let index = 0; index < files.length; index += 8) {
    await Promise.all(files.slice(index, index + 8).map(async file => {
      try { records.push(await getCutout(root, file.slice(0, -5))); } catch { /* Ignore unrelated corrupt historical records. */ }
    }));
  }
  return records;
}
export async function listCutouts(root: string, productId: string, records?: readonly MainImageCutout[]) {
  const { hash } = await sourceImage(root, productId);
  return (records ?? await readCutoutRecords(root)).filter(record => record.productId === productId && record.sourceSha256 === hash)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function resolveCutout(root: string, productId: string, id: string, sourceHash: string, requireApproved: boolean) {
  const record = await getCutout(root, id);
  if (record.productId !== productId || record.sourceSha256 !== sourceHash) throw conflictError("CUTOUT_SOURCE_CHANGED", "This cutout belongs to a different main image. Remove the background again and review it.");
  if (record.status !== "ready" || (requireApproved && !record.approved)) throw conflictError("CUTOUT_REVIEW_REQUIRED", "Preview and approve this cutout before export.");
  const file = imagePath(root, id);
  if (!(await regularFileExists(file)) || await sha256File(file) !== record.outputSha256) throw conflictError("CUTOUT_CHANGED", "Saved cutout changed. Create and review a new cutout.");
  return { file, record };
}
export async function approveCutout(root: string, id: string, approved: boolean) {
  const record = await getCutout(root, id);
  const { hash } = await sourceImage(root, record.productId);
  await resolveCutout(root, record.productId, id, hash, false);
  const next = { ...record, approved };
  await atomicWriteJson(recordPath(root, id), next);
  return next;
}

// One explicit attempt per request ID, including across refresh/restart. Never
// resubmit ambiguous requests or failures automatically: the provider may charge.
export function createCutout(root: string, productId: string, requestId: string, apiKey: string | undefined, send = removeWithPhotoroom) {
  const key = `${root}:${requestId}`;
  const existing = pending.get(key);
  if (existing) return existing.then(record => {
    if (record.productId !== productId) throw conflictError("CUTOUT_REQUEST_REUSED", "Request belongs to a different rug.");
    return record;
  });
  const productKey = `${root}:${productId}`;
  const productAttempt = productPending.get(productKey);
  if (productAttempt) return Promise.reject(conflictError("CUTOUT_ALREADY_RUNNING", "This image already has a background-removal request in progress."));
  const promise = scheduler.run(async () => {
    await ensureDir(directory(root));
    try {
      const previous = JSON.parse(await fs.readFile(recordPath(root, requestId), "utf8")) as MainImageCutout;
      if (previous.productId !== productId) throw conflictError("CUTOUT_REQUEST_REUSED", "Request belongs to a different rug.");
      return previous;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!apiKey) throw validationError("PHOTOROOM_KEY_REQUIRED", "Set PHOTOROOM_API_KEY in app/.env.local and restart Studio to enable background removal.");
    const { source, hash } = await sourceImage(root, productId);
    let record: MainImageCutout = { id: requestId, productId, sourceSha256: hash, status: "processing", approved: false, createdAt: new Date().toISOString(), uncertainty: null, error: null, provider: "photoroom" };
    await atomicWriteJson(recordPath(root, requestId), record);
    try {
      const result = await send(source, apiKey);
      const metadata = await sharp(result.image).metadata();
      if (!metadata.hasAlpha) throw new Error("Provider returned an image without transparency. Review failed; nothing was approved.");
      await fs.writeFile(imagePath(root, requestId), result.image, { flag: "wx" });
      record = { ...record, status: "ready", uncertainty: result.uncertainty, outputSha256: createHash("sha256").update(result.image).digest("hex") };
    } catch (error) {
      record = { ...record, status: "failed", error: error instanceof Error ? error.message : "Background removal failed. No automatic retry was made." };
    }
    await atomicWriteJson(recordPath(root, requestId), record);
    return record;
  });
  pending.set(key, promise);
  productPending.set(productKey, promise);
  void promise.finally(() => { pending.delete(key); productPending.delete(productKey); }).catch(() => undefined);
  return promise;
}

export const photoroomTransport = {
  createDispatcher: () => new Agent({ connectTimeout: 0, headersTimeout: 0, bodyTimeout: 0 })
};
export async function removeWithPhotoroom(source: Buffer, apiKey: string) {
  const form = new ProviderFormData();
  // Normalize EXIF orientation once so downstream coordinates are consistent.
  const image = await preparation.run(() => sharp(source).autoOrient().png().toBuffer());
  if (image.length > 50 * 1024 * 1024) throw new Error("Main image exceeds Photoroom's 50 MB upload limit.");
  form.set("image_file", new Blob([new Uint8Array(image)], { type: "image/png" }), "main.png");
  form.set("format", "png"); form.set("size", "full"); form.set("crop", "false");
  const agent = photoroomTransport.createDispatcher();
  try {
    // Use the full documented rolling-minute allowance; no per-image delay
    // and no connection, header, body, or overall response deadline.
    await photoroomRateLimit.acquire();
    const response = await providerFetch("https://sdk.photoroom.com/v1/segment", { method: "POST", headers: { "x-api-key": apiKey }, body: form, dispatcher: agent, redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Photoroom returned HTTP ${response.status}. Check your API key and credit balance. No automatic retry was made.`);
    }
    const raw = response.headers.get("x-uncertainty-score");
    const score = raw === null ? NaN : Number(raw);
    return { image: Buffer.from(await response.arrayBuffer()), uncertainty: Number.isFinite(score) && score >= 0 && score <= 1 ? score : null };
  } finally { await agent.destroy(); }
}
