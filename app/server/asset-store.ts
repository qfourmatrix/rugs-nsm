import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { WeightedLru } from "../shared/weighted-lru";
import type { AssetRecord, ShotAggregateState } from "../shared/types";
import { AssetRecordSchema } from "./schemas";
import { buildAssetId } from "./assetNaming";
import { conflictError, notFoundError, validationError } from "./errors";
import { atomicWriteJson, ensureDir, pathExists, safeChildPath } from "./fsUtils";

export function buildAssetBasename({
  shotId,
  now = new Date(),
  existingAssetIds = new Set<string>()
}: {
  shotId: string;
  now?: Date;
  existingAssetIds?: Set<string>;
}) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const assetId = buildAssetId(shotId, now);
    if (!existingAssetIds.has(assetId)) {
      return assetId;
    }
  }
  throw conflictError("ASSET_ID_COLLISION", "Could not reserve a unique asset id.");
}

function productDir(productRoot: string, productId: string) {
  if (productId.includes("/") || productId.includes("\\") || productId.includes("..")) {
    throw validationError("INVALID_PRODUCT_ID", "Invalid product id.");
  }
  return path.join(productRoot, productId);
}

export function generatedDir(productRoot: string, productId: string) {
  return path.join(productDir(productRoot, productId), "generated");
}

export function trashDir(productRoot: string, productId: string) {
  return path.join(productDir(productRoot, productId), "trash");
}

const METADATA_CACHE_WEIGHT_LIMIT = 32 * 1024 * 1024;
const metadataCache = new WeightedLru<string, { signature: string; asset: AssetRecord }>(4096, METADATA_CACHE_WEIGHT_LIMIT);
const compactMetadataCache = new WeightedLru<string, { signature: string; asset: AssetRecord }>(8192, 16 * 1024 * 1024);
/** Aggregate-only diagnostics; weights are estimates, never a measured JS heap size. */
export function assetMetadataCacheStats() {
  return {
    full: { entries: metadataCache.size, estimatedBytes: metadataCache.weight, maxEstimatedBytes: METADATA_CACHE_WEIGHT_LIMIT },
    compact: { entries: compactMetadataCache.size, estimatedBytes: compactMetadataCache.weight, maxEstimatedBytes: 16 * 1024 * 1024 }
  };
}
async function readCompactAssetAt(metadataPath: string): Promise<AssetRecord> {
  const info = await fs.stat(metadataPath, { bigint: true });
  const signature = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  const cached = compactMetadataCache.get(metadataPath);
  if (cached?.signature === signature) return structuredClone(cached.asset);
  // Card browsing must not retain a second copy containing full prompt/provider
  // details. Explicit detail/generation reads still use the full-record cache.
  const asset = compactAssetRecord(await readAssetAt(metadataPath, false));
  asset.detailsRevision = createHash("sha256").update(signature).digest("hex");
  const after = await fs.stat(metadataPath, { bigint: true });
  if (`${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}` === signature) {
    compactMetadataCache.set(metadataPath, { signature, asset }, JSON.stringify(asset).length * 2 + 1024);
  }
  // Never expose the cached object to callers that may review/mutate returned records.
  return structuredClone(asset);
}
async function readAssetAt(metadataPath: string, retainFullRecord = true): Promise<AssetRecord> {
  const info = await fs.stat(metadataPath, { bigint: true });
  const signature = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  const cached = metadataCache.get(metadataPath);
  if (cached?.signature === signature) return structuredClone(cached.asset);
  const parsed = AssetRecordSchema.safeParse(JSON.parse(await fs.readFile(metadataPath, "utf8")));
  if (!parsed.success) {
    throw validationError("INVALID_ASSET_METADATA", "Generated asset metadata is invalid.", parsed.error.issues);
  }
  if (retainFullRecord) {
    const after = await fs.stat(metadataPath, { bigint: true });
    if (`${after.ino}:${after.size}:${after.mtimeNs}:${after.ctimeNs}` === signature) {
      const weight = Number(info.size) * 2 + 1024;
      if (weight <= METADATA_CACHE_WEIGHT_LIMIT) metadataCache.set(metadataPath, { signature, asset: structuredClone(parsed.data) }, weight);
      else metadataCache.delete(metadataPath);
    }
  }
  return parsed.data;
}

async function findAssetMetadata(productRoot: string, productId: string, assetId: string) {
  const generatedPath = safeChildPath(generatedDir(productRoot, productId), `${assetId}.json`);
  const trashPath = safeChildPath(trashDir(productRoot, productId), `${assetId}.json`);
  const errorPath = safeChildPath(generatedDir(productRoot, productId), `${assetId}.error.json`);

  if (await pathExists(generatedPath)) return { location: "generated" as const, path: generatedPath };
  if (await pathExists(trashPath)) return { location: "trash" as const, path: trashPath };
  if (await pathExists(errorPath)) return { location: "generated" as const, path: errorPath, failed: true };

  throw notFoundError("ASSET_NOT_FOUND", "Asset metadata not found.");
}

export async function getAssetRecord({
  productRoot,
  productId,
  assetId
}: {
  productRoot: string;
  productId: string;
  assetId: string;
}) {
  const found = await findAssetMetadata(productRoot, productId, assetId);
  return { ...found, asset: await readAssetAt(found.path) };
}

async function listMetadataFiles(dir: string) {
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".error.json")))
    .map((entry) => path.join(dir, entry.name));
}

