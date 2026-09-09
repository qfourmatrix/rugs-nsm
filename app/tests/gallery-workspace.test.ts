import { describe, expect, it } from "vitest";
import { moveGalleryAsset, selectedProductIdsForExport } from "../src/components/GalleryExportWorkspace";
import type { ProductSummary } from "../shared/types";

function product(id: string, familyId: string, shape: ProductSummary["shape"]): ProductSummary {
  return {
    id,
    name: id,
    familyId,
    sourceProductId: familyId,
    shape,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "ready",
    baseImage: "base.png",
    referenceImages: [],
    counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 0, running: 0 },
    errors: []
  };
}

describe("gallery export workspace helpers", () => {
  const products = [
    product("rug-a", "rug-a", "area"),
    product("rug-a--runner", "rug-a", "runner"),
    product("rug-b", "rug-b", "area"),
    product("rug-b--round", "rug-b", "round")
  ];

  it("maps batch families and explicit shape choices to concrete product IDs", () => {
    expect(selectedProductIdsForExport(products, new Set(["rug-a", "rug-b"]), new Set(["area", "round"]))).toEqual([
      "rug-a",
      "rug-b",
      "rug-b--round"
    ]);
  });

  it("provides a keyboard-safe previous/next ordering operation", () => {
    expect(moveGalleryAsset(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveGalleryAsset(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveGalleryAsset(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });
});
