import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AssetRecord, AssetStatus, ProductSummary, Shot } from "../shared/types";
import {
  FORBIDDEN_RUG_CHANGES,
  PROMPT_PRIORITY_NOTE,
  RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE,
  RUG_REFERENCE_LOCK
} from "../shared/constants";

export const fixedIso = "2026-06-29T14:30:22.391Z";
export const fixedDate = new Date(fixedIso);

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

export async function makeTempWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "product-shot-queue-"));
}

export async function cleanupTempWorkspace(workspace: string): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writeFakeImage(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, tinyPng);
}

export async function makeProduct(
  productRoot: string,
  productId: string,
  files: string[] = ["base.jpg"]
): Promise<string> {
  const productDir = path.join(productRoot, productId);
  await mkdir(productDir, { recursive: true });

  for (const file of files) {
    await writeFakeImage(path.join(productDir, file));
  }

  return productDir;
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export function productList(scanResult: unknown): ProductSummary[] {
  if (Array.isArray(scanResult)) {
    return scanResult as ProductSummary[];
  }

  if (
    scanResult &&
    typeof scanResult === "object" &&
    Array.isArray((scanResult as { products?: unknown }).products)
  ) {
    return (scanResult as { products: ProductSummary[] }).products;
  }

  throw new Error("scanProducts must return ProductSummary[] or { products: ProductSummary[] }");
}

export function findProduct(products: ProductSummary[], id: string): ProductSummary {
  const product = products.find((candidate) => candidate.id === id || candidate.name === id);

  if (!product) {
    throw new Error(`Expected scanned product ${id}`);
  }

  return product;
}

export function makeShot(overrides: Partial<Shot> = {}): Shot {
  const id = overrides.id ?? "hero";
  const prompt =
    overrides.prompt ??
    JSON.stringify(
      {
        shot_id: id,
        prompt_priority_note: PROMPT_PRIORITY_NOTE,
        rug_reference_lock: RUG_REFERENCE_LOCK,
        allowed_rug_material_instruction: RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE,
        scene: `Generate ${id}`,
        rug_placement: "Place the Image 1 rug naturally.",
        camera: "Use a realistic product camera.",
        lighting: "Use realistic light.",
        styling: "Keep styling secondary to Image 1.",
        forbidden_changes: [...FORBIDDEN_RUG_CHANGES],
        quality: "Photorealistic product image.",
        output_requirements: "The rug must remain visually identical to Image 1."
      },
      null,
      2
    );

  return {
    id,
    name: overrides.name ?? id.replaceAll("_", " "),
    prompt,
    defaultAspectRatio: overrides.defaultAspectRatio ?? "1:1",
    defaultImageSize: overrides.defaultImageSize ?? "4K"
  };
}

export function makeAssetRecord(overrides: Partial<AssetRecord> = {}): AssetRecord {
  const shotId = overrides.shotId ?? "hero";
  const assetId = overrides.assetId ?? `${shotId}_2026-06-29_143022_391_a8f2c1`;
  const status: AssetStatus = overrides.status ?? "done";

  return {
    version: 1,
    assetId,
    productId: overrides.productId ?? "SKU-001",
    shotId,
    shotName: overrides.shotName ?? "Hero",
    status,
    attempt: overrides.attempt ?? 1,
    parentAssetId: overrides.parentAssetId ?? null,
    createdAt: overrides.createdAt ?? fixedIso,
    prompt: overrides.prompt ?? "Exact prompt attempted.",
    masterShotsVersion: overrides.masterShotsVersion ?? 1,
    settings: overrides.settings ?? {
      provider: "mock",
      model: "mock-image",
      aspectRatio: "1:1",
      imageSize: "4K"
    },
    inputs: overrides.inputs ?? {
      baseImage: {
        file: "base.jpg",
        sha256: "base-image-sha256",
        sizeBytes: 67,
        mtimeMs: 1782730000000,
        mimeType: "image/jpeg"
      },
      references: []
    },
    output:
      overrides.output === undefined
        ? {
            file: `${assetId}.png`,
            mimeType: "image/png",
            sizeBytes: 67
          }
        : overrides.output,
    provider: overrides.provider ?? {
      requestId: null,
      durationMs: 500,
      normalizedStatus: status === "failed" ? "provider_error" : "success",
      requestPreview: {
        responseModalities: ["IMAGE"],
        aspectRatio: "1:1",
        imageSize: "4K",
        inputImageCount: 1
      }
    },
    error: overrides.error ?? null
  };
}

export async function writeGeneratedAsset(
  productRoot: string,
  asset: AssetRecord
): Promise<{ generatedDir: string; trashDir: string; metadataPath: string; imagePath: string }> {
  const productDir = path.join(productRoot, asset.productId);
  const generatedDir = path.join(productDir, "generated");
  const trashDir = path.join(productDir, "trash");
  await mkdir(generatedDir, { recursive: true });
  await mkdir(trashDir, { recursive: true });

  const metadataPath = path.join(generatedDir, `${asset.assetId}.json`);
  const imagePath = path.join(generatedDir, asset.output?.file ?? `${asset.assetId}.png`);
  await writeFakeImage(imagePath);
  await writeFile(metadataPath, `${JSON.stringify(asset, null, 2)}\n`);

  return { generatedDir, trashDir, metadataPath, imagePath };
}

export function assetIdFromReservation(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(/\.(error\.json|png|json)$/i, "");
  }

  if (value && typeof value === "object") {
    const candidate = value as { assetId?: string; basename?: string; imageFile?: string };
    const assetId = candidate.assetId ?? candidate.basename ?? candidate.imageFile;

    if (assetId) {
      return assetId.replace(/\.(error\.json|png|json)$/i, "");
    }
  }

  throw new Error("Filename reservation must return a string or an object with assetId/basename/imageFile");
}
