import { resolveCutout } from "./main-image-cutouts";
import { DEFAULT_PREPARATION, type ExportPreparation, type MainImageSettings, type ExportPreview } from "../shared/export-preparation";
import { encodeExportImage, encodePreparedExportImage, prepareExportImage } from "./export-image-pipeline";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ZipArchive, type Archiver, type EntryData } from "archiver";
import sharp from "sharp";
import type {
  AssetRecord,
  ExportImageDimensions,
  GalleryExportEncoderSettings,
  GalleryExportImageReceipt,
  GalleryExportJob,
  GalleryExportReceipt,
  GalleryExportShapeReceipt,
  GalleryPreflight,
  GalleryPreflightIssue,
  GalleryPreflightShape,
  ProductSummary,
  Shot
} from "../shared/types";
import { generatedDir, getAssetRecord } from "./asset-store";
import { conflictError, notFoundError, validationError } from "./errors";
import { atomicWriteJson, ensureDir, regularFileExists, safeChildPath, sha256File } from "./fsUtils";
import { isGalleryEligibleAsset, loadGallerySelection, UTILITY_SHOT_IDS } from "./gallery-store";
import { loadMasterShots } from "./master-shots";
import { scanProducts } from "./scanner";
import { WorkScheduler } from "./work-scheduler";

const EXPORT_STATE_DIR = ".product-shot-queue";
const EXPORT_JOBS_DIR = "export-jobs";
const EXPORT_RECEIPTS_DIR = "export-receipts";
const MAX_SHOPIFY_BYTES = 20_971_520;
const MAX_SHOPIFY_DIMENSION = 4096;
const UNDERSIZED_WARNING_DIMENSION = 2048;
const conversionScheduler = new WorkScheduler(2, 16);
const inspectionScheduler = new WorkScheduler(1, 8);
const conversionCache = new Map<string, { file: string; sha256: string; info: { width: number; height: number }; bytes: number; touched: number }>();
const conversionCacheSession = `export_cache_${randomUUID()}`;
let conversionEncodes = 0;
let conversionHits = 0;
export function galleryConversionMetrics() { return { encodes: conversionEncodes, hits: conversionHits, entries: conversionCache.size }; }

async function pruneConversions() {
  let bytes = [...conversionCache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [key, entry] of conversionCache) {
    if (conversionCache.size <= 64 && bytes <= 256 * 1024 * 1024 && Date.now() - entry.touched < 10 * 60 * 1000) continue;
    conversionCache.delete(key); bytes -= entry.bytes;
    await fs.rm(entry.file, { force: true });
  }
}

export const GALLERY_EXPORT_ENCODER: GalleryExportEncoderSettings = {
  format: "webp",
  preset: "photo",
  quality: 90,
  effort: 6,
  smartSubsample: true,
  colourSpace: "srgb",
  maximumDimension: MAX_SHOPIFY_DIMENSION,
  maximumBytes: MAX_SHOPIFY_BYTES,
  withoutEnlargement: true,
  metadata: "stripped"
};

interface ResolvedExportItem {
  position: number;
  role: "main" | "generated";
  asset: AssetRecord | null;
  shotId: string;
  shotName: string;
  sourceFile: string;
  sourcePath: string;
  sourceDimensions: ExportImageDimensions;
  sourceBytes: number;
  sourceSha256: string;
}

interface InspectedShape {
  summary: GalleryPreflightShape;
  product: ProductSummary;
  items: ResolvedExportItem[];
}

interface BuildResult {
  receipt: GalleryExportReceipt;
  archivePath: string;
  tempDir: string;
}

type ProgressCallback = (progress: GalleryExportJob["progress"]) => void;

function exportStateDir(productRoot: string) {
  return path.join(productRoot, EXPORT_STATE_DIR);
}

function exportJobsDir(productRoot: string) {
  return path.join(exportStateDir(productRoot), EXPORT_JOBS_DIR);
}

function exportReceiptsDir(productRoot: string) {
  return path.join(exportStateDir(productRoot), EXPORT_RECEIPTS_DIR);
}

function receiptPath(productRoot: string, exportId: string) {
  return safeChildPath(exportReceiptsDir(productRoot), `${exportId}.json`);
}

function issue(
  product: ProductSummary,
  severity: GalleryPreflightIssue["severity"],
  code: string,
  message: string,
  assetId?: string
): GalleryPreflightIssue {
  return {
    code,
    severity,
    message,
    productId: product.id,
    familyId: product.familyId,
    shape: product.shape,
    ...(assetId ? { assetId } : {})
  };
}

function archiveSegment(value: string, fallback: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return normalized || fallback;
}