/** Validate every metadata identity without loading prompt/provider payloads. */
export async function generatedMetadataRevision(productRoot: string, productId: string, context: string) {
  const hash = createHash("sha256").update(context);
  for (const directory of [generatedDir(productRoot, productId), trashDir(productRoot, productId)]) {
    const files = (await listMetadataFiles(directory)).sort();
    for (let offset = 0; offset < files.length; offset += 16) {
      const signatures = await Promise.all(files.slice(offset, offset + 16).map(async file => {
        const info = await fs.stat(file, { bigint: true });
        return `${file}\0${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}\0`;
      }));
      for (const signature of signatures) hash.update(signature);
    }
  }
  return `W/"generated-${hash.digest("hex")}"`;
}

export async function listGeneratedAssets({
  productRoot,
  productId,
  runtimeAggregates = {},
  compact = false
}: {
  productRoot: string;
  productId: string;
  runtimeAggregates?: Record<string, ShotAggregateState>;
  compact?: boolean;
}) {
  const active: AssetRecord[] = [];
  const trash: AssetRecord[] = [];

  // Enumeration must not promote an entire history into the full-prompt cache.
  // Reuse already-cached details, but reserve new full-record admission for
  // individual record operations. Compact browsing has its own bounded cache.
  for (const file of await listMetadataFiles(generatedDir(productRoot, productId))) {
    active.push(await (compact ? readCompactAssetAt(file) : readAssetAt(file, false)));
  }

  for (const file of await listMetadataFiles(trashDir(productRoot, productId))) {
    trash.push(await (compact ? readCompactAssetAt(file) : readAssetAt(file, false)));
  }

  active.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  trash.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return {
    active,
    trash,
    aggregates: aggregateShots(active, trash, runtimeAggregates)
  };
}

/** Preserve card/review/action identities; full immutable source metadata is fetched on inspection. */
export function compactAssetRecord(asset: AssetRecord): AssetRecord {
  return { ...asset, detailsOmitted: true, prompt: "",
    inputs: { ...asset.inputs, background: asset.inputs.background ? { ...asset.inputs.background, prompt: "" } : asset.inputs.background },
    error: asset.error ? { ...asset.error, raw: null } : null
  };
}

export function aggregateShots(
  active: AssetRecord[],
  trash: AssetRecord[],
  runtimeAggregates: Record<string, ShotAggregateState> = {}
): Record<string, ShotAggregateState> {
  const shotIds = new Set<string>([
    ...active.map((asset) => asset.shotId),
    ...trash.map((asset) => asset.shotId),
    ...Object.keys(runtimeAggregates)
  ]);
  const aggregates: Record<string, ShotAggregateState> = {};

  for (const shotId of shotIds) {
    if (runtimeAggregates[shotId] === "generating") {
      aggregates[shotId] = "generating";
      continue;
    }

    const activeForShot = active.filter((asset) => asset.shotId === shotId);
    if (activeForShot.some((asset) => asset.status === "accepted")) {
      aggregates[shotId] = "accepted";
    } else if (activeForShot.some((asset) => asset.status === "done")) {
      aggregates[shotId] = "review_needed";
    } else if (activeForShot.some((asset) => asset.status === "failed")) {
      aggregates[shotId] = "failed";
    } else if (trash.some((asset) => asset.shotId === shotId)) {
      aggregates[shotId] = "rejected_only";
    } else {
      aggregates[shotId] = "empty";
    }
  }

  return aggregates;
}

export async function saveAsset({
  productRoot,
  productId,
  asset
}: {
  productRoot: string;
  productId: string;
  asset: AssetRecord;
}) {
  await ensureDir(generatedDir(productRoot, productId));
  const metadataPath = path.join(generatedDir(productRoot, productId), `${asset.assetId}${asset.status === "failed" ? ".error" : ""}.json`);
  await atomicWriteJson(metadataPath, asset, { overwrite: false });
}

export async function writeOutputImage({
  productRoot,
  productId,
  file,
  data
}: {
  productRoot: string;
  productId: string;
  file: string;
  data: Buffer;
}) {
  await ensureDir(generatedDir(productRoot, productId));
  await fs.writeFile(safeChildPath(generatedDir(productRoot, productId), file), data, { flag: "wx" });
}

export async function acceptAsset({
  productRoot,
  productId,
  assetId
}: {
  productRoot: string;
  productId: string;
  assetId: string;
}) {
  const found = await findAssetMetadata(productRoot, productId, assetId);
  if (found.failed) {
    throw validationError("FAILED_ASSET_CANNOT_ACCEPT", "Failed assets cannot be accepted.");
  }
  const asset = await readAssetAt(found.path);
  if (asset.status === "accepted") return asset;
  if (asset.status === "rejected") return asset;

  const updated = { ...asset, status: "accepted" as const };
  await atomicWriteJson(found.path, updated);
  return updated;
}

export async function rejectAsset({
  productRoot,
  productId,
  assetId
}: {
  productRoot: string;
  productId: string;
  assetId: string;
}) {
  const found = await findAssetMetadata(productRoot, productId, assetId);
  if (found.failed) {
    throw validationError("FAILED_ASSET_CANNOT_REJECT", "Failed assets cannot be rejected.");
  }
  const asset = await readAssetAt(found.path);
  if (found.location === "trash" || asset.status === "rejected") return asset;
  if (!asset.output?.file) {
    throw validationError("ASSET_OUTPUT_MISSING", "Asset image output is missing.");
  }

  await ensureDir(trashDir(productRoot, productId));
  const updated = { ...asset, status: "rejected" as const };
  const imageSource = safeChildPath(generatedDir(productRoot, productId), asset.output.file);
  const imageTarget = safeChildPath(trashDir(productRoot, productId), asset.output.file);
  const metadataTarget = safeChildPath(trashDir(productRoot, productId), `${asset.assetId}.json`);

  await atomicWriteJson(found.path, updated);
  await fs.rename(imageSource, imageTarget).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await fs.rename(found.path, metadataTarget).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });

  return updated;
}
