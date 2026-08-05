import { promises as fs } from "node:fs";
import path from "node:path";
import express from "express";
import sharp from "sharp";
import type {
  AssetRecord,
  AspectRatio,
  GenerationBackgroundSnapshot,
  GenerationConstructionSnapshot,
  GenerationLabelLogoSnapshot,
  ImageSize,
  JobRecord,
  ProductSummary,
  ShapeVariantDerivation,
  ShapeVariantRecord,
  SosCustomPalette,
  SosPaletteId,
  Shot
} from "../shared/types";
import { composeSosRefinePrompt } from "../shared/sos-palettes";
import { BACKGROUND_REQUIRED_SHOT_IDS, LABEL_REQUIRED_SHOT_IDS, RUG_CONSTRUCTION_OPTIONS } from "../shared/constants";
import { resolveShapeShotContext } from "../shared/shape-shot-prompts";
import {
  BulkGenerateRequestSchema,
  GenerateRequestSchema,
  RefineRequestSchema,
  ShapeVariantApproveRequestSchema,
  ShapeVariantGenerateRequestSchema,
  ShapeVariantPrepareRequestSchema,
  ShapeVariantShotsBatchRequestSchema
} from "../shared/schemas";
import {
  buildShapeVariantPrompt,
  promptVersionForShape,
  shotIdForShape,
  shotNameForShape
} from "../shared/shape-variants";
import {
  getBackgroundSnapshot,
  getLabelLogoSnapshot,
  markBackgroundUsed,
  resolveProductLibraryPath,
  resolveBackgroundPreviewPath,
  scanBackgroundLibrary,
  setBackgroundManifestPath,
  setLabelLogoPath,
  toClientBackgroundLibraryState
} from "./background-library";
import { buildAssetBasename, getAssetRecord, listGeneratedAssets, rejectAsset, saveAsset, writeOutputImage } from "./asset-store";
import { config, clampQueueConcurrency } from "./config";
import { asyncRoute, conflictError, errorMiddleware, notFoundError, validationError } from "./errors";
import { ensureDir, imageMimeType, pathExists, safeChildPath, sha256File, SUPPORTED_IMAGE_EXTENSIONS } from "./fsUtils";
import { loadMasterShots, saveMasterShots } from "./master-shots";
import { loadPersistedJobs, savePersistedJobs } from "./job-store";
import { composeGenerationPrompt } from "./prompt-compose";
import { parseLaoZhangImageResponse, buildLaoZhangRequest } from "./providers/laozhang";
import { JobRegistry, selectGenerateMissingShots } from "./queue";
import { compareProductsByCreatedAt, scanProducts, resolveProductImagePath } from "./scanner";
import { getOrCreateBackgroundThumbnail, getOrCreateThumbnail, type ThumbnailKind } from "./thumbnails";
import { loadProductState, saveProductState } from "./product-state";
import { loadRefineSettings, saveRecentSosPalette, saveRefineSettings } from "./refine-settings";
import {
  hideRefineGenerated,
  REFINE_REFERENCE_BASENAME,
  REFINE_SHOT_ID
} from "./refine-artifacts";
import { redactSecrets } from "./security";
import { hideShapeVariantGenerated } from "./shape-variant-artifacts";
import { materializeShapeVariant } from "./shape-variant-materialize";
import {
  getShapeVariantRecord,
  loadShapeVariantCampaign,
  mutateShapeVariantCampaign,
  shapeVariantRecordId,
  summarizeShapeVariantCampaign,
  updateShapeVariantRecord
} from "./shape-variant-store";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

const REFINE_SHOT_NAME = "Refine Base";

const app = express();
const jobs = new JobRegistry((records) => {
  void savePersistedJobs(config.productRoot, records).catch((error) => {
    console.error("Failed to persist job log", error);
  });
});
const pending: Array<QueuedGeneration> = [];
const activeAbortControllers = new Map<string, AbortController>();
let activeCount = 0;

app.use(express.json({ limit: "100mb" }));

interface QueuedGeneration {
  job: JobRecord;
  productId: string;
  shot: Shot;
  prompt: string;
  settings: {
    aspectRatio: AspectRatio;
    imageSize: ImageSize;
  };
  referenceImages: string[];
  background: GenerationBackgroundSnapshot | null;
  labelLogo: GenerationLabelLogoSnapshot | null;
  construction: GenerationConstructionSnapshot | null;
  parentAssetId: string | null;
  attempt: number;
  batchIndex: number;
  batchTotal: number;
  sourceImage: {
    file: string;
    path: string;
    mimeType: string;
  } | null;
  shapeVariant: ShapeVariantDerivation | null;
}

function makeRunId() {
  return `run_${Date.now().toString(36)}`;
}

