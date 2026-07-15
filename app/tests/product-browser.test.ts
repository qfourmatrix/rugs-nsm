import { describe, expect, it } from "vitest";
import { matchesProductFilter, productPreview, productStatus } from "../src/components/ProductTabs";
import type { ProductSummary } from "../shared/types";

function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: "rug-1",
    name: "Rug 1",
    createdAt: "2026-07-13T00:00:00.000Z",
    status: "ready",
    baseImage: "base.jpg",
    referenceImages: [],
    counts: {
      totalShots: 5,
      accepted: 0,
      reviewNeeded: 0,
      failed: 0,
      running: 0
    },
    errors: [],
    ...overrides
  };
}

describe("product browser status and filters", () => {
  it("uses the current reference as the preview when the base image is missing", () => {
    expect(
      productPreview(product({
        status: "missing_base",
        baseImage: null,
        referenceImages: ["alternate.jpg", "refine-reference.webp"]
      }))
    ).toEqual({ kind: "reference", filename: "refine-reference.webp" });
    expect(
      productPreview(product({ status: "missing_base", baseImage: null, referenceImages: ["only-reference.jpg"] }))
    ).toEqual({ kind: "reference", filename: "only-reference.jpg" });
  });

  it("keeps the base image as the primary preview and does not mask other base errors", () => {
    expect(productPreview(product({ referenceImages: ["refine-reference.jpg"] }))).toEqual({
      kind: "base",
      filename: "base.jpg"
    });
    expect(
      productPreview(product({ status: "duplicate_base", baseImage: null, referenceImages: ["refine-reference.jpg"] }))
    ).toBeNull();
  });

  it("uses one priority status per product", () => {
    expect(productStatus(product({ status: "missing_base", baseImage: null })).label).toBe("Missing base");
    expect(productStatus(product({ counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 1, running: 1 } })).label).toBe("Running");
    expect(productStatus(product({ counts: { totalShots: 5, accepted: 5, reviewNeeded: 0, failed: 0, running: 0 } })).label).toBe("Complete");
  });

  it("separates attention, progress, and complete filters", () => {
    const attention = product({ counts: { totalShots: 5, accepted: 1, reviewNeeded: 1, failed: 0, running: 0 } });
    const progress = product({ counts: { totalShots: 5, accepted: 2, reviewNeeded: 0, failed: 0, running: 0 } });
    const complete = product({ counts: { totalShots: 5, accepted: 5, reviewNeeded: 0, failed: 0, running: 0 } });

    expect(matchesProductFilter(attention, "needs_attention")).toBe(true);
    expect(matchesProductFilter(progress, "in_progress")).toBe(true);
    expect(matchesProductFilter(complete, "complete")).toBe(true);
    expect(matchesProductFilter(complete, "in_progress")).toBe(false);
  });
});
