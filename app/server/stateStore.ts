import { stat } from "node:fs/promises";
import path from "node:path";
import type { ProductState } from "../shared/types";
import { DEFAULT_SOS_CUSTOM_PALETTE } from "../shared/sos-palettes";
import { AppError } from "./errors";
import { atomicWriteJson, pathExists, readJsonFile } from "./fsUtils";
import { ProductStateSchema } from "./schemas";

export interface ProductStateTarget {
  id: string;
  dirPath: string;
}

export function productStatePath(product: ProductStateTarget): string {
  return path.join(product.dirPath, "product-state.json");
}

export function defaultProductState(productId: string, now = new Date()): ProductState {
  return {
    version: 1,
    productId,
    createdAt: now.toISOString(),
    selectedShotId: null,
    selectedAssetId: null,
    selectedBackgroundId: null,
    selectedConstructionId: null,
    refinePatternMode: "symmetrical",
    refineVariationCount: 3,
    sosPaletteId: "auto_flip",
    sosCustomPalette: { ...DEFAULT_SOS_CUSTOM_PALETTE },
    sosDesignChange: false,
    referenceImages: [],
    promptBox: {
      value: "",
      sourceShotId: null,
      dirty: false,
      updatedAt: now.toISOString()
    },
    settings: {
      aspectRatio: "1:1",
      imageSize: "4K",
      concurrency: 2,
      batchSize: 1
    }
  };
}

export async function ensureProductState(product: ProductStateTarget): Promise<void> {
  const filePath = productStatePath(product);
  if (!(await pathExists(filePath))) {
    await atomicWriteJson(filePath, defaultProductState(product.id, await productCreatedAt(product.dirPath)), {
      overwrite: false
    });
  }
}

export async function loadProductState(product: ProductStateTarget): Promise<ProductState> {
  await ensureProductState(product);
  const filePath = productStatePath(product);
  let raw: unknown;

  try {
    raw = await readJsonFile(filePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError(422, "INVALID_PRODUCT_STATE_JSON", "product-state.json is not valid JSON.");
    }
    throw error;
  }

  const stateRecord =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  const needsCreatedAtMigration = stateRecord !== null && !("createdAt" in stateRecord);
  const needsRefineVariationCountMigration = stateRecord !== null && !("refineVariationCount" in stateRecord);
  const needsSosMigration =
    stateRecord !== null &&
    (!("sosPaletteId" in stateRecord) || !("sosCustomPalette" in stateRecord) || !("sosDesignChange" in stateRecord));
  const normalizedRaw = needsCreatedAtMigration
    ? { ...stateRecord, createdAt: (await productCreatedAt(product.dirPath)).toISOString() }
    : raw;
  const parsed = ProductStateSchema.safeParse(normalizedRaw);
  if (!parsed.success) {
    throw new AppError(
      422,
      "INVALID_PRODUCT_STATE_SCHEMA",
      "product-state.json does not match the required schema.",
      parsed.error.issues
    );
  }

  if (parsed.data.productId !== product.id) {
    throw new AppError(
      422,
      "PRODUCT_STATE_ID_MISMATCH",
      "product-state.json belongs to a different product.",
      { expected: product.id, actual: parsed.data.productId }
    );
  }

  if (needsCreatedAtMigration || needsRefineVariationCountMigration || needsSosMigration) {
    await atomicWriteJson(filePath, parsed.data);
  }

  return parsed.data;
}

export async function saveProductState(product: ProductStateTarget, state: ProductState): Promise<ProductState> {
  const parsed = ProductStateSchema.safeParse({ ...state, productId: product.id });
  if (!parsed.success) {
    throw new AppError(
      400,
      "INVALID_PRODUCT_STATE_SCHEMA",
      "product-state.json does not match the required schema.",
      parsed.error.issues
    );
  }

  await atomicWriteJson(productStatePath(product), parsed.data);
  return parsed.data;
}

async function productCreatedAt(dirPath: string): Promise<Date> {
  const info = await stat(dirPath);
  const timestamp = info.birthtimeMs > 0 ? info.birthtimeMs : info.ctimeMs > 0 ? info.ctimeMs : Date.now();
  return new Date(timestamp);
}