function makeJobId() {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function runtimeAggregatesFor(productId: string) {
  const aggregates: Record<string, "generating"> = {};
  for (const job of jobs.all()) {
    if (job.productId === productId && (job.status === "queued" || job.status === "generating")) {
      aggregates[job.shotId] = "generating";
    }
  }
  return aggregates;
}

function batchLabel(base: string, item: Pick<QueuedGeneration, "batchIndex" | "batchTotal">) {
  return item.batchTotal > 1 ? `${base} ${item.batchIndex}/${item.batchTotal}` : base;
}

function nextAttemptForShot(
  generated: Awaited<ReturnType<typeof listGeneratedAssets>>,
  shotId: string
) {
  const attempts = [...generated.active, ...generated.trash]
    .filter((asset) => asset.shotId === shotId)
    .map((asset) => asset.attempt);

  return attempts.length > 0 ? Math.max(...attempts) + 1 : 1;
}

function assertNoRunningShots(productId: string, shots: Shot[]) {
  const blocked = shots.find((shot) => jobs.hasRunning(productId, shot.id));
  if (blocked) {
    throw conflictError(
      "JOB_ALREADY_RUNNING",
      `A job is already queued or generating for ${blocked.name}.`
    );
  }
}

function validateReferenceImages(product: ProductSummary, requested: string[]) {
  const unique = [...new Set(requested)].slice(0, 14);
  const available = new Set(product.referenceImages);
  const invalid = unique.filter((filename) => !available.has(filename));

  if (invalid.length > 0) {
    throw validationError("UNKNOWN_REFERENCE_IMAGE", `Unknown reference image: ${invalid[0]}`);
  }

  return unique;
}

function requiresBackground(shotId: string) {
  return (BACKGROUND_REQUIRED_SHOT_IDS as readonly string[]).includes(shotId);
}

function requiresLabelLogo(shotId: string) {
  return (LABEL_REQUIRED_SHOT_IDS as readonly string[]).includes(shotId);
}

function constructionSnapshotForId(id: string | null | undefined): GenerationConstructionSnapshot | null {
  if (!id) return null;
  const option = RUG_CONSTRUCTION_OPTIONS.find((item) => item.id === id);
  return option ? { id: option.id, name: option.name, prompt: option.prompt } : null;
}

async function prepareGeneration({
  productId,
  productShape,
  shot,
  prompt
}: {
  productId: string;
  productShape: ProductSummary["shape"];
  shot: Shot;
  prompt: string;
}) {
  const state = await loadProductState({ productRoot: config.productRoot, productId });
  const construction = constructionSnapshotForId(state.selectedConstructionId);
  const background = requiresBackground(shot.id)
    ? await getBackgroundSnapshot({ productRoot: config.productRoot, backgroundId: state.selectedBackgroundId })
    : null;

  if (requiresBackground(shot.id) && !background) {
    throw validationError("BACKGROUND_REQUIRED", `${shot.name} requires a selected background for this rug.`);
  }

  const labelLogo = requiresLabelLogo(shot.id)
    ? await getLabelLogoSnapshot({ productRoot: config.productRoot })
    : null;

  if (requiresLabelLogo(shot.id) && !labelLogo) {
    throw validationError("LABEL_LOGO_REQUIRED", `${shot.name} requires a configured label-logo image.`);
  }

  return {
    prompt: composeGenerationPrompt({
      prompt,
      background,
      labelLogo,
      construction,
      shapeContext: resolveShapeShotContext({
        shape: productShape,
        shot,
        prompt,
        backgroundType: background?.type
      })
    }),
    background,
    labelLogo,
    construction
  };
}

async function listProductGenerated(productId: string, includeRefineArtifacts = false) {
  const generated = await listGeneratedAssets({
    productRoot: config.productRoot,
    productId,
    runtimeAggregates: runtimeAggregatesFor(productId)
  });

  return includeRefineArtifacts ? generated : hideShapeVariantGenerated(hideRefineGenerated(generated));
}

async function loadNormalizedProductState(productId: string) {
  const state = await loadProductState({ productRoot: config.productRoot, productId });
  const masterShots = await loadMasterShots({ productRoot: config.productRoot });
  const selectedExists = state.selectedShotId
    ? masterShots.shots.some((shot) => shot.id === state.selectedShotId)
    : true;
  const selectedShot = state.selectedShotId
    ? masterShots.shots.find((shot) => shot.id === state.selectedShotId) ?? null
    : null;
  const firstShot = masterShots.shots[0];

  if (
    selectedShot &&
    !state.promptBox.dirty &&
    state.promptBox.sourceShotId === selectedShot.id &&
    state.promptBox.value !== selectedShot.prompt
  ) {
    return saveProductState({
      productRoot: config.productRoot,
      productId,
      state: {
        ...state,
        promptBox: {
          value: selectedShot.prompt,
          sourceShotId: selectedShot.id,
          dirty: false,
          updatedAt: new Date().toISOString()
        },
        settings: {
          ...state.settings,
          aspectRatio: selectedShot.defaultAspectRatio,
          imageSize: selectedShot.defaultImageSize
        }
      }
    });
  }

  if (selectedExists || !firstShot) {
    return state;
  }

  return saveProductState({
    productRoot: config.productRoot,
    productId,
    state: {
      ...state,
      selectedShotId: firstShot.id,
      promptBox: {
        value: firstShot.prompt,
        sourceShotId: firstShot.id,
        dirty: false,
        updatedAt: new Date().toISOString()
      },
      settings: {
        ...state.settings,
        aspectRatio: firstShot.defaultAspectRatio,
        imageSize: firstShot.defaultImageSize
      }
    }
  });
}

async function productsWithCounts(): Promise<ProductSummary[]> {
  const masterShots = await loadMasterShots({ productRoot: config.productRoot });
  const scan = await scanProducts({ productRoot: config.productRoot });
  jobs.pruneTerminalJobsForProducts(new Set(scan.products.map((product) => product.id)));

  const products = await Promise.all(
    scan.products.map(async (product) => {
      let generated = { active: [] as AssetRecord[], trash: [] as AssetRecord[], aggregates: {} as Record<string, string> };
      let createdAt = product.createdAt;
      try {
        createdAt = (await loadProductState({ productRoot: config.productRoot, productId: product.id })).createdAt;
      } catch {
        // Keep the filesystem creation time in the product list. Loading the product will surface invalid state.
      }
      try {
        await ensureDir(path.join(config.productRoot, product.id, "generated"));
        await ensureDir(path.join(config.productRoot, product.id, "trash"));
        generated = await listProductGenerated(product.id);
      } catch {
        generated = { active: [], trash: [], aggregates: {} };
      }

      const aggregateValues = masterShots.shots.map((shot) => generated.aggregates[shot.id] ?? "empty");
      return {
        ...product,
        createdAt,
        counts: {
          totalShots: masterShots.shots.length,
          accepted: aggregateValues.filter((value) => value === "accepted").length,
          reviewNeeded: aggregateValues.filter((value) => value === "review_needed").length,
          failed: aggregateValues.filter((value) => value === "failed").length,
          running: aggregateValues.filter((value) => value === "generating").length
        }
      };
    })
  );

  return products.sort(compareProductsByCreatedAt);
}

async function assertReadyProduct(productId: string) {
  const products = await productsWithCounts();
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) {
    throw notFoundError("UNKNOWN_PRODUCT", `Unknown product: ${productId}`);
  }
  if (product.status !== "ready" || !product.baseImage) {
    throw validationError("PRODUCT_NOT_GENERATABLE", product.errors[0] ?? "Product is not ready for generation.");
  }
  return product;
}

function shapeShot(record: ShapeVariantRecord): Shot {
  return {
    id: shotIdForShape(record.shape),
    name: shotNameForShape(record.shape),
    prompt: record.prompt,
    defaultAspectRatio: "1:1",
    defaultImageSize: record.imageSize
  };
}

function shapeDerivation(record: ShapeVariantRecord, runId: string): ShapeVariantDerivation {
  return {
    familyId: record.familyId,
    sourceProductId: record.sourceProductId,
    variantProductId: record.variantProductId,
    shape: record.shape,
    strategy: record.strategy,
    runnerRatio: record.runnerRatio,
    roundEdgePolicy: record.roundEdgePolicy,
    promptVersion: record.promptVersion,
    runId
  };
}

async function shapeVariantCandidates(record: ShapeVariantRecord) {
  const generated = await listGeneratedAssets({
    productRoot: config.productRoot,
    productId: record.sourceProductId
  });
  const wanted = new Set(record.candidateAssetIds);
  return [...generated.active, ...generated.trash].filter((asset) => wanted.has(asset.assetId));
}

async function enqueueShapeVariantRecord(record: ShapeVariantRecord) {
  const source = await assertReadyProduct(record.sourceProductId);
  if (source.shape !== "area" || !source.baseImage) {
    throw validationError("AREA_SOURCE_REQUIRED", "Runner and Round variants must be generated from a ready Area rug.");
  }
  const sourceHash = await sha256File(path.join(config.productRoot, source.id, source.baseImage));
  if (sourceHash !== record.sourceBaseSha256) {
    await updateShapeVariantRecord(config.productRoot, record.id, (current) => {
      current.status = "stale";
      current.lastError = "The source base rug changed after this variant was prepared.";
    });
    throw conflictError("SHAPE_VARIANT_SOURCE_CHANGED", "The source rug changed. Re-prepare this variant before generating.");
  }
  if (record.status === "approved") {
    throw conflictError("SHAPE_VARIANT_APPROVED", "This shape variant is already approved.");
  }
  if (record.status === "queued" || record.status === "generating") {
    throw conflictError("SHAPE_VARIANT_RUNNING", "This shape variant is already queued or generating.");
  }
  if (await pathExists(path.join(config.productRoot, record.variantProductId))) {
    throw conflictError("VARIANT_PRODUCT_EXISTS", `Product folder ${record.variantProductId} already exists.`);
  }

  const shot = shapeShot(record);
  const generated = await listGeneratedAssets({ productRoot: config.productRoot, productId: record.sourceProductId });
  const runId = makeRunId();
  await updateShapeVariantRecord(config.productRoot, record.id, (current) => {
    current.status = "queued";
    current.activeRunId = runId;
    current.requestedCandidateCount = current.candidateCount;
    current.completedCandidateCount = 0;
    current.lastError = null;
  });

  try {
    const jobIds = enqueueBatch({
      runId,
      productId: record.sourceProductId,
      shot,
      prompt: record.prompt,
      settings: { aspectRatio: "1:1", imageSize: record.imageSize },
      referenceImages: [],
      background: null,
      labelLogo: null,
      construction: null,
      parentAssetId: null,
      batchSize: record.candidateCount,
      attemptStart: nextAttemptForShot(generated, shot.id),
      shapeVariant: shapeDerivation(record, runId)
    });
    return { id: record.id, runId, jobIds };
  } catch (error) {
    await updateShapeVariantRecord(config.productRoot, record.id, (current) => {
      if (current.activeRunId === runId) {
        current.status = "failed";
        current.activeRunId = null;
        current.lastError = error instanceof Error ? error.message : "Could not queue shape generation.";
      }
    });
    throw error;
  }
}

