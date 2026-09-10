import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AssetRecord, BulkAcceptResult, GallerySelection } from "../shared/types";
import { acceptAsset, getAssetRecord, generatedDir, rejectAsset } from "./asset-store";
import { conflictError, validationError } from "./errors";
import { atomicWriteJson, pathExists, readJsonFile, regularFileExists, safeChildPath, sha256File, SUPPORTED_IMAGE_EXTENSIONS } from "./fsUtils";

export const GALLERY_SELECTION_FILENAME = "gallery-selection.json";
export const UTILITY_SHOT_IDS = new Set(["refine_base", "shape_runner_base", "shape_round_base"]);
const fields = {
  productId: z.string().min(1), assetIds: z.array(z.string().min(1)).max(100),
  initializedAt: z.string().datetime(), updatedAt: z.string().datetime()
};
const GalleryV1Schema = z.object({ version: z.literal(1), ...fields }).strict();
const GalleryV2Schema = z.object({
  version: z.literal(2), ...fields, revision: z.number().int().nonnegative(),
  exportReady: z.boolean(), readyAt: z.string().datetime().nullable(),
  reviewedContent: z.object({ fingerprint: z.string(), files: z.array(z.object({
    path: z.string(), size: z.number(), mtimeMs: z.number(), ctimeMs: z.number(), sha256: z.string()
  }).strict()) }).strict().nullable()
}).strict();
const mutationTails = new Map<string, Promise<void>>();
type ProductArgs = { productRoot: string; productId: string };

