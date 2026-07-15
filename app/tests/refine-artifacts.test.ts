import { describe, expect, it } from "vitest";
import {
  hideRefineGenerated,
  isRefineReferenceImage,
  withoutRefineReferences
} from "../server/refine-artifacts";
import { makeAssetRecord } from "./test-utils";

describe("refine artifact visibility", () => {
  it("recognizes and removes reserved refine source images", () => {
    expect(isRefineReferenceImage("refine-reference.JPG")).toBe(true);
    expect(isRefineReferenceImage("customer-reference.jpg")).toBe(false);
    expect(withoutRefineReferences(["angle.png", "refine-reference.webp"])).toEqual(["angle.png"]);
  });

  it("removes refine attempts from generated data shown by the normal workflow", () => {
    const refineAsset = makeAssetRecord({ assetId: "refine-1", shotId: "refine_base" });
    const normalAsset = makeAssetRecord({ assetId: "hero-1", shotId: "hero" });

    expect(
      hideRefineGenerated({
        active: [refineAsset, normalAsset],
        trash: [makeAssetRecord({ assetId: "refine-2", shotId: "refine_base" })],
        aggregates: { refine_base: "accepted", hero: "review_needed" }
      })
    ).toEqual({
      active: [normalAsset],
      trash: [],
      aggregates: { hero: "review_needed" }
    });
  });
});