async function resumeInterruptedShapeVariants() {
  const campaign = await loadShapeVariantCampaign(config.productRoot);
  const interrupted = campaign.variants.filter(
    (record) => (record.status === "queued" || record.status === "generating") && record.activeRunId
  );

  for (const original of interrupted) {
    try {
      const allAssets = await listGeneratedAssets({
        productRoot: config.productRoot,
        productId: original.sourceProductId
      });
      const runAssets = [...allAssets.active, ...allAssets.trash].filter(
        (asset) =>
          asset.inputs.shapeVariant?.runId === original.activeRunId &&
          asset.inputs.shapeVariant?.variantProductId === original.variantProductId
      );
      const successfulIds = runAssets
        .filter((asset) => asset.status !== "failed" && Boolean(asset.output?.file))
        .map((asset) => asset.assetId);
      const completed = Math.min(original.requestedCandidateCount, runAssets.length);
      const reconciled = await updateShapeVariantRecord(config.productRoot, original.id, (record) => {
        for (const assetId of successfulIds) {
          if (!record.candidateAssetIds.includes(assetId)) record.candidateAssetIds.push(assetId);
        }
        record.completedCandidateCount = completed;
        if (completed >= record.requestedCandidateCount) {
          record.status = record.candidateAssetIds.length > 0 ? "needs_review" : "failed";
          record.activeRunId = null;
          if (record.status === "failed") record.lastError = "The interrupted run completed without a usable candidate.";
        }
      });
      if (!reconciled.activeRunId) continue;

      const remaining = reconciled.requestedCandidateCount - reconciled.completedCandidateCount;
      if (remaining <= 0) continue;
      const source = await assertReadyProduct(reconciled.sourceProductId);
      if (source.shape !== "area" || !source.baseImage) throw validationError("AREA_SOURCE_REQUIRED", "Shape source is not ready.");
      const currentHash = await sha256File(path.join(config.productRoot, source.id, source.baseImage));
      if (currentHash !== reconciled.sourceBaseSha256) {
        await updateShapeVariantRecord(config.productRoot, reconciled.id, (record) => {
          record.status = "stale";
          record.activeRunId = null;
          record.lastError = "The source changed while the app was offline.";
        });
        continue;
      }

      const shot = shapeShot(reconciled);
      enqueueBatch({
        runId: reconciled.activeRunId,
        productId: reconciled.sourceProductId,
        shot,
        prompt: reconciled.prompt,
        settings: { aspectRatio: "1:1", imageSize: reconciled.imageSize },
        referenceImages: [],
        background: null,
        labelLogo: null,
        construction: null,
        parentAssetId: null,
        batchSize: remaining,
        attemptStart: nextAttemptForShot(allAssets, shot.id),
        shapeVariant: shapeDerivation(reconciled, reconciled.activeRunId)
      });
    } catch (error) {
      await updateShapeVariantRecord(config.productRoot, original.id, (record) => {
        record.status = "failed";
        record.activeRunId = null;
        record.lastError = error instanceof Error ? `Could not resume interrupted generation: ${error.message}` : "Could not resume interrupted generation.";
      }).catch(() => undefined);
    }
  }
}

function sanitizeProductSlug(name: string) {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "product";
}

async function uniqueProductId(name: string) {
  const base = sanitizeProductSlug(name);
  for (let index = 0; index < 200; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const target = path.join(config.productRoot, candidate);
    if (!(await pathExists(target))) {
      return candidate;
    }
  }

  throw conflictError("PRODUCT_ID_COLLISION", "Could not create a unique product folder.");
}

async function assertKnownProduct(productId: string) {
  const products = await productsWithCounts();
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) {
    throw notFoundError("UNKNOWN_PRODUCT", `Unknown product: ${productId}`);
  }
  return product;
}

function decodeUploadedImage({
  data,
  mimeType
}: {
  data: unknown;
  mimeType: unknown;
}) {
  if (typeof data !== "string" || !data.trim()) {
    throw validationError("IMAGE_REQUIRED", "Reference image data is required.");
  }

  const match = data.match(/^data:([^;,]+);base64,(.+)$/);
  const normalizedMimeType = typeof mimeType === "string" && mimeType.trim()
    ? mimeType.trim()
    : match?.[1] ?? "";
  const base64 = match?.[2] ?? data;
  const extension =
    normalizedMimeType === "image/png"
      ? "png"
      : normalizedMimeType === "image/webp"
        ? "webp"
        : normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg"
          ? "jpg"
          : "";

  if (!extension || !SUPPORTED_IMAGE_EXTENSIONS.has(`.${extension}`)) {
    throw validationError("UNSUPPORTED_IMAGE", "Use a PNG, JPG, or WEBP reference image.");
  }

  return {
    data: Buffer.from(base64, "base64"),
    mimeType: extension === "jpg" ? "image/jpeg" : normalizedMimeType,
    extension
  };
}

async function latestRefineReference(productId: string) {
  const referencesDir = path.join(config.productRoot, productId, "references");
  for (const extension of ["png", "jpg", "jpeg", "webp"]) {
    const file = `${REFINE_REFERENCE_BASENAME}.${extension}`;
    const filePath = path.join(referencesDir, file);
    if (await pathExists(filePath)) {
      return {
        file: `references/${file}`,
        path: filePath,
        mimeType: imageMimeType(file)
      };
    }
  }

  return null;
}

function enqueueGeneration(input: Omit<QueuedGeneration, "job"> & { runId: string; skipRunningCheck?: boolean }) {
  if (!input.skipRunningCheck && jobs.hasRunning(input.productId, input.shot.id)) {
    throw conflictError("JOB_ALREADY_RUNNING", "A job is already queued or generating for this shot.");
  }

  const now = new Date().toISOString();
  const job: JobRecord = {
    jobId: makeJobId(),
    runId: input.runId,
    productId: input.productId,
    shotId: input.shot.id,
    shotName: input.shot.name,
    batchIndex: input.batchIndex,
    batchTotal: input.batchTotal,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    message: batchLabel("Queued", input)
  };
  jobs.add(job);
  pending.push({ ...input, job });
  void drainQueue();
  return job.jobId;
}

function enqueueBatch(input: {
  runId: string;
  productId: string;
  shot: Shot;
  prompt: string;
  settings: QueuedGeneration["settings"];
  referenceImages: string[];
  background: GenerationBackgroundSnapshot | null;
  labelLogo: GenerationLabelLogoSnapshot | null;
  construction: GenerationConstructionSnapshot | null;
  parentAssetId: string | null;
  batchSize: number;
  attemptStart: number;
  sourceImage?: QueuedGeneration["sourceImage"];
  shapeVariant?: ShapeVariantDerivation | null;
}) {
  if (jobs.hasRunning(input.productId, input.shot.id)) {
    throw conflictError("JOB_ALREADY_RUNNING", `A job is already queued or generating for ${input.shot.name}.`);
  }

  const jobIds: string[] = [];
  for (let index = 0; index < input.batchSize; index += 1) {
    jobIds.push(
      enqueueGeneration({
        runId: input.runId,
        productId: input.productId,
        shot: input.shot,
        prompt: input.prompt,
        settings: input.settings,
        referenceImages: input.referenceImages,
        background: input.background,
        labelLogo: input.labelLogo,
        construction: input.construction,
        parentAssetId: input.parentAssetId,
        attempt: input.attemptStart + index,
        batchIndex: index + 1,
        batchTotal: input.batchSize,
        sourceImage: input.sourceImage ?? null,
        shapeVariant: input.shapeVariant ?? null,
        skipRunningCheck: true
      })
    );
  }

  return jobIds;
}

async function drainQueue() {
  const concurrency = clampQueueConcurrency(config.defaultConcurrency);
  while (activeCount < concurrency && pending.length > 0) {
    const next = pending.shift();
    if (!next) return;
    const current = jobs.all().find((job) => job.jobId === next.job.jobId);
    if (current?.status === "cancelled") {
      await noteShapeVariantCompletion(next, "cancelled");
      continue;
    }
    activeCount += 1;
    void runGeneration(next).finally(() => {
      activeCount -= 1;
      void drainQueue();
    });
  }
}