function timestampSlug(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function outputName(product: ProductSummary, item: ResolvedExportItem, format: "webp" | "png" = "webp") {
  const prefix = `${archiveSegment(product.familyId, "family")}-${product.shape}-${String(item.position).padStart(2, "0")}`;
  const suffix = item.role === "main" ? "main" : archiveSegment(item.shotId, "generated").replaceAll("_", "-");
  return `${prefix}-${suffix}.${format}`;
}

function orientedDimensions(metadata: { autoOrient: { width: number; height: number } }): ExportImageDimensions {
  return {
    width: metadata.autoOrient.width,
    height: metadata.autoOrient.height
  };
}

async function inspectImage(filePath: string) {
  const metadata = await sharp(filePath).metadata();
  const dimensions = orientedDimensions(metadata);
  if (!dimensions.width || !dimensions.height) throw new Error("Image dimensions are unavailable.");
  return { metadata, dimensions };
}

async function validateShopifyConversion(productRoot: string, sourcePath: string, sourceHash: string, preparation = DEFAULT_PREPARATION, main?: MainImageSettings, productId?: string) {
  return conversionScheduler.run(async () => {
  if (await sha256File(sourcePath) !== sourceHash) throw conflictError("CONTENT_CHANGED", "Source image changed during export checks.");
  const cutout = main?.cutoutId ? await resolveCutout(productRoot, productId!, main.cutoutId, sourceHash, true) : undefined;
  const key = createHash("sha256").update(JSON.stringify([productRoot, sourceHash, GALLERY_EXPORT_ENCODER, preparation.webp, preparation.outputFormat, main, cutout?.record.outputSha256])).digest("hex");
  await pruneConversions();
  const cached = conversionCache.get(key);
  if (cached) {
    try {
      const data = await fs.readFile(cached.file);
      if (createHash("sha256").update(data).digest("hex") === cached.sha256) {
        cached.touched = Date.now();
        conversionCache.delete(key); conversionCache.set(key, cached);
        conversionHits++;
        return { data, info: cached.info };
      }
    } catch { /* A missing cache file is recoverable; source is still verified. */ }
    conversionCache.delete(key);
    await fs.rm(cached.file, { force: true });
  }
  const cacheDirectory = path.join(exportJobsDir(productRoot), conversionCacheSession);
  await ensureDir(cacheDirectory);
  const snapshot = path.join(cacheDirectory, `${randomUUID()}.source`);
  await fs.copyFile(cutout?.file ?? sourcePath, snapshot);
  try {
  if (await sha256File(snapshot) !== (cutout?.record.outputSha256 ?? sourceHash)) throw conflictError("CONTENT_CHANGED", "Source image changed while preparing conversion.");
  conversionEncodes++;
  const { data, info } = await encodeExportImage(snapshot, preparation.webp, main, preparation.outputFormat);
  if (preparation.outputFormat !== "png" && data.byteLength >= MAX_SHOPIFY_BYTES) {
    throw new Error("Shopify WebP is 20 MB or larger.");
  }
  if (info.width !== info.height) throw new Error("Shopify WebP is not square.");
  const file = path.join(cacheDirectory, `${randomUUID()}.${preparation.outputFormat ?? "webp"}`);
  await fs.writeFile(file, data, { flag: "wx" });
  const previous = conversionCache.get(key);
  if (previous) await fs.rm(previous.file, { force: true });
  conversionCache.set(key, { file, sha256: createHash("sha256").update(data).digest("hex"), info: { width: info.width, height: info.height }, bytes: data.length, touched: Date.now() });
  await pruneConversions();
  return { data, info };
  } finally { await fs.rm(snapshot, { force: true }); }
  });
}

async function resolveItem(
  product: ProductSummary,
  position: number,
  role: ResolvedExportItem["role"],
  sourceFile: string,
  sourcePath: string,
  asset: AssetRecord | null
): Promise<ResolvedExportItem> {
  const stat = await fs.lstat(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Image is not a regular file.");
  const { dimensions } = await inspectImage(sourcePath);
  return {
    position,
    role,
    asset,
    shotId: asset?.shotId ?? "main",
    shotName: asset?.shotName ?? "Main image",
    sourceFile,
    sourcePath,
    sourceDimensions: dimensions,
    sourceBytes: stat.size,
    sourceSha256: await sha256File(sourcePath)
  };
}

async function inspectShape({
  productRoot,
  product,
  masterShots,
  preparation = DEFAULT_PREPARATION
}: {
  productRoot: string;
  product: ProductSummary;
  masterShots: Shot[];
  preparation?: ExportPreparation;
}): Promise<InspectedShape> {
  const issues: GalleryPreflightIssue[] = [];
  const items: ResolvedExportItem[] = [];
  let selectionAssetIds: string[] = [];
  let galleryRevision = 0;
  let exportReady = false;

  if (product.status !== "ready" || !product.baseImage) {
    issues.push(issue(product, "blocker", "INVALID_MAIN_IMAGE", product.errors[0] ?? "A valid base.* main image is required."));
  } else {
    const basePath = safeChildPath(path.join(productRoot, product.id), product.baseImage);
    try {
      if (!(await regularFileExists(basePath))) throw new Error("Main image file is missing.");
      items.push(await resolveItem(product, 1, "main", product.baseImage, basePath, null));
    } catch (error) {
      issues.push(issue(product, "blocker", "UNREADABLE_MAIN_IMAGE", error instanceof Error ? error.message : "Main image is unreadable."));
    }
  }

  try {
    const gallery = await loadGallerySelection({ productRoot, productId: product.id, verifyContent: true });
    selectionAssetIds = gallery.assetIds;
    galleryRevision = gallery.revision;
    exportReady = gallery.exportReady;
  } catch (error) {
    issues.push(issue(product, "blocker", "INVALID_GALLERY_SELECTION", error instanceof Error ? error.message : "Gallery selection is invalid."));
  }

  const selectedAssets: AssetRecord[] = [];

  for (const [index, assetId] of (preparation.outputFormat === "png" ? [] : selectionAssetIds).entries()) {
    let activeAsset: AssetRecord | undefined;
    let rejectedAsset: AssetRecord | undefined;
    try {
      const found = await getAssetRecord({ productRoot, productId: product.id, assetId });
      if (found.asset.productId !== product.id) throw new Error("Asset belongs to another product.");
      if (found.location === "trash") rejectedAsset = found.asset;
      else activeAsset = found.asset;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ASSET_NOT_FOUND")) {
        issues.push(issue(product, "blocker", "UNREADABLE_GALLERY_ASSET", error instanceof Error ? error.message : "Selected asset metadata is unreadable.", assetId));
        continue;
      }
    }
    if (!activeAsset) {
      issues.push(issue(
        product,
        "blocker",
        rejectedAsset ? "REJECTED_GALLERY_ASSET" : "MISSING_GALLERY_ASSET",
        rejectedAsset ? `${rejectedAsset.shotName} was rejected.` : `Gallery image ${assetId} no longer exists.`,
        assetId
      ));
      continue;
    }
    if (UTILITY_SHOT_IDS.has(activeAsset.shotId) || activeAsset.inputs.shapeVariant) {
      issues.push(issue(product, "blocker", "UTILITY_GALLERY_ASSET", `${activeAsset.shotName} is a construction output and cannot be exported.`, assetId));
      continue;
    }
    if (!isGalleryEligibleAsset(activeAsset)) {
      issues.push(issue(product, "blocker", "UNACCEPTED_GALLERY_ASSET", `${activeAsset.shotName} is not accepted.`, assetId));
      continue;
    }
    if (!activeAsset.output?.file) {
      issues.push(issue(product, "blocker", "MISSING_GALLERY_FILE", `${activeAsset.shotName} has no image output.`, assetId));
      continue;
    }
    try {
      const sourcePath = safeChildPath(generatedDir(productRoot, product.id), activeAsset.output.file);
      if (!(await regularFileExists(sourcePath))) throw new Error("Image file is missing.");
      items.push(await resolveItem(product, index + 2, "generated", activeAsset.output.file, sourcePath, activeAsset));
      selectedAssets.push(activeAsset);
    } catch (error) {
      issues.push(issue(product, "blocker", "UNREADABLE_GALLERY_FILE", `${activeAsset.shotName}: ${error instanceof Error ? error.message : "Image is unreadable."}`, assetId));
    }
  }

  const masterShotIds = new Set(masterShots.map((shot) => shot.id));
  const selectedShotIds = new Set(selectedAssets.map((asset) => asset.shotId));
  if (selectionAssetIds.length === 0) issues.push(issue(product, "warning", "BASE_ONLY_GALLERY", "Base-only gallery: no generated shots selected."));
  for (const shot of preparation.outputFormat !== "png" && selectionAssetIds.length ? masterShots : []) {
    if (!selectedShotIds.has(shot.id)) {
      issues.push(issue(product, "warning", "MISSING_MASTER_SHOT", `${shot.name} is not selected.`));
    }
  }
  for (const asset of selectedAssets) {
    if (!masterShotIds.has(asset.shotId)) {
      issues.push(issue(product, "warning", "LEGACY_SHOT", `${asset.shotName} is not in the current master-shot set.`, asset.assetId));
    }
  }
  const shotCounts = new Map<string, number>();
  for (const asset of selectedAssets) shotCounts.set(asset.shotId, (shotCounts.get(asset.shotId) ?? 0) + 1);
  for (const [shotId, count] of shotCounts) {
    if (count > 1) {
      const shotName = selectedAssets.find((asset) => asset.shotId === shotId)?.shotName ?? shotId;
      issues.push(issue(product, "warning", "DUPLICATE_MASTER_SHOT", `${count} selected images use ${shotName}.`));
    }
  }

  for (const item of items) {
    const mainSettings = item.role === "main" ? preparation.mainImages[product.id] : undefined;
    if ((mainSettings?.transparent || preparation.outputFormat === "png") && !mainSettings?.cutoutId) {
      issues.push(issue(product, "blocker", "CUTOUT_REQUIRED", "Remove the main-image background and approve the cutout before transparent export."));
      continue;
    }
    if (mainSettings && mainSettings.reviewedSourceSha256 !== item.sourceSha256) {
      issues.push(issue(product, "blocker", "MAIN_REVIEW_REQUIRED", "Main image changed or has not been approved. Preview and approve its export preparation."));
      continue;
    }
    if (item.sourceDimensions.width !== item.sourceDimensions.height && !(item.role === "main" && preparation.mainImages[product.id]?.frame)) {
      issues.push(issue(product, "blocker", "NON_SQUARE_IMAGE", `${item.shotName} is ${item.sourceDimensions.width}×${item.sourceDimensions.height}; square images are required.`, item.asset?.assetId));
      continue;
    }
    if (item.sourceDimensions.width < UNDERSIZED_WARNING_DIMENSION) {
      issues.push(issue(product, "warning", "UNDERSIZED_IMAGE", `${item.shotName} is ${item.sourceDimensions.width}px and will not be upscaled.`, item.asset?.assetId));
    }
    try {
      // Preflight checks source identity, dimensions and approval only. Encoding here
      // stalls large selections and evicts the bounded cache before build can reuse it.
      if (mainSettings?.cutoutId) {
        await resolveCutout(productRoot, product.id, mainSettings.cutoutId, item.sourceSha256, true);
      }
    } catch (error) {
      issues.push(issue(product, "blocker", "SHOPIFY_CONVERSION_FAILED", `${item.shotName}: ${error instanceof Error ? error.message : "Shopify conversion failed."}`, item.asset?.assetId));
    }
  }

  const summary: GalleryPreflightShape = {
    productId: product.id,
    familyId: product.familyId,
    shape: product.shape,
    status: issues.some((candidate) => candidate.severity === "blocker") ? "skipped" : "ready",
    itemCount: preparation.outputFormat === "png" ? 1 : 1 + selectionAssetIds.length,
    galleryRevision,
    exportReady,
    contentFingerprint: createHash("sha256").update(JSON.stringify({ preparation, galleryRevision, selectionAssetIds, sources: items.map((item) => [item.sourceFile, item.sourceSha256]) })).digest("hex"),
    issues
  };
  return { summary, product, items };
}

async function inspectGalleryExport(productRoot: string, productIds: string[], signal?: AbortSignal, preparation = DEFAULT_PREPARATION) {
  signal?.throwIfAborted();
  if (new Set(productIds).size !== productIds.length) {
    throw validationError("DUPLICATE_PRODUCT_SELECTION", "Each product shape can be selected only once.");
  }
  const scan = await scanProducts({ productRoot });
  const byId = new Map(scan.products.map((product) => [product.id, product]));
  const products = productIds.map((productId) => {
    const product = byId.get(productId);
    if (!product) throw notFoundError("UNKNOWN_PRODUCT", `Unknown product: ${productId}`);
    return product;
  });
  const masterShots = (await loadMasterShots({ productRoot })).shots;
  return inspectionScheduler.run(async () => {
    const inspected: InspectedShape[] = [];
    for (const product of products) {
      signal?.throwIfAborted();
      inspected.push(await inspectShape({ productRoot, product, masterShots, preparation }));
    }
    signal?.throwIfAborted();
    return inspected;
  }, signal);
}

export async function preflightGalleryExport({
  productRoot,
  productIds,
  preparation = DEFAULT_PREPARATION
}: {
  productRoot: string;
  productIds: string[];
  preparation?: ExportPreparation;
}): Promise<GalleryPreflight> {
  const inspected = await inspectGalleryExport(productRoot, productIds, undefined, preparation);
  const shapes = inspected.map((candidate) => candidate.summary);
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    productIds: [...productIds],
    shapes,
    readyCount: shapes.filter((shape) => shape.status === "ready").length,
    skippedCount: shapes.filter((shape) => shape.status === "skipped").length
  };
}

