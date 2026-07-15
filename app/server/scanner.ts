import { lstat, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { SUPPORTED_EXTENSIONS } from "../shared/constants";
import type { ProductSummary } from "../shared/types";
import { notFoundError, validationError } from "./errors";
import { assertSafeBasename, ensureDir, pathExists } from "./fsUtils";
import { withoutRefineReferences } from "./refine-artifacts";

export interface ScanResult {
  productRoot: string;
  products: ProductSummary[];
  productDirs: Map<string, string>;
}

export async function ensureProductRoot({ productRoot }: { productRoot: string }) {
  await ensureDir(productRoot);
}

function isSupportedBase(filename: string) {
  const parsed = path.parse(filename);
  return parsed.name.toLowerCase() === "base" && SUPPORTED_EXTENSIONS.includes(parsed.ext.toLowerCase() as (typeof SUPPORTED_EXTENSIONS)[number]);
}

function isSupportedImage(filename: string) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(filename).toLowerCase() as (typeof SUPPORTED_EXTENSIONS)[number]);
}

function imageMime(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export function mimeForImage(filename: string) {
  return imageMime(filename);
}

export async function scanProducts({ productRoot }: { productRoot: string }): Promise<ScanResult> {
  await ensureProductRoot({ productRoot });
  const entries = await readdir(productRoot, { withFileTypes: true });
  const products: ProductSummary[] = [];
  const productDirs = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const productDir = path.join(productRoot, entry.name);
    const linkInfo = await lstat(productDir);
    if (linkInfo.isSymbolicLink()) {
      continue;
    }

    const files = await readdir(productDir, { withFileTypes: true });
    const baseFiles = files.filter((file) => file.isFile() && isSupportedBase(file.name)).map((file) => file.name);
    const discoveredReferenceImages = await listReferenceImages(productDir);
    const errors: string[] = [];
    let status: ProductSummary["status"] = "ready";
    let baseImage: string | null = baseFiles[0] ?? null;

    if (baseFiles.length === 0) {
      status = "missing_base";
      baseImage = null;
      errors.push(`Missing base image named base.* in ${entry.name}.`);
    } else if (baseFiles.length > 1) {
      status = "duplicate_base";
      baseImage = null;
      errors.push(`Multiple base images found in ${entry.name}: ${baseFiles.join(", ")}. Keep exactly one base.* file.`);
    }

    const referenceImages =
      status === "missing_base"
        ? discoveredReferenceImages
        : withoutRefineReferences(discoveredReferenceImages);

    products.push({
      id: entry.name,
      name: entry.name,
      createdAt: creationTimestamp(linkInfo),
      status,
      baseImage,
      referenceImages,
      counts: {
        totalShots: 0,
        accepted: 0,
        reviewNeeded: 0,
        failed: 0,
        running: 0
      },
      errors
    });
    productDirs.set(entry.name, productDir);
  }

  products.sort(compareProductsByCreatedAt);
  return { productRoot, products, productDirs };
}

function creationTimestamp(info: { birthtimeMs: number | bigint; ctimeMs: number | bigint }) {
  const birthtimeMs = Number(info.birthtimeMs);
  const ctimeMs = Number(info.ctimeMs);
  const timestamp = birthtimeMs > 0 ? birthtimeMs : ctimeMs > 0 ? ctimeMs : Date.now();
  return new Date(timestamp).toISOString();
}

export function compareProductsByCreatedAt(left: ProductSummary, right: ProductSummary) {
  const difference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  return difference || left.id.localeCompare(right.id);
}

async function listReferenceImages(productDir: string): Promise<string[]> {
  const referencesDir = path.join(productDir, "references");
  if (!(await pathExists(referencesDir))) {
    return [];
  }

  const linkInfo = await lstat(referencesDir);
  if (!linkInfo.isDirectory() || linkInfo.isSymbolicLink()) {
    return [];
  }

  const entries = await readdir(referencesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && isSupportedImage(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 14);
}

export async function getProductDir(scan: ScanResult, productId: string) {
  const dir = scan.productDirs.get(productId);
  if (!dir) {
    throw notFoundError("UNKNOWN_PRODUCT", `Unknown product: ${productId}`);
  }
  return dir;
}

export async function resolveProductImagePath({
  scan,
  products,
  productId,
  kind,
  filename
}: {
  productRoot: string;
  scan: ScanResult;
  products: ProductSummary[];
  productId: string;
  kind: "base" | "reference" | "generated" | "trash";
  filename: string;
}) {
  assertSafeBasename(filename);
  const product = products.find((candidate) => candidate.id === productId);
  const productDir = await getProductDir(scan, productId);

  let candidate: string;
  if (kind === "base") {
    if (!product?.baseImage || filename !== product.baseImage) {
      throw notFoundError("IMAGE_NOT_FOUND", "Base image not found for product.");
    }
    candidate = path.join(productDir, filename);
  } else if (kind === "reference") {
    if (!product?.referenceImages.includes(filename)) {
      throw notFoundError("IMAGE_NOT_FOUND", "Reference image not found for product.");
    }
    candidate = path.join(productDir, "references", filename);
  } else {
    candidate = path.join(productDir, kind, filename);
  }

  const resolved = path.resolve(candidate);
  const allowedRoot = path.resolve(productDir);
  if (!resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw validationError("PATH_TRAVERSAL", "Resolved path escaped product directory.");
  }

  if (!(await pathExists(resolved))) {
    throw notFoundError("IMAGE_NOT_FOUND", "Image file not found.");
  }

  await stat(resolved);
  return resolved;
}
