import sharp from "sharp";
import type { MainImageSettings, WebpSettings } from "../shared/export-preparation";

// A single pipeline powers both the real preview and the archived WebP.
// The input is always an immutable copy of the original image.
export async function prepareExportImage(source: string | Buffer, settings?: MainImageSettings) {
  let pipeline = sharp(source, { failOn: "error" }).autoOrient().toColourspace("srgb");
  if (!settings) return pipeline.png().toBuffer();
  if (!settings.cutoutId && settings.trim) pipeline = pipeline.trim({ threshold: settings.trimThreshold });
  let data = await pipeline.png().toBuffer();
  if (settings.cutoutId) {
    // Providers can leave alpha 1–4 speckles on the empty canvas. Measure the
    // visible matte, with four pixels of breathing room for faint fringe tips.
    const { data: alpha, info } = await sharp(data).extractChannel("alpha").raw().toBuffer({ resolveWithObject: true });
    let left = info.width, top = info.height, right = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      if (alpha[y * info.width + x] <= 4) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < 0) throw new Error("Cutout contains no visible rug. Try another attempt before approving.");
    left = Math.max(0, left - 4); top = Math.max(0, top - 4);
    right = Math.min(info.width - 1, right + 4); bottom = Math.min(info.height - 1, bottom + 4);
    data = await sharp(data).extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png().toBuffer();
  }
  if (settings.portrait) {
    const bounds = await sharp(data).metadata();
    if (bounds.width! > bounds.height! * 1.2) data = await sharp(data).rotate(90).png().toBuffer();
  }
  if (settings.rotation) data = await sharp(data).rotate(settings.rotation, { background: settings.cutoutId ? { r: 0, g: 0, b: 0, alpha: 0 } : settings.background }).png().toBuffer();
  if (settings.frame) {
    const metadata = await sharp(data).metadata();
    const side = Math.ceil(Math.max(metadata.width!, metadata.height!) / (settings.occupancy / 100));
    data = await sharp(data).flatten({ background: settings.background }).resize({ width: side, height: side, fit: "contain", background: settings.background, withoutEnlargement: true }).png().toBuffer();
  }
  return data;
}

export async function encodeExportImage(source: string | Buffer, webp: WebpSettings, main?: MainImageSettings) {
  const prepared = await prepareExportImage(source, main);
  return sharp(prepared).resize({ width: webp.maximumDimension, height: webp.maximumDimension, fit: "inside", withoutEnlargement: true })
    .webp({ preset: "photo", quality: webp.quality, lossless: webp.lossless, effort: 6, smartSubsample: true }).toBuffer({ resolveWithObject: true });
}
