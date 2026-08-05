import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveAsset, writeOutputImage } from "../server/asset-store";
import { sha256File } from "../server/fsUtils";
import { loadProductState } from "../server/product-state";
import { scanProducts } from "../server/scanner";
import { materializeShapeVariant } from "../server/shape-variant-materialize";
import { getShapeVariantRecord, mutateShapeVariantCampaign } from "../server/shape-variant-store";
import type { ShapeVariantRecord } from "../shared/types";
import { cleanupTempWorkspace, makeAssetRecord, makeTempWorkspace, productList, readJson } from "./test-utils";

describe("atomic shape-variant approval", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "products");
    await fs.mkdir(path.join(productRoot, "rug-1"), { recursive: true });
  });

  afterEach(async () => cleanupTempWorkspace(workspace));

  it("materializes an approved sibling without changing the Area source", async () => {
    const sourceImage = await sharp({
      create: { width: 768, height: 768, channels: 3, background: { r: 180, g: 120, b: 70 } }
    }).png().toBuffer();
    const sourcePath = path.join(productRoot, "rug-1", "base.png");
    await fs.writeFile(sourcePath, sourceImage);
    const sourceHash = await sha256File(sourcePath);
    await loadProductState({ productRoot, productId: "rug-1" });

    const now = "2026-08-05T00:00:00.000Z";
    const campaignRecord: ShapeVariantRecord = {
      id: "rug-1::runner",
      familyId: "rug-1",
      sourceProductId: "rug-1",
      variantProductId: "rug-1--runner",
      shape: "runner",
      status: "needs_review",
      strategy: "auto",
      runnerRatio: 3.33,
      roundEdgePolicy: null,
      imageSize: "4K",
      candidateCount: 1,
      sourceBaseFile: "base.png",
      sourceBaseSha256: sourceHash,
      promptVersion: "runner-v1",
      prompt: "Make a runner",
      candidateAssetIds: ["runner-candidate"],
      approvedAssetId: null,
      activeRunId: null,
      requestedCandidateCount: 1,
      completedCandidateCount: 1,
      lastError: null,
      createdAt: now,
      updatedAt: now
    };
    await mutateShapeVariantCampaign(productRoot, (campaign) => campaign.variants.push(campaignRecord));
    await writeOutputImage({ productRoot, productId: "rug-1", file: "runner-candidate.png", data: sourceImage });
    await saveAsset({
      productRoot,
      productId: "rug-1",
      asset: makeAssetRecord({
        assetId: "runner-candidate",
        productId: "rug-1",
        shotId: "shape_runner_base",
        shotName: "Runner Design Candidate",
        inputs: {
          baseImage: {
            file: "base.png",
            sha256: sourceHash,
            sizeBytes: sourceImage.length,
            mtimeMs: Date.now(),
            mimeType: "image/png"
          },
          references: [],
          shapeVariant: {
            familyId: "rug-1",
            sourceProductId: "rug-1",
            variantProductId: "rug-1--runner",
            shape: "runner",
            strategy: "auto",
            runnerRatio: 3.33,
            roundEdgePolicy: null,
            promptVersion: "runner-v1",
            runId: "run-1"
          }
        },
        output: { file: "runner-candidate.png", mimeType: "image/png", sizeBytes: sourceImage.length }
      })
    });

    const approved = await materializeShapeVariant({ productRoot, record: campaignRecord, assetId: "runner-candidate" });
    expect(approved.status).toBe("approved");
    expect(await sha256File(sourcePath)).toBe(sourceHash);
    expect(await readJson(path.join(productRoot, "rug-1--runner", "variant.json"))).toMatchObject({
      sourceProductId: "rug-1",
      shape: "runner",
      approvedAssetId: "runner-candidate",
      sourceBaseSha256: sourceHash
    });
    const variant = productList(await scanProducts({ productRoot })).find((product) => product.id === "rug-1--runner");
    expect(variant).toMatchObject({ status: "ready", shape: "runner", familyId: "rug-1" });
    expect((await getShapeVariantRecord(productRoot, "rug-1::runner")).approvedAssetId).toBe("runner-candidate");

    await expect(materializeShapeVariant({ productRoot, record: approved, assetId: "runner-candidate" })).resolves.toMatchObject({ status: "approved" });
  });
});
