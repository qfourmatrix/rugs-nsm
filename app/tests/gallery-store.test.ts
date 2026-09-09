import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptAsset, rejectAsset } from "../server/asset-store";
import {
  appendAcceptedGalleryAsset,
  loadGallerySelection,
  removeGalleryAsset,
  saveGallerySelection
} from "../server/gallery-store";
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
});
