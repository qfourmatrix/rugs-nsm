import path from "node:path";
import { z } from "zod";
import type { AssetRecord, GallerySelection } from "../shared/types";
import { getAssetRecord, generatedDir, listGeneratedAssets } from "./asset-store";
import { validationError } from "./errors";
import { atomicWriteJson, pathExists, readJsonFile, regularFileExists, safeChildPath } from "./fsUtils";

export const GALLERY_SELECTION_FILENAME = "gallery-selection.json";
export const UTILITY_SHOT_IDS = new Set(["refine_base", "shape_runner_base", "shape_round_base"]);

const GallerySelectionSchema = z.object({
  version: z.literal(1),
  productId: z.string().min(1),
  assetIds: z.array(z.string().min(1)).max(100),
  initializedAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

const mutationTails = new Map<string, Promise<void>>();

function productDir(productRoot: string, productId: string) {
  if (!productId || productId.includes("/") || productId.includes("\\") || productId.includes("..")) {
    throw validationError("INVALID_PRODUCT_ID", "Invalid product id.");
  }
  return path.join(productRoot, productId);
}

function selectionPath(productRoot: string, productId: string) {
  return safeChildPath(productDir(productRoot, productId), GALLERY_SELECTION_FILENAME);
}

export function isGalleryEligibleAsset(asset: AssetRecord) {
  return (
    asset.status === "accepted" &&
    Boolean(asset.output?.file) &&
    !UTILITY_SHOT_IDS.has(asset.shotId) &&
    !asset.inputs.shapeVariant
  );
}

async function createSeedSelection(productRoot: string, productId: string): Promise<GallerySelection> {
  const generated = await listGeneratedAssets({ productRoot, productId });
  const now = new Date().toISOString();
  const assetIds = generated.active
    .filter(isGalleryEligibleAsset)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.assetId.localeCompare(right.assetId))
    .map((asset) => asset.assetId);
  const selection: GallerySelection = {
    version: 1,
    productId,
    assetIds,
    initializedAt: now,
    updatedAt: now
  };
  await atomicWriteJson(selectionPath(productRoot, productId), selection);
  return selection;
}

export async function loadGallerySelection({
  productRoot,
  productId
}: {
  productRoot: string;
  productId: string;
}): Promise<GallerySelection> {
  const filePath = selectionPath(productRoot, productId);
  if (!(await pathExists(filePath))) {
    return createSeedSelection(productRoot, productId);
  }

  const parsed = GallerySelectionSchema.safeParse(await readJsonFile(filePath));
  if (!parsed.success || parsed.data.productId !== productId) {
    throw validationError(
      "INVALID_GALLERY_SELECTION",
      `Gallery selection is invalid for ${productId}.`,
      parsed.success ? undefined : parsed.error.issues
    );
  }
  return parsed.data;
}

async function withGalleryMutation<T>(productRoot: string, productId: string, action: () => Promise<T>): Promise<T> {
  const key = selectionPath(productRoot, productId);
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.catch(() => undefined).then(() => tail);
  mutationTails.set(key, next);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (mutationTails.get(key) === next) mutationTails.delete(key);
  }
}

async function assertSelectableAsset(productRoot: string, productId: string, assetId: string) {
  const found = await getAssetRecord({ productRoot, productId, assetId });
  const asset = found.asset;
  if (found.location !== "generated" || !isGalleryEligibleAsset(asset)) {
    throw validationError(
      "GALLERY_ASSET_NOT_SELECTABLE",
      `${asset.shotName} is not an active accepted gallery image.`
    );
  }
  const outputPath = safeChildPath(generatedDir(productRoot, productId), asset.output?.file ?? "");
  if (!(await regularFileExists(outputPath))) {
    throw validationError("GALLERY_ASSET_FILE_MISSING", `${asset.shotName} image file is missing.`);
  }
  return asset;
}

export async function saveGallerySelection({
  productRoot,
  productId,
  assetIds
}: {
  productRoot: string;
  productId: string;
  assetIds: string[];
}): Promise<GallerySelection> {
  return withGalleryMutation(productRoot, productId, async () => {
    if (new Set(assetIds).size !== assetIds.length) {
      throw validationError("DUPLICATE_GALLERY_ASSET", "Each generated image can appear in the gallery only once.");
    }
    await Promise.all(assetIds.map((assetId) => assertSelectableAsset(productRoot, productId, assetId)));
    const current = await loadGallerySelection({ productRoot, productId });
    const selection: GallerySelection = {
      ...current,
      assetIds: [...assetIds],
      updatedAt: new Date().toISOString()
    };
    await atomicWriteJson(selectionPath(productRoot, productId), selection);
    return selection;
  });
}

export async function appendAcceptedGalleryAsset({
  productRoot,
  productId,
  asset
}: {
  productRoot: string;
  productId: string;
  asset: AssetRecord;
}): Promise<GallerySelection> {
  return withGalleryMutation(productRoot, productId, async () => {
    const current = await loadGallerySelection({ productRoot, productId });
    if (!isGalleryEligibleAsset(asset) || current.assetIds.includes(asset.assetId)) return current;
    const selection = {
      ...current,
      assetIds: [...current.assetIds, asset.assetId],
      updatedAt: new Date().toISOString()
    };
    await atomicWriteJson(selectionPath(productRoot, productId), selection);
    return selection;
  });
}

export async function removeGalleryAsset({
  productRoot,
  productId,
  assetId
}: {
  productRoot: string;
  productId: string;
  assetId: string;
}): Promise<GallerySelection> {
  return withGalleryMutation(productRoot, productId, async () => {
    const current = await loadGallerySelection({ productRoot, productId });
    if (!current.assetIds.includes(assetId)) return current;
    const selection = {
      ...current,
      assetIds: current.assetIds.filter((candidate) => candidate !== assetId),
      updatedAt: new Date().toISOString()
    };
    await atomicWriteJson(selectionPath(productRoot, productId), selection);
    return selection;
  });
}
