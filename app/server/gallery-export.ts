import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
import { generatedDir, listGeneratedAssets } from "./asset-store";
import { conflictError, notFoundError, validationError } from "./errors";
import { atomicWriteJson, ensureDir, regularFileExists, safeChildPath, sha256File } from "./fsUtils";
import { isGalleryEligibleAsset, loadGallerySelection, UTILITY_SHOT_IDS } from "./gallery-store";
import { loadMasterShots } from "./master-shots";
import { scanProducts } from "./scanner";

const EXPORT_STATE_DIR = ".product-shot-queue";
const EXPORT_JOBS_DIR = "export-jobs";
const EXPORT_RECEIPTS_DIR = "export-receipts";
const MAX_SHOPIFY_BYTES = 20_971_520;
const MAX_SHOPIFY_DIMENSION = 4096;
const UNDERSIZED_WARNING_DIMENSION = 2048;

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

function outputName(product: ProductSummary, item: ResolvedExportItem) {
  const prefix = `${archiveSegment(product.familyId, "family")}-${product.shape}-${String(item.position).padStart(2, "0")}`;
  const suffix = item.role === "main" ? "main" : archiveSegment(item.shotId, "generated").replaceAll("_", "-");
  return `${prefix}-${suffix}.webp`;
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

function shopifyPipeline(sourcePath: string) {
  return sharp(sourcePath, { failOn: "error" })
    .autoOrient()
    .toColourspace("srgb")
    .resize({
      width: MAX_SHOPIFY_DIMENSION,
      height: MAX_SHOPIFY_DIMENSION,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({ preset: "photo", quality: 90, effort: 6, smartSubsample: true });
}

async function validateShopifyConversion(sourcePath: string) {
  const { data, info } = await shopifyPipeline(sourcePath).toBuffer({ resolveWithObject: true });
  if (data.byteLength >= MAX_SHOPIFY_BYTES) {
    throw new Error("Shopify WebP is 20 MB or larger.");
  }
  if (info.width !== info.height) throw new Error("Shopify WebP is not square.");
  return { data, info };
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
  masterShots
}: {
  productRoot: string;
  product: ProductSummary;
  masterShots: Shot[];
}): Promise<InspectedShape> {
  const issues: GalleryPreflightIssue[] = [];
  const items: ResolvedExportItem[] = [];
  let selectionAssetIds: string[] = [];

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
    selectionAssetIds = (await loadGallerySelection({ productRoot, productId: product.id })).assetIds;
  } catch (error) {
    issues.push(issue(product, "blocker", "INVALID_GALLERY_SELECTION", error instanceof Error ? error.message : "Gallery selection is invalid."));
  }

  if (selectionAssetIds.length === 0) {
    issues.push(issue(product, "blocker", "NO_SELECTED_GENERATION", "Select at least one accepted generated image."));
  }

  let active: AssetRecord[] = [];
  let trash: AssetRecord[] = [];
  try {
    const generated = await listGeneratedAssets({ productRoot, productId: product.id });
    active = generated.active;
    trash = generated.trash;
  } catch (error) {
    issues.push(issue(product, "blocker", "UNREADABLE_GENERATED_ASSETS", error instanceof Error ? error.message : "Generated assets are unreadable."));
  }
  const activeById = new Map(active.map((asset) => [asset.assetId, asset]));
  const trashById = new Map(trash.map((asset) => [asset.assetId, asset]));
  const selectedAssets: AssetRecord[] = [];

  for (const [index, assetId] of selectionAssetIds.entries()) {
    const activeAsset = activeById.get(assetId);
    const rejectedAsset = trashById.get(assetId);
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
  for (const shot of masterShots) {
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
    if (item.sourceDimensions.width !== item.sourceDimensions.height) {
      issues.push(issue(product, "blocker", "NON_SQUARE_IMAGE", `${item.shotName} is ${item.sourceDimensions.width}×${item.sourceDimensions.height}; square images are required.`, item.asset?.assetId));
      continue;
    }
    if (item.sourceDimensions.width < UNDERSIZED_WARNING_DIMENSION) {
      issues.push(issue(product, "warning", "UNDERSIZED_IMAGE", `${item.shotName} is ${item.sourceDimensions.width}px and will not be upscaled.`, item.asset?.assetId));
    }
    try {
      await validateShopifyConversion(item.sourcePath);
    } catch (error) {
      issues.push(issue(product, "blocker", "SHOPIFY_CONVERSION_FAILED", `${item.shotName}: ${error instanceof Error ? error.message : "Shopify conversion failed."}`, item.asset?.assetId));
    }
  }

  const summary: GalleryPreflightShape = {
    productId: product.id,
    familyId: product.familyId,
    shape: product.shape,
    status: issues.some((candidate) => candidate.severity === "blocker") ? "skipped" : "ready",
    itemCount: 1 + selectionAssetIds.length,
    issues
  };
  return { summary, product, items };
}

async function inspectGalleryExport(productRoot: string, productIds: string[]) {
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
  return Promise.all(products.map((product) => inspectShape({ productRoot, product, masterShots })));
}

export async function preflightGalleryExport({
  productRoot,
  productIds
}: {
  productRoot: string;
  productIds: string[];
}): Promise<GalleryPreflight> {
  const inspected = await inspectGalleryExport(productRoot, productIds);
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

async function writeShopifyFile(item: ResolvedExportItem, outputPath: string) {
  const { data, info } = await validateShopifyConversion(item.sourcePath);
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
  exportId = `export_${randomUUID()}`,
  onProgress = () => undefined
}: {
  productRoot: string;
  productIds: string[];
  exportId?: string;
  onProgress?: ProgressCallback;
}): Promise<BuildResult> {
  const createdAt = new Date().toISOString();
  const inspected = await inspectGalleryExport(productRoot, productIds);
  const ready = inspected.filter((candidate) => candidate.summary.status === "ready");
  if (ready.length === 0) {
    throw validationError("NO_EXPORTABLE_SHAPES", "No selected shapes passed preflight.", inspected.map((candidate) => candidate.summary));
  }

  const tempDir = safeChildPath(exportJobsDir(productRoot), exportId);
  await ensureDir(tempDir);
  const workDir = path.join(tempDir, "shopify");
  await ensureDir(workDir);
  const archiveFilename = `rugs-nsm-export-${timestampSlug(new Date(createdAt))}.zip`;
  const archivePath = safeChildPath(tempDir, archiveFilename);
  const total = ready.reduce((sum, candidate) => sum + candidate.items.length * 3, 1);
  let completed = 0;
  const report = (message: string) => onProgress({ completed, total, message });
  report("Preparing Shopify images");

  const receiptShapes: GalleryExportShapeReceipt[] = [];
  const fileEntries: Array<{ sourcePath: string; archivePath: string }> = [];
  for (const candidate of inspected) {
    if (candidate.summary.status === "skipped") {
      receiptShapes.push({
        productId: candidate.product.id,
        familyId: candidate.product.familyId,
        shape: candidate.product.shape,
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
      const shopifyFilename = outputName(candidate.product, item);
      const stagedName = `${candidate.product.id}-${item.position}-${shopifyFilename}`;
      const stagedPath = safeChildPath(workDir, stagedName);
      const converted = await writeShopifyFile(item, stagedPath);
      const originalArchivePath = `${familySegment}/${shapeSegment}/originals/${item.sourceFile}`;
      const shopifyArchivePath = `${familySegment}/${shapeSegment}/shopify/${shopifyFilename}`;
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
      fileEntries.push({ sourcePath: item.sourcePath, archivePath: originalArchivePath });
      fileEntries.push({ sourcePath: stagedPath, archivePath: shopifyArchivePath });
      completed += 1;
      report(`Optimized ${shopifyFilename}`);
    }
    receiptShapes.push({
      productId: candidate.product.id,
      familyId: candidate.product.familyId,
      shape: candidate.product.shape,
      status: "included",
      issues: candidate.summary.issues,
      images: imageReceipts
    });
  }

  const completedAt = new Date().toISOString();
  const manifest = {
    version: 1 as const,
    exportId,
    archiveFilename,
    createdAt,
    completedAt,
    requestedProductIds: [...productIds],
    encoder: GALLERY_EXPORT_ENCODER,
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

  constructor(private readonly productRoot: string) {}

  start(productIds: string[]) {
    const exportId = `export_${randomUUID()}`;
    const now = new Date().toISOString();
    const job: GalleryExportJob = {
      exportId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      archiveFilename: null,
      progress: { completed: 0, total: 1, message: "Queued" },
      error: null,
      receipt: null
    };
    this.jobs.set(exportId, job);
    void this.run(exportId, productIds);
    return structuredClone(job);
  }

  get(exportId: string) {
    const job = this.jobs.get(exportId);
    if (!job) throw notFoundError("EXPORT_JOB_NOT_FOUND", "Export job not found.");
    return structuredClone(job);
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
      receipt
    });
  }

  private async run(exportId: string, productIds: string[]) {
    const current = this.jobs.get(exportId);
    if (!current) return;
    this.jobs.set(exportId, { ...current, status: "building", updatedAt: new Date().toISOString(), progress: { completed: 0, total: 1, message: "Preflighting selection" } });
    try {
      const build = await buildGalleryExport({
        productRoot: this.productRoot,
        productIds,
        exportId,
        onProgress: (progress) => {
          const job = this.jobs.get(exportId);
          if (job) this.jobs.set(exportId, { ...job, updatedAt: new Date().toISOString(), progress });
        }
      });
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
      const job = this.jobs.get(exportId) as GalleryExportJob;
      this.jobs.set(exportId, {
        ...job,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Export failed.",
        progress: { ...job.progress, message: "Export failed" }
      });
    }
  }
}
