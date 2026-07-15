import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ensureDir, pathExists } from "./fsUtils";

const THUMBNAIL_WIDTH = 360;
const THUMBNAIL_QUALITY = 68;
const inFlightThumbnails = new Map<string, Promise<string | null>>();

export type ThumbnailKind = "base" | "reference" | "generated" | "trash";

export async function getOrCreateThumbnail({
  productRoot,
  productId,
  kind,
  filename,
  sourcePath
}: {
  productRoot: string;
  productId: string;
  kind: ThumbnailKind;
  filename: string;
  sourcePath: string;
}) {
  const targetPath = await thumbnailPath({ productRoot, productId, kind, filename, sourcePath });

  if (await pathExists(targetPath)) {
    return targetPath;
  }

  const existing = inFlightThumbnails.get(targetPath);
  if (existing) {
    return existing;
  }

  const task = createThumbnail(sourcePath, targetPath).finally(() => {
    inFlightThumbnails.delete(targetPath);
  });
  inFlightThumbnails.set(targetPath, task);
  return task;
}

export async function getOrCreateBackgroundThumbnail({
  productRoot,
  backgroundId,
  sourcePath
}: {
  productRoot: string;
  backgroundId: string;
  sourcePath: string;
}) {
  const stat = await fs.stat(sourcePath);
  const cacheKey = crypto
    .createHash("sha1")
    .update(`${backgroundId}:${sourcePath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`)
    .digest("hex");
  const targetPath = path.join(productRoot, ".background-thumbnails", `${cacheKey}.jpg`);

  if (await pathExists(targetPath)) {
    return targetPath;
  }

  const existing = inFlightThumbnails.get(targetPath);
  if (existing) {
    return existing;
  }

  const task = createThumbnail(sourcePath, targetPath).finally(() => {
    inFlightThumbnails.delete(targetPath);
  });
  inFlightThumbnails.set(targetPath, task);
  return task;
}

async function thumbnailPath({
  productRoot,
  productId,
  kind,
  filename,
  sourcePath
}: {
  productRoot: string;
  productId: string;
  kind: ThumbnailKind;
  filename: string;
  sourcePath: string;
}) {
  const stat = await fs.stat(sourcePath);
  const cacheKey = crypto
    .createHash("sha1")
    .update(`${kind}:${filename}:${stat.size}:${Math.trunc(stat.mtimeMs)}`)
    .digest("hex");
  return path.join(productRoot, productId, ".thumbnails", kind, `${cacheKey}.jpg`);
}

async function createThumbnail(sourcePath: string, targetPath: string) {
  try {
    await ensureDir(path.dirname(targetPath));
    const tempPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
    );

    await sharp(sourcePath, { failOn: "none" })
      .rotate()
      .resize({
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_WIDTH,
        fit: "inside",
        withoutEnlargement: true
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true })
      .toFile(tempPath);

    await fs.rename(tempPath, targetPath).catch(async (error: NodeJS.ErrnoException) => {
      await fs.unlink(tempPath).catch(() => undefined);
      if (error.code !== "EEXIST") {
        throw error;
      }
    });

    return targetPath;
  } catch (error) {
    console.warn("Thumbnail generation failed; falling back to original image.", error);
    return null;
  }
}