async function writeShopifyFile(productRoot: string, item: ResolvedExportItem, outputPath: string, preparation: ExportPreparation, main?: MainImageSettings, productId?: string) {
  const { data, info } = await validateShopifyConversion(productRoot, item.sourcePath, item.sourceSha256, preparation, main, productId);
  await fs.writeFile(outputPath, data, { flag: "wx" });
  const outputDimensions = { width: info.width, height: info.height };
  return {
    outputDimensions,
    outputBytes: data.byteLength,
    outputSha256: await sha256File(outputPath)
  };
}

async function finalizeArchive(archive: Archiver, output: ReturnType<typeof createWriteStream>) {
  await new Promise<void>((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    archive.once("error", reject);
    void archive.finalize();
  });
}

export async function buildGalleryExport({
  productRoot,
  productIds,
  expectedFingerprints,
  preparation = DEFAULT_PREPARATION,
  signal,
  exportId = `export_${randomUUID()}`,
  onProgress = () => undefined
}: {
  productRoot: string;
  productIds: string[];
  expectedFingerprints?: Record<string, string>;
  preparation?: ExportPreparation;
  signal?: AbortSignal;
  exportId?: string;
  onProgress?: ProgressCallback;
}): Promise<BuildResult> {
  const createdAt = new Date().toISOString();
  const inspected = await inspectGalleryExport(productRoot, productIds, signal, preparation);
  for (const candidate of inspected) {
    if (expectedFingerprints && expectedFingerprints[candidate.product.id] !== candidate.summary.contentFingerprint) {
      candidate.summary.status = "skipped";
      candidate.summary.issues.push(issue(candidate.product, "blocker", "CONTENT_CHANGED", "Gallery or image content changed after preflight. Review it and run preflight again."));
    }
  }
  const ready = inspected.filter((candidate) => candidate.summary.status === "ready");
  if (ready.length === 0) {
    const contentChanged = inspected.some((candidate) => candidate.summary.issues.some((entry) => entry.code === "CONTENT_CHANGED"));
    throw validationError("NO_EXPORTABLE_SHAPES", contentChanged ? "Gallery changed after preflight. Review it and run preflight again." : "No selected shapes passed preflight.", inspected.map((candidate) => candidate.summary));
  }

  const tempDir = safeChildPath(exportJobsDir(productRoot), exportId);
  await ensureDir(tempDir);
  const workDir = path.join(tempDir, "shopify");
  await ensureDir(workDir);
  const archiveFilename = `rugs-nsm-${preparation.outputFormat === "png" ? "room-viewer-png" : "export"}-${timestampSlug(new Date(createdAt))}.zip`;
  const archivePath = safeChildPath(tempDir, archiveFilename);
  const total = ready.reduce((sum, candidate) => sum + candidate.items.length * 3, 1);
  let completed = 0;
  const report = (message: string) => onProgress({ completed, total, message });
  report(preparation.outputFormat === "png" ? "Preparing transparent room-viewer PNGs" : "Preparing Shopify images");

  const receiptShapes: GalleryExportShapeReceipt[] = [];
  const fileEntries: Array<{ sourcePath: string; archivePath: string }> = [];
  for (const candidate of inspected) {
    if (candidate.summary.status === "skipped") {
      receiptShapes.push({
        productId: candidate.product.id,
        familyId: candidate.product.familyId,
        shape: candidate.product.shape,
        exportReady: candidate.summary.exportReady,
        galleryRevision: candidate.summary.galleryRevision,
        status: "skipped",
        issues: candidate.summary.issues,
        images: []
      });
      continue;
    }

    const familySegment = archiveSegment(candidate.product.familyId, "family");
    const shapeSegment = candidate.product.shape;
    const imageReceipts: GalleryExportImageReceipt[] = [];
    for (const item of candidate.items) {
      signal?.throwIfAborted();
      // Freeze byte-identical originals before conversion/archive reads can race a main replacement.
      const originalSnapshot = safeChildPath(workDir, `${candidate.product.id}-${item.position}-original-${item.sourceFile}`);
      await fs.copyFile(item.sourcePath, originalSnapshot);
      if (await sha256File(originalSnapshot) !== item.sourceSha256) throw conflictError("CONTENT_CHANGED", "An image changed during export. Run preflight again.");
      const shopifyFilename = outputName(candidate.product, item, preparation.outputFormat);
      const stagedName = `${candidate.product.id}-${item.position}-${shopifyFilename}`;
      const stagedPath = safeChildPath(workDir, stagedName);
      const mainSettings = item.role === "main" ? preparation.mainImages[candidate.product.id] : undefined;
      const exportSettings = mainSettings && preparation.outputFormat === "png" ? { ...mainSettings, transparent: true } : mainSettings;
      const converted = await writeShopifyFile(productRoot, { ...item, sourcePath: originalSnapshot }, stagedPath, preparation, exportSettings, candidate.product.id);
      signal?.throwIfAborted();
      const originalArchivePath = `${familySegment}/${shapeSegment}/originals/${item.sourceFile}`;
      const shopifyArchivePath = `${familySegment}/${shapeSegment}/${preparation.outputFormat === "png" ? "room-viewer" : "shopify"}/${shopifyFilename}`;
      imageReceipts.push({
        position: item.position,
        role: item.role,
        assetId: item.asset?.assetId ?? null,
        shotId: item.shotId,
        shotName: item.shotName,
        sourceFile: item.sourceFile,
        originalFilename: originalArchivePath,
        shopifyFilename: shopifyArchivePath,
        sourceDimensions: item.sourceDimensions,
        outputDimensions: converted.outputDimensions,
        sourceBytes: item.sourceBytes,
        outputBytes: converted.outputBytes,
        sourceSha256: item.sourceSha256,
        outputSha256: converted.outputSha256
      });
      fileEntries.push({ sourcePath: originalSnapshot, archivePath: originalArchivePath });
      fileEntries.push({ sourcePath: stagedPath, archivePath: shopifyArchivePath });
      completed += 1;
      report(`Optimized ${shopifyFilename}`);
    }
    receiptShapes.push({
      productId: candidate.product.id,
      familyId: candidate.product.familyId,
      shape: candidate.product.shape,
      exportReady: candidate.summary.exportReady,
      galleryRevision: candidate.summary.galleryRevision,
      status: "included",
      issues: candidate.summary.issues,
      images: imageReceipts
    });
  }

  const completedAt = new Date().toISOString();
  const selectedFamilies = new Set(inspected.map((candidate) => candidate.product.familyId));
  const selectedIds = new Set(productIds);
  const notSelectedShapes = (await scanProducts({ productRoot })).products
    .filter((product) => selectedFamilies.has(product.familyId) && !selectedIds.has(product.id))
    .map((product) => ({ productId: product.id, familyId: product.familyId, shape: product.shape }));
  const manifest = {
    version: 1 as const,
    exportId,
    archiveFilename,
    createdAt,
    completedAt,
    requestedProductIds: [...productIds],
    notSelectedShapes,
    encoder: preparation.outputFormat === "png" ? {
      format: "png" as const, lossless: true, colourSpace: "srgb" as const,
      maximumDimension: preparation.webp.maximumDimension, maximumBytes: null,
      withoutEnlargement: true as const, metadata: "stripped" as const
    } : { ...GALLERY_EXPORT_ENCODER, ...preparation.webp },
    preparation,
    shapes: receiptShapes,
    includedShapes: receiptShapes.filter((shape) => shape.status === "included").length,
    skippedShapes: receiptShapes.filter((shape) => shape.status === "skipped").length
  };
  const output = createWriteStream(archivePath, { flags: "wx" });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(output);
  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: "export-manifest.json" });
  for (const entry of fileEntries) archive.file(entry.sourcePath, { name: entry.archivePath });
  archive.on("entry", (entry: EntryData) => {
    if (entry.name === "export-manifest.json") return;
    completed += 1;
    report(`Packed ${entry.name}`);
  });
  await finalizeArchive(archive, output);
  signal?.throwIfAborted();
  completed = total;
  report("ZIP ready to download");

  const archiveStat = await fs.stat(archivePath);
  const receipt: GalleryExportReceipt = {
    ...manifest,
    downloadedAt: null,
    archiveBytes: archiveStat.size,
    archiveSha256: await sha256File(archivePath)
  };
  await ensureDir(exportReceiptsDir(productRoot));
  await atomicWriteJson(receiptPath(productRoot, exportId), receipt);
  return { receipt, archivePath, tempDir };
}

