import { expect, it } from "vitest";
import sharp from "sharp";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_MAIN_IMAGE, DEFAULT_WEBP, ExportPreparationSchema } from "../shared/export-preparation";
import { encodeExportImage } from "../server/export-image-pipeline";
import { createCutout, approveCutout, resolveCutout, listCutouts } from "../server/main-image-cutouts";
import { buildGalleryExport, preflightGalleryExport, previewGalleryExportImage } from "../server/gallery-export";
import { saveGallerySelection } from "../server/gallery-store";
import { makeAssetRecord, writeGeneratedAsset } from "./test-utils";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

it("uses the same settings and bytes for preview and ZIP; preserves originals", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "export-prep-"));
  try {
    await mkdir(path.join(root, "rug"));
    const source = await sharp({ create: { width: 800, height: 800, channels: 3, background: "white" } }).composite([{ input: await sharp({ create: { width: 180, height: 600, channels: 3, background: "#254e33" } }).png().toBuffer(), left: 300, top: 100 }]).png().toBuffer();
    await writeFile(path.join(root, "rug", "base.png"), source);
    const settings = ExportPreparationSchema.parse({ webp: { quality: 65, maximumDimension: 512 }, mainImages: { rug: { ...DEFAULT_MAIN_IMAGE, rotation: 90, trim: true, frame: true, occupancy: 75 } } });
    const beforeReview = await preflightGalleryExport({ productRoot: root, productIds: ["rug"], preparation: settings });
    expect(beforeReview.skippedCount).toBe(1);
    const preview = await previewGalleryExportImage(root, "rug", undefined, settings);
    expect(preview.width).toBe(512); expect(preview.height).toBe(512);
    settings.mainImages.rug.reviewedSourceSha256 = preview.sourceSha256;
    const preflight = await preflightGalleryExport({ productRoot: root, productIds: ["rug"], preparation: settings });
    expect(preflight.readyCount).toBe(1);
    const built = await buildGalleryExport({ productRoot: root, productIds: ["rug"], preparation: settings, expectedFingerprints: { rug: preflight.shapes[0].contentFingerprint! } });
    const exec = promisify(execFile);
    const { stdout: exported } = await exec("unzip", ["-p", built.archivePath, "rug/area/shopify/rug-area-01-main.webp"], { encoding: "buffer" });
    expect(exported).toEqual(Buffer.from(preview.image.split(",")[1], "base64"));
    expect(exported.length).toBe(preview.outputBytes);
    const { stdout: original } = await exec("unzip", ["-p", built.archivePath, "rug/area/originals/base.png"], { encoding: "buffer" });
    expect(original).toEqual(source);
    expect(await readFile(path.join(root, "rug", "base.png"))).toEqual(source);
    expect(built.receipt.encoder).toMatchObject({ quality: 65, maximumDimension: 512, lossless: false });
    const changed = await preflightGalleryExport({ productRoot: root, productIds: ["rug"], preparation: { ...settings, webp: { ...settings.webp, quality: 90 } } });
    expect(changed.shapes[0].contentFingerprint).not.toBe(preflight.shapes[0].contentFingerprint);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("frames cutouts without stretching or upscaling the rug", async () => {
  const source = await sharp({ create: { width: 100, height: 200, channels: 4, background: "#123456" } }).extend({ top: 30, bottom: 30, left: 50, right: 50, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const { data, info } = await encodeExportImage(source, { ...DEFAULT_WEBP, lossless: true }, { ...DEFAULT_MAIN_IMAGE, cutoutId: randomUUID(), frame: true, occupancy: 80, background: "#ffffff" });
  expect(info.width).toBe(260); expect(info.height).toBe(260);
  const bounds = await sharp(data).trim().toBuffer({ resolveWithObject: true });
  expect(bounds.info.width).toBe(100); expect(bounds.info.height).toBe(200);
});

it("deduplicates paid cutout attempts, requires approval, rejects stale sources and never retries failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-"));
  try {
    await mkdir(path.join(root, "rug"));
    const source = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#123456" } }).png().toBuffer();
    const output = await sharp(source).ensureAlpha().png().toBuffer();
    await writeFile(path.join(root, "rug", "base.png"), source);
    let calls = 0;
    const send = async () => { calls++; return { image: output, uncertainty: 0.7 }; };
    const id = randomUUID();
    const [a, b] = await Promise.all([createCutout(root, "rug", id, "mock", send), createCutout(root, "rug", id, "mock", send)]);
    expect(calls).toBe(1); expect(a).toEqual(b); expect(a.approved).toBe(false);
    await createCutout(root, "rug", id, "mock", send); expect(calls).toBe(1);
    const hash = createHash("sha256").update(source).digest("hex");
    await expect(resolveCutout(root, "rug", id, hash, true)).rejects.toMatchObject({ code: "CUTOUT_REVIEW_REQUIRED" });
    await approveCutout(root, id, true);
    await expect(resolveCutout(root, "rug", id, hash, true)).resolves.toMatchObject({ record: { approved: true } });
    const failId = randomUUID();
    const fail = async () => { calls++; throw new Error("connection lost"); };
    expect((await createCutout(root, "rug", failId, "mock", fail)).status).toBe("failed");
    await createCutout(root, "rug", failId, "mock", fail); expect(calls).toBe(2);
    expect((await listCutouts(root, "rug"))).toHaveLength(2);
    await writeFile(path.join(root, "rug", "base.png"), output);
    await expect(approveCutout(root, id, true)).rejects.toMatchObject({ code: "CUTOUT_SOURCE_CHANGED" });
    expect(await listCutouts(root, "rug")).toHaveLength(0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("does not reuse a saved ready cutout whose image is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cutout-missing-"));
  try {
    await mkdir(path.join(root, "rug"));
    const source = await sharp({ create: { width: 8, height: 8, channels: 4, background: "transparent" } }).png().toBuffer();
    await writeFile(path.join(root, "rug", "base.png"), source);
    const id = randomUUID();
    await createCutout(root, "rug", id, "test", async () => ({ image: source, uncertainty: null }));
    await rm(path.join(root, ".product-shot-queue", "main-image-cutouts", `${id}.png`));
    expect((await listCutouts(root, "rug"))[0]).toMatchObject({ status: "failed", approved: false });
    await expect(createCutout(root, "rug", id, "test")).rejects.toMatchObject({ code: "CUTOUT_CHANGED" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("preserves real alpha in transparent WebPs and lossless PNGs, and fills colored canvases", async () => {
  const source = await sharp({ create: { width: 30, height: 60, channels: 4, background: "#123456" } }).extend({ top: 10, bottom: 10, left: 10, right: 10, background: "transparent" }).png().toBuffer();
  const main = { ...DEFAULT_MAIN_IMAGE, cutoutId: randomUUID(), frame: true, rotation: 90, transparent: true };
  for (const format of ["webp", "png"] as const) {
    const { data } = await encodeExportImage(source, DEFAULT_WEBP, main, format);
    expect((await sharp(data).metadata()).format).toBe(format);
    const { data: pixels, info } = await sharp(data).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(pixels[3]).toBe(0);
    expect(pixels[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3]).toBe(255);
    if (format === "png") expect([...pixels.subarray((Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4, (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3)]).toEqual([18, 52, 86]);
  }
  const colored = await encodeExportImage(source, { ...DEFAULT_WEBP, lossless: true }, { ...main, transparent: false, background: "#abcdef" });
  const pixels = await sharp(colored.data).ensureAlpha().raw().toBuffer();
  expect([...pixels.subarray(0, 4)]).toEqual([171, 205, 239, 255]);
});

it("exports approved main-only transparent PNGs matching preview, with distinct format fingerprints", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "export-png-"));
  try {
    await mkdir(path.join(root, "rug"));
    const source = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#123456" } }).png().toBuffer();
    await writeFile(path.join(root, "rug", "base.png"), source);
    const output = await sharp({ create: { width: 30, height: 60, channels: 4, background: "#123456" } }).extend({ top: 10, bottom: 10, left: 25, right: 25, background: "transparent" }).png().toBuffer();
    const asset = makeAssetRecord({ productId: "rug", assetId: "room-test", status: "accepted", shotId: "wide_room_hero" });
    const generated = await writeGeneratedAsset(root, asset);
    await writeFile(generated.imagePath, source);
    await saveGallerySelection({ productRoot: root, productId: "rug", assetIds: [asset.assetId], expectedRevision: 0 });
    const id = randomUUID(); let calls = 0;
    await createCutout(root, "rug", id, "mock", async () => { calls++; return { image: output, uncertainty: null }; });
    const settings = ExportPreparationSchema.parse({ outputFormat: "png", mainImages: { rug: { ...DEFAULT_MAIN_IMAGE, frame: true, cutoutId: id, transparent: false, reviewedSourceSha256: createHash("sha256").update(source).digest("hex") } } });
    expect((await preflightGalleryExport({ productRoot: root, productIds: ["rug"], preparation: settings })).skippedCount).toBe(1);
    await approveCutout(root, id, true);
    const preview = await previewGalleryExportImage(root, "rug", undefined, settings);
    expect(preview.image.startsWith("data:image/png;")).toBe(true);
    const check = await preflightGalleryExport({ productRoot: root, productIds: ["rug"], preparation: settings });
    expect(check.readyCount).toBe(1); expect(check.shapes[0].itemCount).toBe(1);
    const webpCheck = await preflightGalleryExport({ productRoot: root, productIds: ["rug"], preparation: { ...settings, outputFormat: "webp" } });
    expect(webpCheck.shapes[0].itemCount).toBe(2);
    expect(webpCheck.shapes[0].contentFingerprint).not.toBe(check.shapes[0].contentFingerprint);
    const built = await buildGalleryExport({ productRoot: root, productIds: ["rug"], preparation: settings, expectedFingerprints: { rug: check.shapes[0].contentFingerprint! } });
    expect(built.receipt.encoder).toMatchObject({ format: "png", lossless: true });
    expect(built.receipt.shapes[0].images).toHaveLength(1);
    const webpBuilt = await buildGalleryExport({ productRoot: root, productIds: ["rug"], preparation: { ...settings, outputFormat: "webp" } });
    expect(webpBuilt.receipt.shapes[0].images).toHaveLength(2);
    const { stdout: webpMain } = await promisify(execFile)("unzip", ["-p", webpBuilt.archivePath, "rug/area/shopify/rug-area-01-main.webp"], { encoding: "buffer" });
    expect((await sharp(webpMain).metadata()).format).toBe("webp");
    expect((await sharp(webpMain).ensureAlpha().raw().toBuffer())[3]).toBe(255);
    const { stdout: exported } = await promisify(execFile)("unzip", ["-p", built.archivePath, "rug/area/room-viewer/rug-area-01-main.png"], { encoding: "buffer" });
    expect(exported).toEqual(Buffer.from(preview.image.split(",")[1], "base64"));
    expect((await sharp(exported).ensureAlpha().raw().toBuffer())[3]).toBe(0);
    expect(await readFile(path.join(root, "rug", "base.png"))).toEqual(source);
    const noCutout = structuredClone(settings); delete noCutout.mainImages.rug.cutoutId;
    expect((await preflightGalleryExport({ productRoot: root, productIds: ["rug"], preparation: noCutout })).shapes[0].issues.some(issue => issue.code === "CUTOUT_REQUIRED")).toBe(true);
    expect(calls).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