function productDir(productRoot: string, productId: string) {
  if (!productId || productId.includes("/") || productId.includes("\\") || productId.includes("..")) throw validationError("INVALID_PRODUCT_ID", "Invalid product id.");
  return path.join(productRoot, productId);
}
function selectionPath(productRoot: string, productId: string) {
  return safeChildPath(productDir(productRoot, productId), GALLERY_SELECTION_FILENAME);
}
function identityPath(args: ProductArgs, relativePath: string) {
  const dir = productDir(args.productRoot, args.productId);
  if (relativePath.startsWith("generated/")) return safeChildPath(path.join(dir, "generated"), relativePath.slice(10));
  return safeChildPath(dir, relativePath);
}
export function isGalleryEligibleAsset(asset: AssetRecord) {
  return asset.status === "accepted" && Boolean(asset.output?.file) && !UTILITY_SHOT_IDS.has(asset.shotId) && !asset.inputs.shapeVariant;
}
function isFinishedGalleryAsset(asset: AssetRecord) {
  return (asset.status === "done" || asset.status === "accepted") && Boolean(asset.output?.file) && !UTILITY_SHOT_IDS.has(asset.shotId) && !asset.inputs.shapeVariant;
}
async function withGalleryMutation<T>(productRoot: string, productId: string, action: () => Promise<T>): Promise<T> {
  const key = selectionPath(productRoot, productId);
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => { release = resolve; });
  const next = previous.catch(() => undefined).then(() => tail);
  mutationTails.set(key, next);
  await previous.catch(() => undefined);
  try { return await action(); } finally { release(); if (mutationTails.get(key) === next) mutationTails.delete(key); }
}
async function persist(args: ProductArgs, selection: GallerySelection) {
  await atomicWriteJson(selectionPath(args.productRoot, args.productId), selection);
  return selection;
}
function changed(current: GallerySelection, assetIds = current.assetIds): GallerySelection {
  return { ...current, assetIds, revision: current.revision + 1, updatedAt: new Date().toISOString(), exportReady: false, readyAt: null, reviewedContent: null };
}
function assertRevision(current: GallerySelection, expectedRevision?: number) {
  if (expectedRevision !== undefined && expectedRevision !== current.revision) throw conflictError("GALLERY_REVISION_CONFLICT", "Gallery changed. Refresh and try again.", { gallery: current });
}
async function seed(args: ProductArgs): Promise<GallerySelection> {
  // Unrelated corrupt generations do not make a base-only gallery unusable.
  const entries = await fs.readdir(generatedDir(args.productRoot, args.productId), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const assets: AssetRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".error.json")) continue;
    try {
      const found = await getAssetRecord({ ...args, assetId: entry.name.slice(0, -5) });
      if (found.asset.productId === args.productId && isGalleryEligibleAsset(found.asset)) assets.push(found.asset);
    } catch { /* Only selected records are export blockers. */ }
  }
  const now = new Date().toISOString();
  return persist(args, { version: 2, productId: args.productId,
    assetIds: assets.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.assetId.localeCompare(b.assetId)).map((asset) => asset.assetId),
    initializedAt: now, updatedAt: now, revision: 0, exportReady: false, readyAt: null, reviewedContent: null });
}
async function sourcePaths(args: ProductArgs, selection: GallerySelection) {
  const entries = await fs.readdir(productDir(args.productRoot, args.productId), { withFileTypes: true });
  const bases = entries.filter((entry) => entry.isFile() && path.parse(entry.name).name.toLowerCase() === "base" && SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
  if (bases.length !== 1) throw validationError("INVALID_MAIN_IMAGE", "Exactly one main base image is required to mark ready.");
  const paths = [bases[0]!.name];
  for (const assetId of selection.assetIds) { const asset = await assertSelectableAsset(args.productRoot, args.productId, assetId); paths.push(path.join("generated", asset.output!.file)); }
  return paths;
}
async function contentIdentity(args: ProductArgs, selection: GallerySelection) {
  const files = [];
  for (const relativePath of await sourcePaths(args, selection)) {
    const filePath = identityPath(args, relativePath);
    if (!(await regularFileExists(filePath))) throw validationError("GALLERY_ASSET_FILE_MISSING", "A gallery image is missing.");
    const stat = await fs.stat(filePath);
    files.push({ path: relativePath, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, sha256: await sha256File(filePath) });
  }
  return { files, fingerprint: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}
async function contentUnchanged(args: ProductArgs, selection: GallerySelection, full = false) {
  if (!selection.reviewedContent) return false;
  try {
    const paths = await sourcePaths(args, selection);
    if (JSON.stringify(paths) !== JSON.stringify(selection.reviewedContent.files.map((file) => file.path))) return false;
    for (const file of selection.reviewedContent.files) {
      const filePath = identityPath(args, file.path);
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs || stat.ctimeMs !== file.ctimeMs) return false;
      if (full && await sha256File(filePath) !== file.sha256) return false;
    }
    return true;
  } catch { return false; }
}
async function readUnlocked(args: ProductArgs, full = false): Promise<GallerySelection> {
  const file = selectionPath(args.productRoot, args.productId);
  if (!(await pathExists(file))) return seed(args);
  const parsed = z.union([GalleryV2Schema, GalleryV1Schema]).safeParse(await readJsonFile(file));
  if (!parsed.success || parsed.data.productId !== args.productId || new Set(parsed.data.assetIds).size !== parsed.data.assetIds.length) throw validationError("INVALID_GALLERY_SELECTION", `Gallery selection is invalid for ${args.productId}.`, parsed.success ? undefined : parsed.error.issues);
  if (parsed.data.version === 1) return persist(args, { ...parsed.data, version: 2, revision: 0, exportReady: false, readyAt: null, reviewedContent: null });
  const current = parsed.data;
  if (current.exportReady && !(await contentUnchanged(args, current, full))) return persist(args, changed(current));
  return current;
}
export async function loadGallerySelection(args: ProductArgs & { verifyContent?: boolean }): Promise<GallerySelection> {
  return withGalleryMutation(args.productRoot, args.productId, () => readUnlocked(args, args.verifyContent));
}
export async function galleryReadinessSummary(args: ProductArgs) {
  try {
    if (!(await pathExists(selectionPath(args.productRoot, args.productId)))) return { exportReady: false, galleryRevision: 0 };
    const gallery = await loadGallerySelection(args);
    return { exportReady: gallery.exportReady, galleryRevision: gallery.revision };
  } catch (error) { return { readinessError: error instanceof Error ? error.message : "Gallery readiness could not be read." }; }
}
async function assertSelectableAsset(productRoot: string, productId: string, assetId: string) {
  const found = await getAssetRecord({ productRoot, productId, assetId });
  const asset = found.asset;
  if (found.location !== "generated" || asset.productId !== productId || !isGalleryEligibleAsset(asset)) throw validationError("GALLERY_ASSET_NOT_SELECTABLE", `${asset.shotName} is not an active accepted gallery image.`);
  if (!(await regularFileExists(safeChildPath(generatedDir(productRoot, productId), asset.output?.file ?? "")))) throw validationError("GALLERY_ASSET_FILE_MISSING", `${asset.shotName} image file is missing.`);
  return asset;
}
export async function saveGallerySelection(args: ProductArgs & { assetIds: string[]; expectedRevision?: number }): Promise<GallerySelection> {
  return withGalleryMutation(args.productRoot, args.productId, async () => {
    if (new Set(args.assetIds).size !== args.assetIds.length) throw validationError("DUPLICATE_GALLERY_ASSET", "Each generated image can appear in the gallery only once.");
    const current = await readUnlocked(args);
    assertRevision(current, args.expectedRevision);
    await Promise.all(args.assetIds.map((id) => assertSelectableAsset(args.productRoot, args.productId, id)));
    if (JSON.stringify(current.assetIds) === JSON.stringify(args.assetIds)) return current;
    return persist(args, changed(current, [...args.assetIds]));
  });
}
export async function setGalleryReadiness(args: ProductArgs & { exportReady: boolean; expectedRevision: number }) {
  return withGalleryMutation(args.productRoot, args.productId, async () => {
    const current = await readUnlocked(args);
    assertRevision(current, args.expectedRevision);
    if (current.exportReady === args.exportReady) return current;
    const reviewedContent = args.exportReady ? await contentIdentity(args, current) : null;
    const now = new Date().toISOString();
    return persist(args, { ...current, revision: current.revision + 1, exportReady: args.exportReady, readyAt: args.exportReady ? now : null, updatedAt: now, reviewedContent });
  });
}
export async function appendAcceptedGalleryAsset(args: ProductArgs & { asset: AssetRecord }): Promise<GallerySelection> {
  return withGalleryMutation(args.productRoot, args.productId, async () => {
    const current = await readUnlocked(args);
    if (!isGalleryEligibleAsset(args.asset) || current.assetIds.includes(args.asset.assetId)) return current;
    await assertSelectableAsset(args.productRoot, args.productId, args.asset.assetId);
    return persist(args, changed(current, [...current.assetIds, args.asset.assetId]));
  });
}
export async function removeGalleryAsset(args: ProductArgs & { assetId: string }): Promise<GallerySelection> {
  return withGalleryMutation(args.productRoot, args.productId, async () => {
    const current = await readUnlocked(args);
    if (!current.assetIds.includes(args.assetId)) return current;
    return persist(args, changed(current, current.assetIds.filter((id) => id !== args.assetId)));
  });
}
export async function acceptGalleryAssets(args: ProductArgs & { assetIds: string[] }): Promise<BulkAcceptResult> {
  return withGalleryMutation(args.productRoot, args.productId, async () => {
    let gallery = await readUnlocked(args);
    const results: BulkAcceptResult["results"] = [];
    const candidates: AssetRecord[] = [];
    for (const assetId of [...new Set(args.assetIds)]) {
      try {
        const found = await getAssetRecord({ ...args, assetId });
        if (found.location !== "generated" || found.asset.productId !== args.productId || !isFinishedGalleryAsset(found.asset)) throw new Error("Not an eligible finished gallery shot.");
        if (!(await regularFileExists(safeChildPath(generatedDir(args.productRoot, args.productId), found.asset.output!.file)))) throw new Error("Image file is missing.");
        candidates.push(found.asset);
      } catch (error) { results.push({ assetId, status: "skipped", reason: error instanceof Error ? error.message : "Cannot accept image." }); }
    }
    for (const candidate of candidates.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.assetId.localeCompare(b.assetId))) {
      try {
        if (candidate.status === "accepted") { results.push({ assetId: candidate.assetId, status: "already_accepted" }); continue; }
        if (!gallery.assetIds.includes(candidate.assetId) && gallery.assetIds.length >= 100) throw new Error("Gallery is limited to 100 generated images.");
        const asset = await acceptAsset({ ...args, assetId: candidate.assetId });
        if (!gallery.assetIds.includes(asset.assetId)) {
          try { gallery = await persist(args, changed(gallery, [...gallery.assetIds, asset.assetId])); }
          catch (error) { await atomicWriteJson(safeChildPath(generatedDir(args.productRoot, args.productId), `${candidate.assetId}.json`), candidate); throw error; }
        }
        results.push({ assetId: asset.assetId, status: "accepted" });
      } catch (error) { results.push({ assetId: candidate.assetId, status: "skipped", reason: error instanceof Error ? error.message : "Cannot accept image." }); }
    }
    return { gallery, results };
  });
}
export async function rejectGalleryAsset(args: ProductArgs & { assetId: string }) {
  return withGalleryMutation(args.productRoot, args.productId, async () => {
    const current = await readUnlocked(args);
    const asset = await rejectAsset(args);
    const gallery = current.assetIds.includes(args.assetId) ? await persist(args, changed(current, current.assetIds.filter((id) => id !== args.assetId))) : current;
    return { asset, gallery };
  });
}

