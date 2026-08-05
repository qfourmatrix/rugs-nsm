import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadShapeVariantCampaign,
  mutateShapeVariantCampaign,
  shapeVariantRecordId,
  summarizeShapeVariantCampaign,
  updateShapeVariantRecord
} from "../server/shape-variant-store";
import type { ShapeVariantRecord } from "../shared/types";
import { cleanupTempWorkspace, makeTempWorkspace, pathExists } from "./test-utils";

function record(sourceProductId: string, shape: "runner" | "round"): ShapeVariantRecord {
  const now = "2026-08-05T00:00:00.000Z";
  return {
    id: shapeVariantRecordId(sourceProductId, shape),
    familyId: sourceProductId,
    sourceProductId,
    variantProductId: `${sourceProductId}--${shape}`,
    shape,
    status: "planned",
    strategy: "auto",
    runnerRatio: shape === "runner" ? 3.33 : null,
    roundEdgePolicy: shape === "round" ? "preserve_source" : null,
    imageSize: "4K",
    candidateCount: 1,
    sourceBaseFile: "base.png",
    sourceBaseSha256: "a".repeat(64),
    promptVersion: `${shape}-v1`,
    prompt: `Make ${shape}`,
    candidateAssetIds: [],
    approvedAssetId: null,
    activeRunId: null,
    requestedCandidateCount: 0,
    completedCandidateCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now
  };
}

describe("durable shape-variant campaigns", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "products");
  });

  afterEach(async () => cleanupTempWorkspace(workspace));

  it("serializes concurrent updates without losing candidate ids", async () => {
    await mutateShapeVariantCampaign(productRoot, (campaign) => campaign.variants.push(record("rug-1", "runner")));
    await Promise.all([
      updateShapeVariantRecord(productRoot, "rug-1::runner", (current) => { current.candidateAssetIds.push("candidate-a"); }),
      updateShapeVariantRecord(productRoot, "rug-1::runner", (current) => { current.candidateAssetIds.push("candidate-b"); })
    ]);

    const campaign = await loadShapeVariantCampaign(productRoot);
    expect(campaign.variants[0]?.candidateAssetIds.sort()).toEqual(["candidate-a", "candidate-b"]);
    expect(await pathExists(path.join(productRoot, ".product-shot-queue", "shape-variants.json"))).toBe(true);
    expect(summarizeShapeVariantCampaign(campaign).counts.planned).toBe(1);
  });
});