async function runGeneration(item: QueuedGeneration) {
  jobs.update(item.job.jobId, { status: "generating", message: batchLabel("Generating", item) });
  await noteShapeVariantStarted(item);
  if (item.background) {
    await markBackgroundUsed({ productRoot: config.productRoot, backgroundId: item.background.id });
  }
  const abortController = new AbortController();
  activeAbortControllers.set(item.job.jobId, abortController);
  const started = Date.now();
  let baseInfo: AssetRecord["inputs"]["baseImage"] | null = null;
  let assetId: string | null = null;
  try {
    const productDir = path.join(config.productRoot, item.productId);
    const product = item.sourceImage ? null : await assertReadyProduct(item.productId);
    const basePath = item.sourceImage?.path ?? path.join(productDir, product?.baseImage as string);
    const baseFile = item.sourceImage?.file ?? (product?.baseImage as string);
    const baseMimeType = item.sourceImage?.mimeType ?? imageMimeType(baseFile);
    const baseStat = await fs.stat(basePath);
    baseInfo = {
      file: baseFile,
      sha256: await sha256File(basePath),
      sizeBytes: baseStat.size,
      mtimeMs: baseStat.mtimeMs,
      mimeType: baseMimeType
    };
    const references = await Promise.all(
      item.referenceImages.map(async (file) => {
        const referencePath = path.join(productDir, "references", file);
        return {
          file,
          path: referencePath,
          mimeType: imageMimeType(file),
          base64: await fs.readFile(referencePath, "base64")
        };
      })
    );
    const labelLogoPath = item.labelLogo
      ? await resolveProductLibraryPath(item.labelLogo.path, config.productRoot)
      : null;
    const labelReference = item.labelLogo && labelLogoPath
      ? {
          file: item.labelLogo.file,
          path: labelLogoPath,
          mimeType: item.labelLogo.mimeType,
          base64: await fs.readFile(labelLogoPath, "base64")
        }
      : null;
    const providerReferences = labelReference ? [labelReference, ...references] : references;
    const existing = await listGeneratedAssets({ productRoot: config.productRoot, productId: item.productId });
    const existingAssetIds = new Set([...existing.active, ...existing.trash].map((asset) => asset.assetId));
    assetId = buildAssetBasename({ shotId: item.shot.id, existingAssetIds });
    const image = await generateImage({
      prompt: item.prompt,
      basePath,
      baseMimeType,
      aspectRatio: item.settings.aspectRatio,
      imageSize: item.settings.imageSize,
      references: providerReferences,
      signal: abortController.signal
    });
    if (abortController.signal.aborted || jobs.get(item.job.jobId)?.status === "cancelled") {
      jobs.update(item.job.jobId, { status: "cancelled", message: "Cancelled." });
      await noteShapeVariantCompletion(item, "cancelled");
      return;
    }
    if (!assetId || !baseInfo) {
      throw validationError("GENERATION_METADATA_MISSING", "Generation metadata was not initialized.");
    }
    const outputFile = `${assetId}.${image.extension}`;
    await writeOutputImage({
      productRoot: config.productRoot,
      productId: item.productId,
      file: outputFile,
      data: image.data
    });
    const outputStat = await fs.stat(path.join(config.productRoot, item.productId, "generated", outputFile));
    const asset = createAssetRecord({
      assetId,
      productId: item.productId,
      shot: item.shot,
      prompt: item.prompt,
      parentAssetId: item.parentAssetId,
      attempt: item.attempt,
      baseInfo,
      output: {
        file: outputFile,
        mimeType: image.mimeType,
        sizeBytes: outputStat.size
      },
      settings: item.settings,
      referenceImages: item.referenceImages,
      background: item.background,
      labelLogo: item.labelLogo,
      construction: item.construction,
      shapeVariant: item.shapeVariant,
      durationMs: Date.now() - started
    });
    await saveAsset({ productRoot: config.productRoot, productId: item.productId, asset });
    jobs.update(item.job.jobId, {
      status: "succeeded",
      assetId,
      message: batchLabel("Generated", item)
    });
    await noteShapeVariantCompletion(item, "succeeded", assetId);
  } catch (error) {
    if (isCancellation(error) || jobs.get(item.job.jobId)?.status === "cancelled") {
      jobs.update(item.job.jobId, { status: "cancelled", message: "Cancelled." });
      await noteShapeVariantCompletion(item, "cancelled");
      return;
    }
    if (!baseInfo || !assetId) {
      jobs.update(item.job.jobId, {
        status: "failed",
        message: error instanceof Error ? error.message : "Generation failed."
      });
      await noteShapeVariantCompletion(item, "failed", null, error);
      return;
    }
    const asset = createAssetRecord({
      assetId,
      productId: item.productId,
      shot: item.shot,
      prompt: item.prompt,
      parentAssetId: item.parentAssetId,
      attempt: item.attempt,
      baseInfo,
      output: null,
      settings: item.settings,
      referenceImages: item.referenceImages,
      background: item.background,
      labelLogo: item.labelLogo,
      construction: item.construction,
      shapeVariant: item.shapeVariant,
      durationMs: Date.now() - started,
      error
    });
    await saveAsset({ productRoot: config.productRoot, productId: item.productId, asset });
    jobs.update(item.job.jobId, {
      status: "failed",
      assetId,
      message: asset.error?.message ?? "Failed"
    });
    await noteShapeVariantCompletion(item, "failed", assetId, error);
  } finally {
    activeAbortControllers.delete(item.job.jobId);
  }
}

async function noteShapeVariantStarted(item: QueuedGeneration) {
  if (!item.shapeVariant) return;
  await updateShapeVariantRecord(config.productRoot, shapeVariantRecordId(item.shapeVariant.sourceProductId, item.shapeVariant.shape), (record) => {
    if (record.activeRunId === item.shapeVariant?.runId && record.status !== "approved") {
      record.status = "generating";
    }
  });
}

async function noteShapeVariantCompletion(
  item: QueuedGeneration,
  outcome: "succeeded" | "failed" | "cancelled",
  assetId?: string | null,
  error?: unknown
) {
  if (!item.shapeVariant) return;
  await updateShapeVariantRecord(config.productRoot, shapeVariantRecordId(item.shapeVariant.sourceProductId, item.shapeVariant.shape), (record) => {
    if (record.activeRunId !== item.shapeVariant?.runId || record.status === "approved") return;
    if (outcome === "succeeded" && assetId && !record.candidateAssetIds.includes(assetId)) {
      record.candidateAssetIds.push(assetId);
    }
    record.completedCandidateCount = Math.min(
      record.requestedCandidateCount,
      record.completedCandidateCount + 1
    );
    if (outcome !== "succeeded") {
      record.lastError = error instanceof Error ? error.message : outcome === "cancelled" ? "Generation was cancelled." : "Generation failed.";
    }
    if (record.completedCandidateCount >= record.requestedCandidateCount) {
      record.status = record.candidateAssetIds.length > 0 ? "needs_review" : outcome === "cancelled" ? "cancelled" : "failed";
      record.activeRunId = null;
    } else {
      record.status = "generating";
    }
  });
}

function isCancellation(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("cancelled"))
  );
}

function createAssetRecord({
  assetId,
  productId,
  shot,
  prompt,
  parentAssetId,
  attempt,
  baseInfo,
  output,
  settings,
  referenceImages,
  background,
  labelLogo,
  construction,
  shapeVariant,
  durationMs,
  error
}: {
  assetId: string;
  productId: string;
  shot: Shot;
  prompt: string;
  parentAssetId: string | null;
  attempt: number;
  baseInfo: AssetRecord["inputs"]["baseImage"];
  output: AssetRecord["output"];
  settings: { aspectRatio: AspectRatio; imageSize: ImageSize };
  referenceImages: string[];
  background: GenerationBackgroundSnapshot | null;
  labelLogo: GenerationLabelLogoSnapshot | null;
  construction: GenerationConstructionSnapshot | null;
  shapeVariant: ShapeVariantDerivation | null;
  durationMs: number;
  error?: unknown;
}): AssetRecord {
  const failed = Boolean(error);
  return {
    version: 1,
    assetId,
    productId,
    shotId: shot.id,
    shotName: shot.name,
    status: failed ? "failed" : "done",
    attempt,
    parentAssetId,
    createdAt: new Date().toISOString(),
    prompt,
    masterShotsVersion: 1,
    settings: {
      provider: config.providerMode,
      model: config.providerMode === "mock" ? "mock-image" : "gemini-3-pro-image-preview",
      aspectRatio: settings.aspectRatio,
      imageSize: settings.imageSize
    },
    inputs: {
      baseImage: baseInfo,
      references: referenceImages,
      background,
      labelLogo,
      construction,
      shapeVariant
    },
    output,
    provider: {
      requestId: null,
      durationMs,
      normalizedStatus: failed ? "provider_error" : "success",
      requestPreview: {
        responseModalities: ["IMAGE"],
        aspectRatio: settings.aspectRatio,
        imageSize: settings.imageSize,
        inputImageCount: 1 + referenceImages.length + (labelLogo ? 1 : 0)
      }
    },
    error: failed
      ? {
          message: error instanceof Error ? error.message : "Generation failed.",
          code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "PROVIDER_ERROR",
          raw: redactSecrets(error, [config.laozhangApiKey])
        }
      : null
  };
}