export async function acceptGalleryAsset(args: ProductArgs & { assetId: string }) {
  return withGalleryMutation(args.productRoot, args.productId, async () => {
    const current = await readUnlocked(args);
    const found = await getAssetRecord(args);
    if (found.location !== "generated" || found.asset.productId !== args.productId || !["done", "accepted"].includes(found.asset.status) || !found.asset.output?.file) throw validationError("GALLERY_ASSET_NOT_SELECTABLE", "Only active finished images can be accepted.");
    if (!(await regularFileExists(safeChildPath(generatedDir(args.productRoot, args.productId), found.asset.output.file)))) throw validationError("GALLERY_ASSET_FILE_MISSING", "Image file is missing.");
    if (found.asset.status === "accepted") return { asset: found.asset, gallery: current };
    if (isFinishedGalleryAsset(found.asset) && current.assetIds.length >= 100) throw validationError("GALLERY_LIMIT", "Gallery is limited to 100 generated images.");
    const asset = await acceptAsset(args);
    let gallery = current;
    try { if (isGalleryEligibleAsset(asset) && !current.assetIds.includes(asset.assetId)) gallery = await persist(args, changed(current, [...current.assetIds, asset.assetId])); }
    catch (error) { await atomicWriteJson(found.path, found.asset); throw error; }
    return { asset, gallery };
  });
}