export async function listGalleryExportReceipts(productRoot: string): Promise<GalleryExportReceipt[]> {
  const dir = exportReceiptsDir(productRoot);
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const receipts: GalleryExportReceipt[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      receipts.push(JSON.parse(await fs.readFile(path.join(dir, entry.name), "utf8")) as GalleryExportReceipt);
    } catch {
      // Ignore a corrupt historical receipt while keeping the rest of history usable.
    }
  }
  return receipts.sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
}

export async function cleanupGalleryExportJobs(productRoot: string) {
  const dir = exportJobsDir(productRoot);
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("export_")).map((entry) => fs.rm(path.join(dir, entry.name), { recursive: true, force: true })));
}

export class GalleryExportRegistry {
  private readonly jobs = new Map<string, GalleryExportJob>();
  private readonly builds = new Map<string, BuildResult>();
  private readonly buildScheduler = new WorkScheduler(1, 3);
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly productRoot: string, private readonly maxOutstanding = 8, private readonly retainedByteThreshold = 2 * 1024 ** 3) {
    if (!Number.isSafeInteger(maxOutstanding) || maxOutstanding < 1 || !Number.isSafeInteger(retainedByteThreshold) || retainedByteThreshold < 1) throw new Error("Invalid export admission limits");
  }

  private assertArchiveCapacity() {
    const retainedBytes = [...this.builds.values()].reduce((sum, build) => sum + build.receipt.archiveBytes, 0);
    if (retainedBytes >= this.retainedByteThreshold) throw conflictError("EXPORT_DOWNLOAD_REQUIRED", "Undownloaded ZIPs have reached the export storage threshold. Download an existing export before building another. Existing ZIPs were preserved.");
  }

  start(productIds: string[], expectedFingerprints?: Record<string, string>, preparation = DEFAULT_PREPARATION) {
    if (this.buildScheduler.active && this.buildScheduler.queued >= 3) throw conflictError("EXPORT_QUEUE_FULL", "Three exports are already waiting. Wait for an export to finish before starting another.");
    this.assertArchiveCapacity();
    const outstanding = [...this.jobs.values()].filter(job => ["queued", "building", "ready"].includes(job.status)).length;
    if (outstanding >= this.maxOutstanding) throw conflictError("EXPORT_DOWNLOAD_REQUIRED", "Too many exports are awaiting download. Download an existing export before starting another. Existing ZIPs were preserved.");
    const exportId = `export_${randomUUID()}`;
    const controller = new AbortController();
    this.controllers.set(exportId, controller);
    const selectedPreparation = structuredClone(preparation);
    const selectedProducts = [...productIds];
    const selectedFingerprints = expectedFingerprints ? { ...expectedFingerprints } : undefined;
    const now = new Date().toISOString();
    const job: GalleryExportJob = {
      exportId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      archiveFilename: null,
      progress: { completed: 0, total: 1, message: this.buildScheduler.active ? `Queued behind ${this.buildScheduler.queued + 1} export(s)` : "Queued" },
      error: null,
      receipt: null
    };
    this.jobs.set(exportId, job);
    // Freeze caller input while queued; later UI selection changes cannot retarget a build.
    void this.buildScheduler.run(() => this.run(exportId, selectedProducts, selectedFingerprints, controller.signal, selectedPreparation), controller.signal).catch(error => {
      this.jobs.set(exportId, { ...job, status: controller.signal.aborted ? "cancelled" : "failed", error: controller.signal.aborted ? null : error instanceof Error ? error.message : "Export failed.", progress: { ...job.progress, message: controller.signal.aborted ? "Export cancelled" : "Export failed" } });
    }).finally(() => { this.controllers.delete(exportId); this.pruneCompleted(); });
    return structuredClone(job);
  }

  get(exportId: string) {
    const job = this.jobs.get(exportId);
    if (!job) throw notFoundError("EXPORT_JOB_NOT_FOUND", "Export job not found.");
    return structuredClone(job);
  }

  availableDownloads() {
    return [...this.builds.values()].map(({ receipt }) => ({
      exportId: receipt.exportId, archiveFilename: receipt.archiveFilename,
      archiveBytes: receipt.archiveBytes, completedAt: receipt.completedAt,
      includedShapes: receipt.includedShapes, skippedShapes: receipt.skippedShapes
    }));
  }

  private pruneCompleted() {
    const completed = [...this.jobs.values()].filter(job => job.status === "downloaded" || job.status === "failed" || job.status === "cancelled");
    for (const job of completed.slice(0, Math.max(0, completed.length - 200))) this.jobs.delete(job.exportId);
  }

  /** Counts only: diagnostics must not allocate/serialize all retained receipts. */
  retentionStats() {
    let receiptImages = 0;
    let receiptShapes = 0;
    for (const job of this.jobs.values()) {
      for (const shape of job.receipt?.shapes ?? []) {
        receiptShapes++;
        receiptImages += shape.images.length;
      }
    }
    return { jobs: this.jobs.size, readyArchives: this.builds.size, receiptShapes, receiptImages,
      controllers: this.controllers.size, active: this.buildScheduler.active, queued: this.buildScheduler.queued,
      conversionEntries: conversionCache.size };
  }

  cancel(exportId: string) {
    const job = this.get(exportId);
    if (job.status !== "queued" && job.status !== "building") return job;
    this.controllers.get(exportId)?.abort(new Error("Export cancelled"));
    this.jobs.set(exportId, { ...job, updatedAt: new Date().toISOString(), progress: { ...job.progress, message: "Cancellation requested; finishing current image safely" } });
    return this.get(exportId);
  }

  download(exportId: string) {
    const job = this.jobs.get(exportId);
    const build = this.builds.get(exportId);
    if (!job || !build) throw notFoundError("EXPORT_ARCHIVE_NOT_FOUND", "Export archive is no longer available.");
    if (job.status !== "ready") throw conflictError("EXPORT_NOT_READY", `Export is ${job.status}.`);
    return { archivePath: build.archivePath, archiveFilename: build.receipt.archiveFilename };
  }

  async markDownloaded(exportId: string) {
    const job = this.jobs.get(exportId);
    const build = this.builds.get(exportId);
    if (!job || !build || job.status !== "ready") return;
    const downloadedAt = new Date().toISOString();
    const receipt = { ...build.receipt, downloadedAt };
    await atomicWriteJson(receiptPath(this.productRoot, exportId), receipt);
    await fs.rm(build.tempDir, { recursive: true, force: true });
    this.builds.delete(exportId);
    this.jobs.set(exportId, {
      ...job,
      status: "downloaded",
      updatedAt: downloadedAt,
      progress: { ...job.progress, message: "Downloaded; temporary ZIP removed" },
      // The authoritative receipt is persisted above. Keep terminal status light;
      // the status API loads receipt details only when a client requests them.
      receipt: null
    });
    this.pruneCompleted();
  }

  private async run(exportId: string, productIds: string[], expectedFingerprints?: Record<string, string>, signal?: AbortSignal, preparation = DEFAULT_PREPARATION) {
    const current = this.jobs.get(exportId);
    if (!current) return;
    this.jobs.set(exportId, { ...current, status: "building", updatedAt: new Date().toISOString(), progress: { completed: 0, total: 1, message: "Preflighting selection" } });
    try {
      // Another queued build may have crossed the threshold after admission.
      // A single large export remains allowed; this is a between-build limit,
      // not an image-size restriction or permission to remove a ready archive.
      this.assertArchiveCapacity();
      const build = await buildGalleryExport({
        productRoot: this.productRoot,
        productIds,
        expectedFingerprints,
        preparation,
        signal,
        exportId,
        onProgress: (progress) => {
          const job = this.jobs.get(exportId);
          if (job) this.jobs.set(exportId, { ...job, updatedAt: new Date().toISOString(), progress });
        }
      });
      signal?.throwIfAborted();
      this.builds.set(exportId, build);
      const job = this.jobs.get(exportId) as GalleryExportJob;
      this.jobs.set(exportId, {
        ...job,
        status: "ready",
        updatedAt: new Date().toISOString(),
        archiveFilename: build.receipt.archiveFilename,
        error: null,
        receipt: build.receipt
      });
    } catch (error) {
      await fs.rm(safeChildPath(exportJobsDir(this.productRoot), exportId), { recursive: true, force: true }).catch(() => undefined);
      if (signal?.aborted) await fs.rm(receiptPath(this.productRoot, exportId), { force: true }).catch(() => undefined);
      const job = this.jobs.get(exportId) as GalleryExportJob;
      this.jobs.set(exportId, {
        ...job,
        status: signal?.aborted ? "cancelled" : "failed",
        updatedAt: new Date().toISOString(),
        error: signal?.aborted ? null : error instanceof Error ? error.message : "Export failed.",
        progress: { ...job.progress, message: signal?.aborted ? "Export cancelled; temporary files removed" : "Export failed" }
      });
    } finally {
      this.pruneCompleted();
    }
  }
}


