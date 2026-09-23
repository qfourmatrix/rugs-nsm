import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptAsset, buildAssetBasename, rejectAsset, listGeneratedAssets, generatedMetadataRevision, getAssetRecord, assetMetadataCacheStats } from "../server/asset-store";
import { writeFile, unlink } from "node:fs/promises";
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

  it("keeps compact browsing out of the full-prompt cache while details remain exact", async () => {
    const asset = makeAssetRecord({ prompt: "Original exact prompt. ".repeat(1000) });
    await writeGeneratedAsset(productRoot, asset);
    const before = assetMetadataCacheStats();
    const compact = await listGeneratedAssets({ productRoot, productId: asset.productId, compact: true });
    expect(compact.active[0]).toMatchObject({ assetId: asset.assetId, prompt: "", detailsOmitted: true });
    expect(assetMetadataCacheStats().full).toEqual(before.full);
    expect(assetMetadataCacheStats().compact.entries).toBe(before.compact.entries + 1);
    expect((await getAssetRecord({ productRoot, productId: asset.productId, assetId: asset.assetId })).asset.prompt).toBe(asset.prompt);
    expect(assetMetadataCacheStats().full.entries).toBe(before.full.entries + 1);
  });

  it("does not admit full listing scans into the detail cache, including trash", async () => {
    const active = makeAssetRecord({ assetId: "scan-active", prompt: "Exact active prompt" });
    const trash = makeAssetRecord({ assetId: "scan-trash", status: "rejected", prompt: "Exact trash prompt" });
    await writeGeneratedAsset(productRoot, active);
    await writeGeneratedAsset(productRoot, trash);
    const { rename, mkdir } = await import("node:fs/promises");
    await mkdir(path.join(productRoot, trash.productId, "trash"), { recursive: true });
    await rename(path.join(productRoot, trash.productId, "generated", `${trash.assetId}.json`), path.join(productRoot, trash.productId, "trash", `${trash.assetId}.json`));
    const before = assetMetadataCacheStats().full;
    const args = { productRoot, productId: active.productId };
    const first = await listGeneratedAssets(args);
    expect(first.active[0]).toEqual(active);
    expect(first.trash[0]).toEqual(trash);
    expect(await listGeneratedAssets(args)).toEqual(first);
    expect(assetMetadataCacheStats().full).toEqual(before);
    const detail = await getAssetRecord({ ...args, assetId: active.assetId });
    expect(detail.asset).toEqual(active);
    const admitted = assetMetadataCacheStats().full;
    expect(admitted.entries).toBe(before.entries + 1);
    const reused = await listGeneratedAssets(args);
    reused.active[0].prompt = "Caller mutation";
    expect(await listGeneratedAssets(args)).toEqual(first);
    expect(assetMetadataCacheStats().full).toEqual(admitted);
  });

  it("projects heavy browsing details without changing originals, review IDs or aggregates", async () => {
    const asset = makeAssetRecord();
    asset.prompt = "exact prompt ".repeat(10000);
    asset.error = { code: "DETAIL", message: "Visible error", raw: { trace: "large trace".repeat(10000) } };
    await writeGeneratedAsset(productRoot, asset);
    const full = await listGeneratedAssets({ productRoot, productId: asset.productId });
    const compact = await listGeneratedAssets({ productRoot, productId: asset.productId, compact: true });
    expect(compact.active[0]).toMatchObject({ assetId: asset.assetId, detailsOmitted: true, prompt: "", error: { message: "Visible error", raw: null } });
    expect(compact.aggregates).toEqual(full.aggregates);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length / 20);
    expect((await getAssetRecord({ productRoot, productId: asset.productId, assetId: asset.assetId })).asset.prompt).toBe(asset.prompt);
    await acceptAsset({ productRoot, productId: asset.productId, assetId: asset.assetId });
    const accepted = await getAssetRecord({ productRoot, productId: asset.productId, assetId: asset.assetId });
    expect(accepted.asset.prompt).toBe(asset.prompt);
    expect(accepted.asset).not.toHaveProperty("detailsOmitted");
    const reviewed = await listGeneratedAssets({ productRoot, productId: asset.productId, compact: true });
    expect(reviewed.active[0].status).toBe("accepted");
    expect(reviewed.active[0].detailsRevision).toBeTruthy();
    expect(reviewed.active[0].detailsRevision).not.toBe(compact.active[0].detailsRevision);
    reviewed.active[0].shotName = "Mutated caller copy";
    expect((await listGeneratedAssets({ productRoot, productId: asset.productId, compact: true })).active[0].shotName).toBe(asset.shotName);
    await rejectAsset({ productRoot, productId: asset.productId, assetId: asset.assetId });
    const rejected = await listGeneratedAssets({ productRoot, productId: asset.productId, compact: true });
    expect(rejected.active).toHaveLength(0);
    expect(rejected.trash[0].status).toBe("rejected");
  });

  it("invalidates generated revisions on external edits, review, removal and runtime changes", async () => {
    const asset = makeAssetRecord();
    const { metadataPath } = await writeGeneratedAsset(productRoot, asset);
    const revision = (context = "idle") => generatedMetadataRevision(productRoot, asset.productId, context);
    const initial = await revision();
    expect(await revision()).toBe(initial);
    expect(await revision("running")).not.toBe(initial);
    await writeFile(metadataPath, JSON.stringify({ ...asset, prompt: "Changed prompt" }));
    const edited = await revision(); expect(edited).not.toBe(initial);
    await acceptAsset({ productRoot, productId: asset.productId, assetId: asset.assetId });
    const accepted = await revision(); expect(accepted).not.toBe(edited);
    await rejectAsset({ productRoot, productId: asset.productId, assetId: asset.assetId });
    const rejected = await revision(); expect(rejected).not.toBe(accepted);
    expect(await revision()).toBe(rejected);
    await unlink(path.join(productRoot, asset.productId, "trash", `${asset.assetId}.json`));
    expect(await revision()).not.toBe(rejected);
  });

  it("refreshes cached metadata after external edits and removals, without leaking caller mutations", async () => {
    const asset = makeAssetRecord();
    const { metadataPath } = await writeGeneratedAsset(productRoot, asset);
    const args = { productRoot, productId: asset.productId };
    const first = await listGeneratedAssets(args);
    first.active[0].status = "rejected";
    expect((await listGeneratedAssets(args)).active[0].status).toBe(asset.status);
    await writeFile(metadataPath, JSON.stringify({ ...asset, status: "accepted" }));
    expect((await listGeneratedAssets(args)).active[0].status).toBe("accepted");
    await writeFile(metadataPath, "invalid JSON");
    await expect(listGeneratedAssets(args)).rejects.toThrow();
    await unlink(metadataPath);
    expect((await listGeneratedAssets(args)).active).toEqual([]);
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
