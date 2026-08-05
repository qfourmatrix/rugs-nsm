import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ShapeVariantMetadataSchema } from "../shared/schemas";
import { shotIdForShape } from "../shared/shape-variants";
import type { ProductState, ShapeVariantMetadata, ShapeVariantRecord } from "../shared/types";
import { acceptAsset, generatedDir, getAssetRecord } from "./asset-store";
import { conflictError, validationError } from "./errors";
import { atomicWriteJson, ensureDir, pathExists, readJsonFile, sha256File } from "./fsUtils";
import { loadProductState } from "./product-state";
import { updateShapeVariantRecord } from "./shape-variant-store";

function assertSafeProductId(productId: string) {
  if (!productId || productId.includes("/") || productId.includes("\\") || productId.includes("..")) {
    throw validationError("INVALID_PRODUCT_ID", "Invalid shape-variant product id.");
  }
}

function approvedProductState(source: ProductState, productId: string): ProductState {
  const now = new Date().toISOString();
  return {
    ...source,
    productId,
    createdAt: now,
    selectedAssetId: null,
    referenceImages: [],
    promptBox: {
      ...source.promptBox,
      updatedAt: now
    }
  };
}

async function existingApprovalMatches(targetDir: string, record: ShapeVariantRecord, assetId: string) {
  const metadataPath = path.join(targetDir, "variant.json");
  if (!(await pathExists(metadataPath))) return false;
  const parsed = ShapeVariantMetadataSchema.safeParse(await readJsonFile(metadataPath));
  return Boolean(
    parsed.success &&
      parsed.data.sourceProductId === record.sourceProductId &&
      parsed.data.shape === record.shape &&
      parsed.data.approvedAssetId === assetId &&
      parsed.data.sourceBaseSha256 === record.sourceBaseSha256
  );
}

export async function materializeShapeVariant({
  productRoot,
  record,
  assetId
}: {
  productRoot: string;
  record: ShapeVariantRecord;
  assetId: string;
}) {
  assertSafeProductId(record.sourceProductId);
  assertSafeProductId(record.variantProductId);
  const expectedVariantId = `${record.sourceProductId}--${record.shape}`;
  if (record.variantProductId !== expectedVariantId) {
    throw validationError("INVALID_VARIANT_TARGET", `Variant target must be ${expectedVariantId}.`);
  }

  const sourceDir = path.join(productRoot, record.sourceProductId);
  const sourceBasePath = path.join(sourceDir, record.sourceBaseFile);
  const currentSourceHash = await sha256File(sourceBasePath);
  if (currentSourceHash !== record.sourceBaseSha256) {
    await updateShapeVariantRecord(productRoot, record.id, (current) => {
      current.status = "stale";
      current.lastError = "The source base rug changed after this candidate was prepared.";
    });
    throw conflictError(
      "SHAPE_VARIANT_SOURCE_CHANGED",
      "The source rug changed after generation. Re-prepare this variant before approval."
    );
  }

  const found = await getAssetRecord({ productRoot, productId: record.sourceProductId, assetId });
  const asset = found.asset;
  if (found.location !== "generated" || asset.status === "failed" || !asset.output?.file) {
    throw validationError("INVALID_SHAPE_CANDIDATE", "Only a successful, active shape candidate can be approved.");
  }
  if (asset.shotId !== shotIdForShape(record.shape)) {
    throw validationError("WRONG_SHAPE_CANDIDATE", `This asset is not a ${record.shape} candidate.`);
  }
  if (
    asset.inputs.shapeVariant?.sourceProductId !== record.sourceProductId ||
    asset.inputs.shapeVariant?.variantProductId !== record.variantProductId ||
    asset.inputs.shapeVariant?.shape !== record.shape ||
    asset.inputs.baseImage.sha256 !== record.sourceBaseSha256
  ) {
    throw validationError("CANDIDATE_PROVENANCE_MISMATCH", "Candidate provenance does not match this campaign record.");
  }

  const targetDir = path.join(productRoot, record.variantProductId);
  if (await pathExists(targetDir)) {
    if (!(await existingApprovalMatches(targetDir, record, assetId))) {
      throw conflictError("VARIANT_PRODUCT_EXISTS", `Product folder ${record.variantProductId} already exists.`);
    }
    await acceptAsset({ productRoot, productId: record.sourceProductId, assetId });
    return updateShapeVariantRecord(productRoot, record.id, (current) => {
      current.status = "approved";
      current.approvedAssetId = assetId;
      current.lastError = null;
      current.activeRunId = null;
    });
  }

  const tempDir = path.join(
    productRoot,
    `.${record.variantProductId}.approving.${process.pid}.${crypto.randomBytes(4).toString("hex")}`
  );
  const outputPath = path.join(generatedDir(productRoot, record.sourceProductId), asset.output.file);
  const now = new Date().toISOString();
  const metadata: ShapeVariantMetadata = {
    version: 1,
    familyId: record.familyId,
    sourceProductId: record.sourceProductId,
    shape: record.shape,
    sourceBaseSha256: record.sourceBaseSha256,
    approvedAssetId: assetId,
    promptVersion: record.promptVersion,
    createdAt: now
  };

  try {
    await ensureDir(tempDir);
    await Promise.all([
      ensureDir(path.join(tempDir, "references")),
      ensureDir(path.join(tempDir, "generated")),
      ensureDir(path.join(tempDir, "trash"))
    ]);
    const basePath = path.join(tempDir, "base.png");
    await sharp(outputPath).png().toFile(basePath);
    const imageInfo = await sharp(basePath).metadata();
    if (!imageInfo.width || !imageInfo.height || imageInfo.width < 512 || imageInfo.height < 512) {
      throw validationError("INVALID_VARIANT_IMAGE", "Approved variant image is missing or too small.");
    }
    await atomicWriteJson(path.join(tempDir, "variant.json"), metadata, { overwrite: false });
    const sourceState = await loadProductState({ productRoot, productId: record.sourceProductId });
    await atomicWriteJson(
      path.join(tempDir, "product-state.json"),
      approvedProductState(sourceState, record.variantProductId),
      { overwrite: false }
    );

    await acceptAsset({ productRoot, productId: record.sourceProductId, assetId });
    await fs.rename(tempDir, targetDir);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return updateShapeVariantRecord(productRoot, record.id, (current) => {
    current.status = "approved";
    current.approvedAssetId = assetId;
    current.lastError = null;
    current.activeRunId = null;
  });
}