export async function previewGalleryExportImage(productRoot: string, productId: string, assetId: string | undefined, preparation: ExportPreparation, purpose: "layout" | "webp" = "webp"): Promise<ExportPreview> {
  const product = (await scanProducts({ productRoot, productId })).products.find(product => product.id === productId);
  if (!product) throw notFoundError("UNKNOWN_PRODUCT", "Unknown product.");
  let sourcePath: string;
  if (assetId) {
    const gallery = await loadGallerySelection({ productRoot, productId, verifyContent: true });
    if (!gallery.assetIds.includes(assetId)) throw validationError("IMAGE_NOT_SELECTED", "Choose an image included in this gallery.");
    const { asset, location } = await getAssetRecord({ productRoot, productId, assetId });
    if (location !== "generated" || !isGalleryEligibleAsset(asset) || !asset.output?.file) throw validationError("INVALID_PREVIEW_IMAGE", "Choose an accepted gallery image.");
    sourcePath = safeChildPath(generatedDir(productRoot, productId), asset.output.file);
  } else {
    if (!product.baseImage) throw validationError("MISSING_MAIN_IMAGE", "Main image is missing.");
    sourcePath = safeChildPath(path.join(productRoot, productId), product.baseImage);
  }
  if (!(await regularFileExists(sourcePath))) throw validationError("INVALID_PREVIEW_IMAGE", "Image is not a regular file.");
  return conversionScheduler.run(async () => {
    const source = await fs.readFile(sourcePath);
    const main = assetId ? undefined : preparation.mainImages[productId];
    const exportMain = main && preparation.outputFormat === "png" ? { ...main, transparent: true } : main;
    const sourceHash = createHash("sha256").update(source).digest("hex");
    const cutout = main?.cutoutId ? await resolveCutout(productRoot, productId, main.cutoutId, sourceHash, false) : undefined;
    const imageSource = cutout ? await fs.readFile(cutout.file) : source;
    const prepared = await prepareExportImage(imageSource, exportMain);
    if (purpose === "layout") {
      const { data, info } = await sharp(prepared).resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
      const image = `data:image/png;base64,${data.toString("base64")}`;
      return { image, reference: "", sourceBytes: source.length, outputBytes: data.length, width: info.width, height: info.height, sourceSha256: sourceHash };
    }
    const { data, info } = await encodePreparedExportImage(prepared, preparation.webp, preparation.outputFormat);
    const reference = await sharp(prepared).resize({ width: info.width, height: info.height, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return { image: `data:image/${preparation.outputFormat ?? "webp"};base64,${data.toString("base64")}`, reference: `data:image/png;base64,${reference.toString("base64")}`, sourceBytes: source.length, outputBytes: data.length, width: info.width, height: info.height, sourceSha256: createHash("sha256").update(source).digest("hex") };
  });
}