async function generateImage({
  prompt,
  basePath,
  baseMimeType,
  aspectRatio,
  imageSize,
  references,
  signal
}: {
  prompt: string;
  basePath: string;
  baseMimeType: string;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  references: Array<{ file: string; base64: string; mimeType: string }>;
  signal?: AbortSignal;
}): Promise<{ data: Buffer; mimeType: string; extension: string }> {
  if (config.providerMode === "mock") {
    await cancellableDelay(randomMockLatency(), signal);
    if (prompt.includes("[fail]")) {
      throw validationError("MOCK_FAILURE", "Mock provider failure triggered by prompt.");
    }
    const extension = baseMimeType === "image/webp" ? "webp" : baseMimeType === "image/png" ? "png" : "jpg";
    return {
      data: await fs.readFile(basePath),
      mimeType: baseMimeType,
      extension
    };
  }

  if (!config.laozhangApiKey) {
    throw validationError("AUTH_ERROR", "Missing LaoZhang API key.");
  }

  const base64Image = await fs.readFile(basePath, "base64");
  const body = buildLaoZhangRequest({
    prompt,
    base64Image,
    mimeType: baseMimeType,
    aspectRatio,
    imageSize,
    references
  });
  const response = await fetch(config.laozhangEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.laozhangApiKey}`,
      "x-goog-api-key": config.laozhangApiKey
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000)
  });
  const json = await response.json().catch(() => {
    throw validationError("MALFORMED_PROVIDER_RESPONSE", "Provider returned malformed JSON.");
  });

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "AUTH_ERROR" : response.status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR";
    throw validationError(code, `Provider returned HTTP ${response.status}.`, redactSecrets(json, [config.laozhangApiKey]));
  }

  const parsed = await parseLaoZhangImageResponse(json);
  return {
    data: Buffer.from(parsed.data, "base64"),
    mimeType: parsed.mimeType,
    extension: parsed.mimeType === "image/webp" ? "webp" : parsed.mimeType === "image/jpeg" ? "jpg" : "png"
  };
}

function randomMockLatency() {
  if (config.mockLatencyMaxMs <= config.mockLatencyMinMs) {
    return config.mockLatencyMinMs;
  }

  return Math.floor(
    config.mockLatencyMinMs + Math.random() * (config.mockLatencyMaxMs - config.mockLatencyMinMs)
  );
}

function cancellableDelay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Generation cancelled.", "AbortError");
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new DOMException("Generation cancelled.", "AbortError"));
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}

app.get(
  "/api/app-info",
  asyncRoute(async (_req, res) => {
    res.json({
      appInfo: {
        productRoot: config.productRoot,
        providerMode: config.providerMode,
        providerReady: config.providerMode === "mock" || Boolean(config.laozhangApiKey),
        queueConcurrency: clampQueueConcurrency(config.defaultConcurrency),
        endpointHost: config.providerMode === "laozhang" ? new URL(config.laozhangEndpoint).host : null
      }
    });
  })
);

app.get(
  "/api/refine-settings",
  asyncRoute(async (_req, res) => {
    res.json({ refineSettings: await loadRefineSettings({ productRoot: config.productRoot }) });
  })
);

app.put(
  "/api/refine-settings",
  asyncRoute(async (req, res) => {
    res.json({
      refineSettings: await saveRefineSettings({
        productRoot: config.productRoot,
        mode: req.body?.mode,
        prompt: req.body?.prompt
      })
    });
  })
);

app.put(
  "/api/refine-settings/sos-palettes",
  asyncRoute(async (req, res) => {
    res.json({
      refineSettings: await saveRecentSosPalette({
        productRoot: config.productRoot,
        palette: req.body?.palette
      })
    });
  })
);

app.get(
  "/api/products",
  asyncRoute(async (_req, res) => {
    res.json({ products: await productsWithCounts() });
  })
);

app.get(
  "/api/shape-variants",
  asyncRoute(async (_req, res) => {
    const campaign = await loadShapeVariantCampaign(config.productRoot);
    const summary = summarizeShapeVariantCampaign(campaign);
    res.json({
      shapeVariants: {
        ...summary,
        plannedProviderCalls: summary.records
          .filter((record) => ["planned", "failed", "cancelled", "stale"].includes(record.status))
          .reduce((total, record) => total + record.candidateCount, 0)
      }
    });
  })
);

app.post(
  "/api/shape-variants/prepare",
  asyncRoute(async (req, res) => {
    const parsed = ShapeVariantPrepareRequestSchema.parse(req.body ?? {});
    const products = await productsWithCounts();
    const byId = new Map(products.map((product) => [product.id, product]));
    const preparedInputs: Array<{
      source: ProductSummary;
      shape: "runner" | "round";
      sourceBaseSha256: string;
      prompt: string;
    }> = [];

    for (const sourceProductId of [...new Set(parsed.sourceProductIds)]) {
      const source = byId.get(sourceProductId);
      if (!source) throw notFoundError("UNKNOWN_PRODUCT", `Unknown product: ${sourceProductId}`);
      if (source.shape !== "area" || source.status !== "ready" || !source.baseImage) {
        throw validationError("AREA_SOURCE_REQUIRED", `${source.name} is not a ready Area rug.`);
      }
      const sourceBaseSha256 = await sha256File(path.join(config.productRoot, source.id, source.baseImage));
      for (const shape of [...new Set(parsed.shapes)]) {
        const variantProductId = `${source.id}--${shape}`;
        const target = byId.get(variantProductId);
        if (target && target.shape !== shape) {
          throw conflictError("VARIANT_PRODUCT_EXISTS", `Product folder ${variantProductId} already exists and is not a valid ${shape} variant.`);
        }
        if (target) {
          // The catalog is authoritative. A valid materialized sibling stays complete even if
          // the disposable campaign file was removed or restored from an older backup.
          continue;
        }
        preparedInputs.push({
          source,
          shape,
          sourceBaseSha256,
          prompt: buildShapeVariantPrompt({
            shape,
            strategy: parsed.strategy,
            runnerRatio: parsed.runnerRatio,
            roundEdgePolicy: parsed.roundEdgePolicy
          })
        });
      }
    }

    const records = await mutateShapeVariantCampaign(config.productRoot, (campaign) => {
      const now = new Date().toISOString();
      const result: ShapeVariantRecord[] = [];
      for (const input of preparedInputs) {
        const id = shapeVariantRecordId(input.source.id, input.shape);
        const existing = campaign.variants.find((record) => record.id === id);
        if (existing?.status === "approved" || existing?.status === "queued" || existing?.status === "generating") {
          result.push(structuredClone(existing));
          continue;
        }
        const record: ShapeVariantRecord = {
          id,
          familyId: input.source.familyId,
          sourceProductId: input.source.id,
          variantProductId: `${input.source.id}--${input.shape}`,
          shape: input.shape,
          status: "planned",
          strategy: parsed.strategy,
          runnerRatio: input.shape === "runner" ? parsed.runnerRatio : null,
          roundEdgePolicy: input.shape === "round" ? parsed.roundEdgePolicy : null,
          imageSize: parsed.imageSize,
          candidateCount: parsed.candidateCount,
          sourceBaseFile: input.source.baseImage as string,
          sourceBaseSha256: input.sourceBaseSha256,
          promptVersion: promptVersionForShape(input.shape),
          prompt: input.prompt,
          candidateAssetIds: [],
          approvedAssetId: null,
          activeRunId: null,
          requestedCandidateCount: 0,
          completedCandidateCount: 0,
          lastError: null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        };
        if (existing) Object.assign(existing, record);
        else campaign.variants.push(record);
        result.push(structuredClone(record));
      }
      return result;
    });

    res.json({ records, plannedProviderCalls: records.filter((record) => record.status === "planned").reduce((sum, record) => sum + record.candidateCount, 0) });
  })
);

app.post(
  "/api/shape-variants/generate",
  asyncRoute(async (req, res) => {
    const parsed = ShapeVariantGenerateRequestSchema.parse(req.body ?? {});
    const results: Array<{ id: string; runId?: string; jobIds?: string[]; error?: string }> = [];
    for (const id of [...new Set(parsed.ids)]) {
      try {
        results.push(await enqueueShapeVariantRecord(await getShapeVariantRecord(config.productRoot, id)));
      } catch (error) {
        results.push({ id, error: error instanceof Error ? error.message : "Could not generate shape variant." });
      }
    }
    res.json({ results });
  })
);

app.post(
  "/api/shape-variants/generate-shots",
  asyncRoute(async (req, res) => {
    const parsed = ShapeVariantShotsBatchRequestSchema.parse(req.body ?? {});
    const masterShots = await loadMasterShots({ productRoot: config.productRoot });
    const results: Array<{
      productId: string;
      jobIds: string[];
      blocked: Array<{ shotId: string; message: string }>;
    }> = [];

    for (const productId of [...new Set(parsed.productIds)]) {
      const product = await assertReadyProduct(productId);
      if (product.shape === "area") {
        results.push({ productId, jobIds: [], blocked: [{ shotId: "all", message: "This endpoint only generates approved Runner or Round product shots." }] });
        continue;
      }
      const generated = await listProductGenerated(productId);
      const missing = selectGenerateMissingShots({ shots: masterShots.shots, aggregates: generated.aggregates });
      const runId = makeRunId();
      const jobIds: string[] = [];
      const blocked: Array<{ shotId: string; message: string }> = [];
      for (const shot of missing) {
        try {
          const prepared = await prepareGeneration({ productId, productShape: product.shape, shot, prompt: shot.prompt });
          jobIds.push(...enqueueBatch({
            runId,
            productId,
            shot,
            prompt: prepared.prompt,
            settings: { aspectRatio: shot.defaultAspectRatio, imageSize: parsed.imageSize },
            referenceImages: [],
            background: prepared.background,
            labelLogo: prepared.labelLogo,
            construction: prepared.construction,
            parentAssetId: null,
            batchSize: 1,
            attemptStart: nextAttemptForShot(generated, shot.id)
          }));
        } catch (error) {
          blocked.push({ shotId: shot.id, message: error instanceof Error ? error.message : "Shot could not be queued." });
        }
      }
      results.push({ productId, jobIds, blocked });
    }

    res.json({
      results,
      providerCallsQueued: results.reduce((total, result) => total + result.jobIds.length, 0)
    });
  })
);

app.get(
  "/api/shape-variants/:id",
  asyncRoute(async (req, res) => {
    const record = await getShapeVariantRecord(config.productRoot, req.params.id as string);
    res.json({ variant: record, candidates: await shapeVariantCandidates(record) });
  })
);

app.post(
  "/api/shape-variants/:id/approve",
  asyncRoute(async (req, res) => {
    const parsed = ShapeVariantApproveRequestSchema.parse(req.body ?? {});
    const record = await getShapeVariantRecord(config.productRoot, req.params.id as string);
    if (!record.candidateAssetIds.includes(parsed.assetId)) {
      throw validationError("INVALID_SHAPE_CANDIDATE", "Choose a candidate produced for this shape variant.");
    }
    const variant = await materializeShapeVariant({
      productRoot: config.productRoot,
      record,
      assetId: parsed.assetId
    });
    const products = await productsWithCounts();
    res.json({
      variant,
      product: products.find((product) => product.id === record.variantProductId) ?? null
    });
  })
);

app.post(
  "/api/shape-variants/:id/candidates/:assetId/reject",
  asyncRoute(async (req, res) => {
    const id = req.params.id as string;
    const assetId = req.params.assetId as string;
    const record = await getShapeVariantRecord(config.productRoot, id);
    if (record.status === "approved") throw conflictError("SHAPE_VARIANT_APPROVED", "Approved variants cannot be rejected here.");
    if (!record.candidateAssetIds.includes(assetId)) {
      throw notFoundError("SHAPE_CANDIDATE_NOT_FOUND", "Shape candidate not found.");
    }
    const asset = await getAssetRecord({ productRoot: config.productRoot, productId: record.sourceProductId, assetId });
    if (asset.asset.inputs.shapeVariant?.variantProductId !== record.variantProductId) {
      throw validationError("CANDIDATE_PROVENANCE_MISMATCH", "Candidate provenance does not match this shape variant.");
    }
    await rejectAsset({ productRoot: config.productRoot, productId: record.sourceProductId, assetId });
    const variant = await updateShapeVariantRecord(config.productRoot, id, (current) => {
      current.candidateAssetIds = current.candidateAssetIds.filter((candidateId) => candidateId !== assetId);
      if (current.candidateAssetIds.length === 0) {
        current.status = "failed";
        current.lastError = "All generated candidates were rejected.";
      }
    });
    res.json({ variant });
  })
);

app.post(
  "/api/products",
  asyncRoute(async (req, res) => {
    const rawName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!rawName) {
      throw validationError("PRODUCT_NAME_REQUIRED", "Product name is required.");
    }
    if (rawName.length > 120) {
      throw validationError("PRODUCT_NAME_TOO_LONG", "Product name must be 120 characters or fewer.");
    }

    const productId = await uniqueProductId(rawName);
    const productDir = path.join(config.productRoot, productId);
    await ensureDir(productDir);
    await ensureDir(path.join(productDir, "references"));
    await ensureDir(path.join(productDir, "generated"));
    await ensureDir(path.join(productDir, "trash"));
    await loadProductState({ productRoot: config.productRoot, productId });

    const products = await productsWithCounts();
    res.status(201).json({ product: products.find((product) => product.id === productId) });
  })
);

app.get(
  "/api/background-library",
  asyncRoute(async (_req, res) => {
    const library = await scanBackgroundLibrary({ productRoot: config.productRoot });
    res.json({ library: toClientBackgroundLibraryState(library) });
  })
);

app.post(
  "/api/background-library/rescan",
  asyncRoute(async (_req, res) => {
    const library = await scanBackgroundLibrary({ productRoot: config.productRoot });
    res.json({ library: toClientBackgroundLibraryState(library) });
  })
);

app.put(
  "/api/background-library/manifest",
  asyncRoute(async (req, res) => {
    const manifestPath = typeof req.body?.manifestPath === "string" ? req.body.manifestPath : "";
    const library = await setBackgroundManifestPath({ productRoot: config.productRoot, manifestPath });
    res.json({ library: toClientBackgroundLibraryState(library) });
  })
);

app.put(
  "/api/background-library/label-logo",
  asyncRoute(async (req, res) => {
    const labelLogoPath = typeof req.body?.labelLogoPath === "string" ? req.body.labelLogoPath : "";
    const library = await setLabelLogoPath({ productRoot: config.productRoot, labelLogoPath });
    res.json({ library: toClientBackgroundLibraryState(library) });
  })
);

app.get(
  "/api/background-library/preview/:backgroundId",
  asyncRoute(async (req, res) => {
    const backgroundId = req.params.backgroundId as string;
    const previewPath = await resolveBackgroundPreviewPath({
      productRoot: config.productRoot,
      backgroundId
    });
    const thumbnailPath = await getOrCreateBackgroundThumbnail({
      productRoot: config.productRoot,
      backgroundId,
      sourcePath: previewPath
    });

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(thumbnailPath ?? previewPath, { dotfiles: "allow" });
  })
);

app.get(
  "/api/master-shots",
  asyncRoute(async (_req, res) => {
    res.json({ masterShots: await loadMasterShots({ productRoot: config.productRoot }) });
  })
);

app.put(
  "/api/master-shots",
  asyncRoute(async (req, res) => {
    res.json({ masterShots: await saveMasterShots({ productRoot: config.productRoot, masterShots: req.body }) });
  })
);

app.get(
  "/api/products/:productId/state",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    res.json({ state: await loadNormalizedProductState(productId) });
  })
);

app.put(
  "/api/products/:productId/state",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    res.json({
      state: await saveProductState({
        productRoot: config.productRoot,
        productId,
        state: req.body
      })
    });
  })
);

app.put(
  "/api/products/:productId/background",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const selectedBackgroundId =
      typeof req.body?.backgroundId === "string" && req.body.backgroundId.trim()
        ? req.body.backgroundId.trim()
        : null;
    if (selectedBackgroundId) {
      await getBackgroundSnapshot({ productRoot: config.productRoot, backgroundId: selectedBackgroundId });
    }
    const state = await loadProductState({ productRoot: config.productRoot, productId });
    res.json({
      state: await saveProductState({
        productRoot: config.productRoot,
        productId,
        state: {
          ...state,
          selectedBackgroundId
        }
      })
    });
  })
);

app.get(
  "/api/products/:productId/generated",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const scan = await scanProducts({ productRoot: config.productRoot });
    const product = scan.products.find((candidate) => candidate.id === productId);
    if (!product) {
      throw notFoundError("UNKNOWN_PRODUCT", `Unknown product: ${productId}`);
    }
    res.json({
      generated: await listProductGenerated(productId, product.status === "missing_base")
    });
  })
);

app.post(
  "/api/products/:productId/refine-reference",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const product = await assertKnownProduct(productId);
    if (product.status === "ready") {
      throw conflictError("BASE_ALREADY_EXISTS", "This product already has a base image.");
    }
    if (product.status === "duplicate_base") {
      throw validationError("DUPLICATE_BASE_IMAGE", product.errors[0] ?? "Remove duplicate base images first.");
    }

    const image = decodeUploadedImage({ data: req.body?.data, mimeType: req.body?.mimeType });
    const referencesDir = path.join(config.productRoot, productId, "references");
    await ensureDir(referencesDir);
    for (const extension of ["png", "jpg", "jpeg", "webp"]) {
      await fs.unlink(path.join(referencesDir, `${REFINE_REFERENCE_BASENAME}.${extension}`)).catch(() => undefined);
    }

    const filename = `${REFINE_REFERENCE_BASENAME}.${image.extension}`;
    await fs.writeFile(safeChildPath(referencesDir, filename), image.data);

    res.json({ reference: { filename } });
  })
);

app.post(
  "/api/products/:productId/refine",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const { imageSize, patternMode, variationCount, sosPaletteId, sosCustomPalette, sosDesignChange } =
      RefineRequestSchema.parse(req.body ?? {});
    const product = await assertKnownProduct(productId);
    if (product.status === "ready") {
      throw conflictError("BASE_ALREADY_EXISTS", "This product already has a base image.");
    }
    if (product.status === "duplicate_base") {
      throw validationError("DUPLICATE_BASE_IMAGE", product.errors[0] ?? "Remove duplicate base images first.");
    }

    const sourceImage = await latestRefineReference(productId);
    if (!sourceImage) {
      throw validationError("REFINE_REFERENCE_REQUIRED", "Upload a reference image before refining.");
    }

    const refineSettings = await loadRefineSettings({ productRoot: config.productRoot });
    const baseRefinePrompt = refineSettings.prompts[patternMode];
    const refinePrompt =
      patternMode === "sos"
        ? composeSosRefinePrompt({
            basePrompt: baseRefinePrompt,
            paletteId: sosPaletteId as SosPaletteId,
            customPalette: sosCustomPalette as SosCustomPalette,
            designChange: sosDesignChange
          })
        : baseRefinePrompt;

    const shot: Shot = {
      id: REFINE_SHOT_ID,
      name: REFINE_SHOT_NAME,
      prompt: refinePrompt,
      defaultAspectRatio: "1:1",
      defaultImageSize: imageSize
    };
    if (jobs.hasRunning(productId, shot.id)) {
      throw conflictError("JOB_ALREADY_RUNNING", "A refine batch is already queued or generating.");
    }

    const generated = await listProductGenerated(productId, true);
    const runId = makeRunId();
    const jobIds = enqueueBatch({
      runId,
      productId,
      shot,
      prompt: refinePrompt,
      settings: {
        aspectRatio: "1:1",
        imageSize
      },
      referenceImages: [],
      background: null,
      labelLogo: null,
      construction: null,
      parentAssetId: null,
      batchSize: variationCount,
      attemptStart: nextAttemptForShot(generated, shot.id),
      sourceImage
    });
    res.json({ runId, jobIds });
  })
);

app.post(
  "/api/products/:productId/refine/:assetId/validate",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const assetId = req.params.assetId as string;
    const product = await assertKnownProduct(productId);
    if (product.status === "ready") {
      throw conflictError("BASE_ALREADY_EXISTS", "This product already has a base image.");
    }
    if (product.status === "duplicate_base") {
      throw validationError("DUPLICATE_BASE_IMAGE", product.errors[0] ?? "Remove duplicate base images first.");
    }

    const generated = await listProductGenerated(productId, true);
    const asset = generated.active.find((candidate) => candidate.assetId === assetId);
    if (!asset || asset.shotId !== REFINE_SHOT_ID) {
      throw notFoundError("REFINE_ASSET_NOT_FOUND", "Refine variation not found.");
    }
    if (asset.status === "failed" || !asset.output?.file) {
      throw validationError("REFINE_ASSET_NOT_READY", "Choose a completed refine variation.");
    }

    const productDir = path.join(config.productRoot, productId);
    const sourcePath = path.join(productDir, "generated", asset.output.file);
    const basePath = path.join(productDir, "base.png");
    if (await pathExists(basePath)) {
      throw conflictError("BASE_ALREADY_EXISTS", "base.png already exists.");
    }
    await sharp(sourcePath).png().toFile(basePath);

    const { acceptAsset } = await import("./asset-store");
    await acceptAsset({ productRoot: config.productRoot, productId, assetId });
    await loadProductState({ productRoot: config.productRoot, productId });

    const products = await productsWithCounts();
    res.json({ product: products.find((candidate) => candidate.id === productId) });
  })
);

app.get(
  "/api/products/:productId/image/:kind/:filename",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const filename = req.params.filename as string;
    const scan = await scanProducts({ productRoot: config.productRoot });
    const filePath = await resolveProductImagePath({
      productRoot: config.productRoot,
      scan,
      products: scan.products,
      productId,
      kind: req.params.kind as "base" | "reference" | "generated" | "trash",
      filename
    });
    res.sendFile(filePath);
  })
);

app.get(
  "/api/products/:productId/thumbnail/:kind/:filename",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const filename = req.params.filename as string;
    const kind = req.params.kind as ThumbnailKind;
    if (kind !== "base" && kind !== "reference" && kind !== "generated" && kind !== "trash") {
      throw notFoundError("IMAGE_NOT_FOUND", "Thumbnail kind not found.");
    }

    const scan = await scanProducts({ productRoot: config.productRoot });
    const sourcePath = await resolveProductImagePath({
      productRoot: config.productRoot,
      scan,
      products: scan.products,
      productId,
      kind,
      filename
    });
    const thumbnailPath = await getOrCreateThumbnail({
      productRoot: config.productRoot,
      productId,
      kind,
      filename,
      sourcePath
    });

    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(thumbnailPath ?? sourcePath, { dotfiles: "allow" });
  })
);

app.post(
  "/api/products/:productId/generate",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const product = await assertReadyProduct(productId);
    const masterShots = await loadMasterShots({ productRoot: config.productRoot });
    const parsed = GenerateRequestSchema.parse(req.body);
    const shot = masterShots.shots.find((candidate) => candidate.id === parsed.shotId);
    if (!shot) throw notFoundError("UNKNOWN_SHOT", `Unknown shot: ${parsed.shotId}`);
    if (!product.baseImage) throw validationError("MISSING_BASE_IMAGE", "Missing base image.");

    const referenceImages = validateReferenceImages(product, parsed.referenceImages);
    const generated = await listProductGenerated(productId);
    const prepared = await prepareGeneration({ productId, productShape: product.shape, shot, prompt: parsed.prompt });
    const runId = makeRunId();
    const jobIds = enqueueBatch({
      runId,
      productId,
      shot,
      prompt: prepared.prompt,
      settings: parsed.settings,
      referenceImages,
      background: prepared.background,
      labelLogo: prepared.labelLogo,
      construction: prepared.construction,
      parentAssetId: null,
      batchSize: parsed.batchSize,
      attemptStart: nextAttemptForShot(generated, shot.id)
    });
    res.json({ runId, jobIds });
  })
);

app.post(
  "/api/products/:productId/generate-missing",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const product = await assertReadyProduct(productId);
    const parsed = BulkGenerateRequestSchema.parse(req.body);
    const referenceImages = validateReferenceImages(product, parsed.referenceImages);
    const masterShots = await loadMasterShots({ productRoot: config.productRoot });
    const generated = await listProductGenerated(productId);
    const selected = selectGenerateMissingShots({ shots: masterShots.shots, aggregates: generated.aggregates });
    assertNoRunningShots(productId, selected);
    const runId = makeRunId();
    const preparedShots = await Promise.all(
      selected.map(async (shot) => ({
        shot,
        prepared: await prepareGeneration({ productId, productShape: product.shape, shot, prompt: shot.prompt })
      }))
    );
    const jobIds = preparedShots.flatMap(({ shot, prepared }) =>
      enqueueBatch({
        runId,
        productId,
        shot,
        prompt: prepared.prompt,
        settings: parsed.settings,
        referenceImages,
        background: prepared.background,
        labelLogo: prepared.labelLogo,
        construction: prepared.construction,
        parentAssetId: null,
        batchSize: parsed.batchSize,
        attemptStart: nextAttemptForShot(generated, shot.id)
      })
    );
    res.json({ runId, jobIds });
  })
);

app.post(
  "/api/products/:productId/retry-failed",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const product = await assertReadyProduct(productId);
    const parsed = BulkGenerateRequestSchema.parse(req.body);
    const referenceImages = validateReferenceImages(product, parsed.referenceImages);
    const masterShots = await loadMasterShots({ productRoot: config.productRoot });
    const generated = await listProductGenerated(productId);
    const failed = generated.active.filter((asset) => asset.status === "failed");
    const requested = parsed.shotIds ? new Set<string>(parsed.shotIds) : null;
    const selectedFailed: AssetRecord[] = [];
    const seenShotIds = new Set<string>();
    for (const asset of failed) {
      if (seenShotIds.has(asset.shotId) || (requested && !requested.has(asset.shotId))) {
        continue;
      }
      seenShotIds.add(asset.shotId);
      selectedFailed.push(asset);
    }
    const selectedShots = selectedFailed
      .map((asset) => masterShots.shots.find((candidate) => candidate.id === asset.shotId))
      .filter((shot): shot is Shot => Boolean(shot));
    assertNoRunningShots(productId, selectedShots);
    const runId = makeRunId();
    const attemptStarts = new Map<string, number>();
    const preparedFailed = await Promise.all(
      selectedFailed.map(async (asset) => {
        const shot = masterShots.shots.find((candidate) => candidate.id === asset.shotId);
        if (!shot) return null;
        const background = asset.inputs.background ?? null;
        const labelLogo = requiresLabelLogo(asset.shotId) ? asset.inputs.labelLogo ?? null : null;
        const construction = asset.inputs.construction ?? null;
        if (requiresBackground(asset.shotId) && !background) {
          throw validationError("BACKGROUND_REQUIRED", `${asset.shotName} retry requires saved background metadata.`);
        }
        if (requiresLabelLogo(asset.shotId) && !labelLogo) {
          throw validationError("LABEL_LOGO_REQUIRED", `${asset.shotName} retry requires saved label-logo metadata.`);
        }
        return { asset, shot, background, labelLogo, construction };
      })
    );
    const jobIds = preparedFailed
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .flatMap(({ asset, shot, background, labelLogo, construction }) => {
        const attemptStart = attemptStarts.get(shot.id) ?? nextAttemptForShot(generated, shot.id);
        attemptStarts.set(shot.id, attemptStart + parsed.batchSize);
        return enqueueBatch({
          runId,
          productId,
          shot,
          prompt: asset.prompt,
          settings: parsed.settings,
          referenceImages,
          background,
          labelLogo,
          construction,
          parentAssetId: asset.assetId,
          batchSize: parsed.batchSize,
          attemptStart
        });
      });
    res.json({ runId, jobIds });
  })
);

app.post(
  "/api/products/:productId/generated/:assetId/accept",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const assetId = req.params.assetId as string;
    const { acceptAsset } = await import("./asset-store");
    res.json({ asset: await acceptAsset({ productRoot: config.productRoot, productId, assetId }) });
  })
);

app.post(
  "/api/products/:productId/generated/:assetId/reject",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const assetId = req.params.assetId as string;
    const { rejectAsset } = await import("./asset-store");
    res.json({ asset: await rejectAsset({ productRoot: config.productRoot, productId, assetId }) });
  })
);

app.post(
  "/api/products/:productId/generated/:assetId/retry",
  asyncRoute(async (req, res) => {
    const productId = req.params.productId as string;
    const assetId = req.params.assetId as string;
    const product = await assertReadyProduct(productId);
    const generated = await listProductGenerated(productId);
    const asset = [...generated.active, ...generated.trash].find((candidate) => candidate.assetId === assetId);
    if (!asset) throw notFoundError("ASSET_NOT_FOUND", "Asset not found.");
    const shot: Shot = {
      id: asset.shotId,
      name: asset.shotName,
      prompt: asset.prompt,
      defaultAspectRatio: asset.settings.aspectRatio,
      defaultImageSize: asset.settings.imageSize
    };
    const runId = makeRunId();
    const referenceImages = validateReferenceImages(product, asset.inputs.references);
    const background = asset.inputs.background ?? null;
    const labelLogo = requiresLabelLogo(asset.shotId) ? asset.inputs.labelLogo ?? null : null;
    const construction = asset.inputs.construction ?? null;
    if (requiresBackground(asset.shotId) && !background) {
      throw validationError("BACKGROUND_REQUIRED", `${asset.shotName} retry requires saved background metadata.`);
    }
    if (requiresLabelLogo(asset.shotId) && !labelLogo) {
      throw validationError("LABEL_LOGO_REQUIRED", `${asset.shotName} retry requires saved label-logo metadata.`);
    }
    const jobIds = enqueueBatch({
      runId,
      productId,
      shot,
      prompt: asset.prompt,
      settings: {
        aspectRatio: asset.settings.aspectRatio,
        imageSize: asset.settings.imageSize
      },
      referenceImages,
      background,
      labelLogo,
      construction,
      parentAssetId: asset.assetId,
      batchSize: 1,
      attemptStart: nextAttemptForShot(generated, asset.shotId)
    });
    res.json({ runId, jobIds });
  })
);

app.get("/api/jobs", (_req, res) => {
  res.json({ jobs: jobs.all() });
});

app.post("/api/jobs/:jobId/cancel", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    throw notFoundError("JOB_NOT_FOUND", "Job not found.");
  }

  const cancelled = jobs.cancel(req.params.jobId);
  activeAbortControllers.get(req.params.jobId)?.abort();
  if (!cancelled || cancelled.status !== "cancelled") {
    throw conflictError("JOB_NOT_CANCELABLE", `Job is already ${job.status}; it cannot be cancelled.`);
  }

  res.json({ job: cancelled });
});

app.use(errorMiddleware);

await ensureDir(config.productRoot);
await loadMasterShots({ productRoot: config.productRoot });
await loadRefineSettings({ productRoot: config.productRoot });
const persistedJobs = await loadPersistedJobs(config.productRoot);
jobs.restore(persistedJobs);
await savePersistedJobs(config.productRoot, jobs.all());
await resumeInterruptedShapeVariants();

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Product Shot Queue API listening on http://127.0.0.1:${config.port}`);
  console.log(`Product root: ${config.productRoot}`);
  console.log(`Provider mode: ${config.providerMode}`);
});
