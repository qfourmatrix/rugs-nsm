import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptAsset, rejectAsset } from "../server/asset-store";
import {
  appendAcceptedGalleryAsset,
  loadGallerySelection,
  removeGalleryAsset,
  saveGallerySelection
} from "../server/gallery-store";
import { acceptGalleryAsset, acceptGalleryAssets, galleryReadinessSummary, setGalleryReadiness } from "../server/gallery-store";
import {
  cleanupTempWorkspace,
  makeAssetRecord,
  makeProduct,
  makeTempWorkspace,
  writeGeneratedAsset
} from "./test-utils";

describe("persistent gallery selections", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "products");
    await makeProduct(productRoot, "SKU-001", ["base.png"]);
  });

  afterEach(async () => cleanupTempWorkspace(workspace));

  it("seeds accepted customer images once and excludes construction outputs", async () => {
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "room-a", status: "accepted", createdAt: "2026-01-01T00:00:00.000Z" }));
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "room-b", status: "accepted", createdAt: "2026-01-02T00:00:00.000Z" }));
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "runner-base", shotId: "shape_runner_base", status: "accepted" }));

    expect((await loadGallerySelection({ productRoot, productId: "SKU-001" })).assetIds).toEqual(["room-a", "room-b"]);

    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "accepted-later", status: "accepted" }));
    expect((await loadGallerySelection({ productRoot, productId: "SKU-001" })).assetIds).toEqual(["room-a", "room-b"]);
  });

  it("persists reorder, removal, restore, and automatic append on accept", async () => {
    for (const assetId of ["room-a", "room-b", "room-c"]) {
      await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId, status: assetId === "room-c" ? "done" : "accepted" }));
    }
    await loadGallerySelection({ productRoot, productId: "SKU-001" });

    expect((await saveGallerySelection({ productRoot, productId: "SKU-001", assetIds: ["room-b", "room-a"] })).assetIds).toEqual(["room-b", "room-a"]);
    expect((await saveGallerySelection({ productRoot, productId: "SKU-001", assetIds: ["room-b"] })).assetIds).toEqual(["room-b"]);
    expect((await saveGallerySelection({ productRoot, productId: "SKU-001", assetIds: ["room-b", "room-a"] })).assetIds).toEqual(["room-b", "room-a"]);

    const accepted = await acceptAsset({ productRoot, productId: "SKU-001", assetId: "room-c" });
    expect((await appendAcceptedGalleryAsset({ productRoot, productId: "SKU-001", asset: accepted })).assetIds).toEqual(["room-b", "room-a", "room-c"]);

    await rejectAsset({ productRoot, productId: "SKU-001", assetId: "room-a" });
    expect((await removeGalleryAsset({ productRoot, productId: "SKU-001", assetId: "room-a" })).assetIds).toEqual(["room-b", "room-c"]);
  });

  it("rejects duplicate and unaccepted gallery references", async () => {
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "room-a", status: "accepted" }));
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "room-b", status: "done" }));

    await expect(saveGallerySelection({ productRoot, productId: "SKU-001", assetIds: ["room-a", "room-a"] })).rejects.toMatchObject({ code: "DUPLICATE_GALLERY_ASSET" });
    await expect(saveGallerySelection({ productRoot, productId: "SKU-001", assetIds: ["room-b"] })).rejects.toMatchObject({ code: "GALLERY_ASSET_NOT_SELECTABLE" });
    await expect(saveGallerySelection({ productRoot, productId: "../escape", assetIds: [] })).rejects.toMatchObject({ code: "INVALID_PRODUCT_ID" });
  });

  it("migrates v1 losslessly without reseeding removed images", async () => {
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "removed", status: "accepted" }));
    const initializedAt = "2026-01-01T00:00:00.000Z";
    await fs.writeFile(path.join(productRoot, "SKU-001", "gallery-selection.json"), JSON.stringify({ version: 1, productId: "SKU-001", assetIds: [], initializedAt, updatedAt: initializedAt }));
    expect(await loadGallerySelection({ productRoot, productId: "SKU-001" })).toMatchObject({ version: 2, assetIds: [], initializedAt, revision: 0, exportReady: false });
  });

  it("persists base-only readiness, rejects stale writes, and resets only for content changes", async () => {
    const args = { productRoot, productId: "SKU-001" };
    expect(await galleryReadinessSummary(args)).toEqual({ exportReady: false, galleryRevision: 0 });
    await expect(fs.access(path.join(productRoot, "SKU-001", "gallery-selection.json"))).rejects.toThrow();
    const initial = await loadGallerySelection(args);
    const ready = await setGalleryReadiness({ ...args, exportReady: true, expectedRevision: initial.revision });
    expect(ready.exportReady).toBe(true);
    expect(ready.reviewedContent?.files).toHaveLength(1);
    expect((await saveGallerySelection({ ...args, assetIds: [], expectedRevision: ready.revision })).exportReady).toBe(true);
    await expect(setGalleryReadiness({ ...args, exportReady: false, expectedRevision: 0 })).rejects.toMatchObject({ status: 409, code: "GALLERY_REVISION_CONFLICT" });
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "new-done", status: "done" }));
    expect((await loadGallerySelection(args)).exportReady).toBe(true);
    await fs.writeFile(path.join(productRoot, "SKU-001", "base.png"), "replaced main");
    expect(await loadGallerySelection(args)).toMatchObject({ exportReady: false, revision: ready.revision + 1 });
  });

  it("serializes initial reads, bulk accept, and readiness with deterministic per-item results", async () => {
    const args = { productRoot, productId: "SKU-001" };
    for (const [assetId, createdAt] of [["later", "2026-02-01T00:00:00.000Z"], ["earlier", "2026-01-01T00:00:00.000Z"]]) await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId, createdAt, status: "done" }));
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "utility", shotId: "refine_base", status: "done" }));
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "missing-file", status: "done" }));
    const missing = await import("../server/asset-store").then((module) => module.getAssetRecord({ ...args, assetId: "missing-file" }));
    await fs.unlink(path.join(productRoot, "SKU-001", "generated", missing.asset.output!.file));
    const [, result] = await Promise.all([loadGallerySelection(args), acceptGalleryAssets({ ...args, assetIds: ["later", "utility", "earlier", "missing-file", "../escape"] }), loadGallerySelection(args)]);
    expect(result.gallery.assetIds).toEqual(["earlier", "later"]);
    expect(result.results.filter((item) => item.status === "accepted")).toHaveLength(2);
    expect(result.results.filter((item) => item.status === "skipped")).toHaveLength(3);
    const ready = await setGalleryReadiness({ ...args, exportReady: true, expectedRevision: result.gallery.revision });
    const retry = await acceptGalleryAssets({ ...args, assetIds: ["earlier", "later"] });
    expect(retry.gallery.revision).toBe(ready.revision);
    expect(retry.gallery.exportReady).toBe(true);
    const removed = await saveGallerySelection({ ...args, assetIds: ["earlier"], expectedRevision: ready.revision });
    expect(removed.exportReady).toBe(false);
    expect((await acceptGalleryAssets({ ...args, assetIds: ["later"] })).gallery.assetIds).toEqual(["earlier"]);
    await expect(acceptGalleryAsset({ ...args, assetId: "missing-file" })).rejects.toMatchObject({ code: "GALLERY_ASSET_FILE_MISSING" });
  });

  it("keeps readiness independent per shape and isolates invalid readiness records", async () => {
    const area = { productRoot, productId: "SKU-001" };
    const runner = { productRoot, productId: "SKU-001-runner" };
    await makeProduct(productRoot, runner.productId, ["base.png"]);
    await setGalleryReadiness({ ...area, exportReady: true, expectedRevision: (await loadGallerySelection(area)).revision });
    expect((await loadGallerySelection(runner)).exportReady).toBe(false);
    await fs.writeFile(path.join(productRoot, runner.productId, "gallery-selection.json"), "invalid json");
    expect(await galleryReadinessSummary(runner)).toHaveProperty("readinessError");
    expect((await galleryReadinessSummary(area)).exportReady).toBe(true);
  });

  it("invalidates approval for reorder, removal, restore and accept without affecting another shape", async () => {
    const args = { productRoot, productId: "SKU-001" };
    const runner = { productRoot, productId: "SKU-001--runner" };
    await makeProduct(productRoot, runner.productId, ["base.png"]);
    await setGalleryReadiness({ ...runner, exportReady: true, expectedRevision: (await loadGallerySelection(runner)).revision });
    for (const assetId of ["a", "b"]) await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId, status: "accepted" }));
    const approve = async () => setGalleryReadiness({ ...args, exportReady: true, expectedRevision: (await loadGallerySelection(args)).revision });
    for (const assetIds of [["b", "a"], ["b"], ["b", "a"]]) {
      const ready = await approve();
      expect((await saveGallerySelection({ ...args, assetIds, expectedRevision: ready.revision })).exportReady).toBe(false);
      expect((await loadGallerySelection(runner)).exportReady).toBe(true);
    }
    await approve();
    await writeGeneratedAsset(productRoot, makeAssetRecord({ assetId: "c", status: "done" }));
    expect((await acceptGalleryAsset({ ...args, assetId: "c" })).gallery.exportReady).toBe(false);
    expect((await loadGallerySelection(runner)).exportReady).toBe(true);
  });
});
