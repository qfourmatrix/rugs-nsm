import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGalleryExport, listGalleryExportReceipts, preflightGalleryExport } from "../server/gallery-export";
import { saveGallerySelection } from "../server/gallery-store";
import { sha256File } from "../server/fsUtils";
import type { AssetRecord } from "../shared/types";
import {
  cleanupTempWorkspace,
  makeAssetRecord,
  makeProduct,
  makeTempWorkspace,
  writeGeneratedAsset
} from "./test-utils";

const execFileAsync = promisify(execFile);

describe("curated Shopify gallery exports", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "products");
  });

  afterEach(async () => cleanupTempWorkspace(workspace));

  async function makeSquareProduct(productId: string, size = 1200) {
    const productDir = await makeProduct(productRoot, productId, []);
    const base = await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 30, g: 60, b: 90, alpha: 0.75 } }
    }).png().withMetadata({ exif: { IFD0: { Artist: "Private source metadata" } } }).toBuffer();
    await fs.writeFile(path.join(productDir, "base.png"), base);
    return { productDir, base };
  }

  async function addAccepted(productId: string, assetId: string, shotId = "wide_room_hero") {
    const asset: AssetRecord = makeAssetRecord({
      productId,
      assetId,
      shotId,
      shotName: shotId === "wide_room_hero" ? "Wide Room Hero" : "Detail",
      status: "accepted",
      output: { file: `${assetId}.png`, mimeType: "image/png", sizeBytes: 0 }
    });
    const written = await writeGeneratedAsset(productRoot, asset);
    const image = await sharp({
      create: { width: 1200, height: 1200, channels: 4, background: { r: 180, g: 110, b: 50, alpha: 0.4 } }
    }).png().toBuffer();
    await fs.writeFile(written.imagePath, image);
    return asset;
  }

  it("warns for duplicate and missing shot types without blocking a valid shape", async () => {
    await makeSquareProduct("rug-a");
    await addAccepted("rug-a", "room-a");
    await addAccepted("rug-a", "room-b");
    await saveGallerySelection({ productRoot, productId: "rug-a", assetIds: ["room-a", "room-b"] });

    const preflight = await preflightGalleryExport({ productRoot, productIds: ["rug-a"] });
    expect(preflight.readyCount).toBe(1);
    expect(preflight.shapes[0].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_MASTER_SHOT", severity: "warning" }),
      expect.objectContaining({ code: "MISSING_MASTER_SHOT", severity: "warning" }),
      expect.objectContaining({ code: "UNDERSIZED_IMAGE", severity: "warning" })
    ]));
  }, 30_000);

  it("skips only the non-square shape while exporting valid originals and Shopify WebP files", async () => {
    const { productDir, base } = await makeSquareProduct("rug-good", 4200);
    await addAccepted("rug-good", "detail-a", "texture_macro");
    await saveGallerySelection({ productRoot, productId: "rug-good", assetIds: ["detail-a"] });

    const badDir = await makeProduct(productRoot, "rug-bad", []);
    await sharp({ create: { width: 1071, height: 1469, channels: 3, background: "#333" } }).png().toFile(path.join(badDir, "base.png"));
    await addAccepted("rug-bad", "room-bad");
    await saveGallerySelection({ productRoot, productId: "rug-bad", assetIds: ["room-bad"] });

    const result = await buildGalleryExport({ productRoot, productIds: ["rug-good", "rug-bad"], exportId: "export_test" });
    expect(result.receipt.includedShapes).toBe(1);
    expect(result.receipt.skippedShapes).toBe(1);
    expect(result.receipt.shapes.find((shape) => shape.productId === "rug-bad")).toMatchObject({
      status: "skipped",
      issues: expect.arrayContaining([expect.objectContaining({ code: "NON_SQUARE_IMAGE" })])
    });

    const { stdout: list } = await execFileAsync("unzip", ["-Z1", result.archivePath]);
    expect(list).toContain("export-manifest.json");
    expect(list).toContain("rug-good/area/originals/base.png");
    expect(list).toContain("rug-good/area/originals/detail-a.png");
    expect(list).toContain("rug-good/area/shopify/rug-good-area-01-main.webp");
    expect(list).toContain("rug-good/area/shopify/rug-good-area-02-texture-macro.webp");
    expect(list).not.toContain("rug-bad/area/originals");

    const extractedOriginal = path.join(workspace, "base-from-zip.png");
    const { stdout: originalBytes } = await execFileAsync("unzip", ["-p", result.archivePath, "rug-good/area/originals/base.png"], { encoding: "buffer" });
    await fs.writeFile(extractedOriginal, originalBytes);
    expect(await sha256File(extractedOriginal)).toBe(await sha256File(path.join(productDir, "base.png")));
    expect(await fs.readFile(extractedOriginal)).toEqual(base);

    const extractedWebp = path.join(workspace, "main.webp");
    const { stdout: webpBytes } = await execFileAsync("unzip", ["-p", result.archivePath, "rug-good/area/shopify/rug-good-area-01-main.webp"], { encoding: "buffer" });
    await fs.writeFile(extractedWebp, webpBytes);
    const metadata = await sharp(extractedWebp).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(4096);
    expect(metadata.height).toBe(4096);
    expect(metadata.space).toBe("srgb");
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect((await fs.stat(extractedWebp)).size).toBeLessThan(20 * 1024 * 1024);

    const { stdout: manifestJson } = await execFileAsync("unzip", ["-p", result.archivePath, "export-manifest.json"]);
    const manifest = JSON.parse(manifestJson);
    expect(manifest.encoder).toMatchObject({ format: "webp", quality: 90, effort: 6, maximumDimension: 4096 });
    expect(manifest.shapes[0].images.map((image: { position: number }) => image.position)).toEqual([1, 2]);
    expect(manifest.shapes[0].images[0]).toMatchObject({
      sourceDimensions: { width: 4200, height: 4200 },
      outputDimensions: { width: 4096, height: 4096 },
      sourceSha256: await sha256File(path.join(productDir, "base.png"))
    });

    const receipts = await listGalleryExportReceipts(productRoot);
    expect(receipts[0]).toMatchObject({ exportId: "export_test", archiveSha256: await sha256File(result.archivePath) });
  }, 120_000);

  it("blocks missing, stale, rejected, unaccepted, utility, and legacy-invalid selections", async () => {
    await makeSquareProduct("rug-stale");
    await addAccepted("rug-stale", "valid");
    await saveGallerySelection({ productRoot, productId: "rug-stale", assetIds: ["valid"] });
    await fs.writeFile(
      path.join(productRoot, "rug-stale", "gallery-selection.json"),
      JSON.stringify({ version: 1, productId: "rug-stale", assetIds: ["missing"], initializedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" })
    );
    const preflight = await preflightGalleryExport({ productRoot, productIds: ["rug-stale"] });
    expect(preflight.shapes[0]).toMatchObject({
      status: "skipped",
      issues: expect.arrayContaining([expect.objectContaining({ code: "MISSING_GALLERY_ASSET", severity: "blocker" })])
    });
    await expect(preflightGalleryExport({ productRoot, productIds: ["../escape"] })).rejects.toMatchObject({ code: "UNKNOWN_PRODUCT" });
  });

  it("exports a base-only gallery despite unrelated corrupt generations, without upscaling", async () => {
    const { productDir, base } = await makeSquareProduct("base-only", 80);
    await fs.mkdir(path.join(productDir, "generated"), { recursive: true });
    await fs.writeFile(path.join(productDir, "generated", "corrupt.json"), "broken unrelated metadata");
    const preflight = await preflightGalleryExport({ productRoot, productIds: ["base-only"] });
    expect(preflight.readyCount).toBe(1);
    expect(preflight.shapes[0].itemCount).toBe(1);
    expect(preflight.shapes[0].issues.some((issue) => issue.severity === "blocker")).toBe(false);
    const result = await buildGalleryExport({ productRoot, productIds: ["base-only"], exportId: "export_base_only", expectedFingerprints: { "base-only": preflight.shapes[0].contentFingerprint! } });
    expect(result.receipt.shapes[0].images).toHaveLength(1);
    expect(result.receipt.shapes[0].images[0]).toMatchObject({ position: 1, role: "main", outputDimensions: { width: 80, height: 80 } });
    const { stdout: original } = await execFileAsync("unzip", ["-p", result.archivePath, "base-only/area/originals/base.png"], { encoding: "buffer" });
    expect(original).toEqual(base);
  }, 30_000);

  it("blocks only a shape whose content changes after successful preflight", async () => {
    const { productDir } = await makeSquareProduct("changed", 80);
    await makeSquareProduct("unchanged", 80);
    const preflight = await preflightGalleryExport({ productRoot, productIds: ["changed", "unchanged"] });
    await sharp({ create: { width: 80, height: 80, channels: 3, background: "#900" } }).png().toFile(path.join(productDir, "base.png"));
    const result = await buildGalleryExport({ productRoot, productIds: ["changed", "unchanged"], exportId: "export_changed", expectedFingerprints: Object.fromEntries(preflight.shapes.map((shape) => [shape.productId, shape.contentFingerprint!])) });
    expect(result.receipt.includedShapes).toBe(1);
    expect(result.receipt.shapes.find((shape) => shape.productId === "changed")).toMatchObject({ status: "skipped", issues: expect.arrayContaining([expect.objectContaining({ code: "CONTENT_CHANGED" })]) });
  }, 30_000);

  it("validates only selected metadata and still blocks unaccepted or construction selections", async () => {
    const { productDir } = await makeSquareProduct("selected-only", 80);
    const asset = await addAccepted("selected-only", "selected");
    await saveGallerySelection({ productRoot, productId: "selected-only", assetIds: [asset.assetId] });
    await fs.writeFile(path.join(productDir, "generated", "unrelated.json"), "broken metadata");
    expect((await preflightGalleryExport({ productRoot, productIds: ["selected-only"] })).readyCount).toBe(1);
    await fs.writeFile(path.join(productDir, "generated", "selected.json"), JSON.stringify({ ...asset, status: "done" }));
    expect((await preflightGalleryExport({ productRoot, productIds: ["selected-only"] })).shapes[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNACCEPTED_GALLERY_ASSET" })]));
    await fs.writeFile(path.join(productDir, "generated", "selected.json"), JSON.stringify({ ...asset, shotId: "refine_base" }));
    expect((await preflightGalleryExport({ productRoot, productIds: ["selected-only"] })).shapes[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UTILITY_GALLERY_ASSET" })]));
  }, 30_000);
});
