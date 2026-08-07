import { describe, expect, it } from "vitest";
import type { GenerationBackgroundSnapshot } from "../shared/types";
import { assertRetryBackgroundAllowed } from "../server/background-guard";

const savedBackground: GenerationBackgroundSnapshot = {
  id: "runner-hall",
  type: "runner_hallway",
  title: "Runner Hall",
  prompt: "Long hall prompt",
  previewImagePath: null,
  runnerArchetype: "long_hallway_gallery",
  runnerShotCompatibility: ["wide_room_hero"]
};

function assertAllowed(overrides: Partial<Parameters<typeof assertRetryBackgroundAllowed>[0]> = {}) {
  return assertRetryBackgroundAllowed({
    backgroundRequired: true,
    productShape: "runner",
    shotId: "wide_room_hero",
    shotName: "Wide Room Hero",
    savedBackground,
    currentBackgrounds: [{ id: "runner-hall", type: "runner_hallway" }],
    ...overrides
  });
}

describe("retry background guard", () => {
  it("requires saved metadata for background shots", () => {
    expect(() => assertAllowed({ savedBackground: null })).toThrow(/saved background metadata/i);
  });

  it("rejects a Runner background removed from the current library", () => {
    expect(() => assertAllowed({ currentBackgrounds: [] })).toThrow(/still exists/i);
  });

  it("rejects a background whose current type is no longer Runner Foyer/Hallway", () => {
    expect(() => assertAllowed({
      currentBackgrounds: [{ id: "runner-hall", type: "interior_living" }]
    })).toThrow(/still exists/i);
  });

  it("does not depend on compatibility metadata saved with an older attempt", () => {
    expect(() => assertAllowed({
      savedBackground: { ...savedBackground, runnerArchetype: undefined, runnerShotCompatibility: undefined }
    })).not.toThrow();
  });

  it("preserves permissive Area and Round retries", () => {
    for (const productShape of ["area", "round"] as const) {
      expect(() => assertAllowed({
        productShape,
        savedBackground: { ...savedBackground, type: "interior_living" },
        currentBackgrounds: []
      })).not.toThrow();
    }
  });

  it("keeps Runner-only rooms out of Area and Round retries", () => {
    for (const productShape of ["area", "round"] as const) {
      expect(() => assertAllowed({ productShape, currentBackgrounds: [] })).toThrow(/Runner-only/i);
    }
  });

  it("does not require a background for studio shots", () => {
    expect(() => assertAllowed({
      backgroundRequired: false,
      shotId: "texture_macro",
      savedBackground: null,
      currentBackgrounds: []
    })).not.toThrow();
  });
});
