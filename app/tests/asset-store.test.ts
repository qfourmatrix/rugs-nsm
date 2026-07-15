import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptAsset, buildAssetBasename, rejectAsset } from "../server/asset-store";
import type { AssetRecord } from "../shared/types";
import {
  cleanupTempWorkspace,
  makeAssetRecord,
  makeProduct,
  makeTempWorkspace,
  pathExists,
  readJson,
  writeGeneratedAsset
} from "./test-utils";

describe("asset naming and review actions", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "nsm100k");
    await makeProduct(productRoot, "SKU-001");
  });

  afterEach(async () => {
    await cleanupTempWorkspace(workspace);
  });

  it("builds same-millisecond filenames with PRD shape without collisions", async () => {
    const existingAssetIds = new Set<string>();
    const generated = [];
    const fixedLocalDate = new Date(2026, 5, 29, 14, 30, 22, 391);

    for (let index = 0; index < 20; index += 1) {
      const assetId = buildAssetBasename({
        shotId: "hero",
        now: fixedLocalDate,
        existingAssetIds
      });
      existingAssetIds.add(assetId);
      generated.push(assetId);
    }

    expect(new Set(generated).size).toBe(generated.length);
    for (const assetId of generated) {
      expect(assetId).toMatch(/^hero_2026-06-29_143022_391_[a-z0-9]+$/);
    }
  });

  it("accept is idempotent and leaves the generated image in place", async () => {
    const asset = makeAssetRecord();
    const { imagePath, metadataPath } = await writeGeneratedAsset(productRoot, asset);

    await acceptAsset({ productRoot, productId: asset.productId, assetId: asset.assetId });
    await acceptAsset({ productRoot, productId: asset.productId, assetId: asset.assetId });

    expect(await pathExists(imagePath)).toBe(true);
    const saved = await readJson<AssetRecord>(metadataPath);
    expect(saved.status).toBe("accepted");
  });

  it("reject is idempotent and moves the image plus sidecar to trash", async () => {
    const asset = makeAssetRecord({
      assetId: "hero_2026-06-29_143022_391_b7e9d2"
    });
    const { generatedDir, trashDir } = await writeGeneratedAsset(productRoot, asset);

    await rejectAsset({ productRoot, productId: asset.productId, assetId: asset.assetId });
    await rejectAsset({ productRoot, productId: asset.productId, assetId: asset.assetId });

    expect(await pathExists(path.join(generatedDir, `${asset.assetId}.png`))).toBe(false);
    expect(await pathExists(path.join(generatedDir, `${asset.assetId}.json`))).toBe(false);
    expect(await pathExists(path.join(trashDir, `${asset.assetId}.png`))).toBe(true);
    expect(await pathExists(path.join(trashDir, `${asset.assetId}.json`))).toBe(true);

    const saved = await readJson<AssetRecord>(path.join(trashDir, `${asset.assetId}.json`));
    expect(saved.status).toBe("rejected");
  });
});
