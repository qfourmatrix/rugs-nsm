import { describe, expect, it } from "vitest";
import {
  compatibleBackgroundsForShot,
  isBackgroundCompatibleForShot
} from "../shared/background-compatibility";

describe("Runner background compatibility", () => {
  const foyer = { id: "foyer", type: "runner_foyer" };
  const hallway = { id: "hallway", type: "runner_hallway" };
  const legacy = { id: "legacy", type: "interior_living" };

  it("uses the Runner Foyer/Hallway type for both room shots", () => {
    for (const shotId of ["wide_room_hero", "high_angle_lifestyle"]) {
      expect(isBackgroundCompatibleForShot({ productShape: "runner", shotId, background: foyer })).toBe(true);
      expect(isBackgroundCompatibleForShot({ productShape: "runner", shotId, background: hallway })).toBe(true);
      expect(isBackgroundCompatibleForShot({ productShape: "runner", shotId, background: legacy })).toBe(false);
      expect(isBackgroundCompatibleForShot({ productShape: "runner", shotId, background: null })).toBe(false);
    }
  });

  it("keeps Runner-only rooms out of the Area and Round library", () => {
    for (const productShape of ["area", "round"] as const) {
      expect(isBackgroundCompatibleForShot({
        productShape,
        shotId: "wide_room_hero",
        background: legacy
      })).toBe(true);
      expect(isBackgroundCompatibleForShot({
        productShape,
        shotId: "wide_room_hero",
        background: foyer
      })).toBe(false);
    }

    expect(compatibleBackgroundsForShot({
      productShape: "area",
      shotId: "wide_room_hero",
      backgrounds: [legacy, hallway, foyer]
    })).toEqual([legacy]);
    expect(compatibleBackgroundsForShot({
      productShape: "round",
      shotId: "high_angle_lifestyle",
      backgrounds: [foyer, legacy, hallway]
    })).toEqual([legacy]);
    expect(compatibleBackgroundsForShot({
      productShape: "area",
      shotId: null,
      backgrounds: [foyer, legacy, hallway]
    })).toEqual([legacy]);
  });

  it("preserves Runner studio behavior where no room background is required", () => {
    expect(isBackgroundCompatibleForShot({
      productShape: "runner",
      shotId: "texture_macro",
      background: legacy
    })).toBe(true);
  });

  it("filters both Runner room shots by type in manifest order", () => {
    const backgrounds = [legacy, hallway, foyer];

    for (const shotId of ["wide_room_hero", "high_angle_lifestyle"]) {
      expect(compatibleBackgroundsForShot({
        productShape: "runner",
        shotId,
        backgrounds
      }).map((background) => background.id)).toEqual(["hallway", "foyer"]);
    }
    expect(compatibleBackgroundsForShot({
      productShape: "runner",
      shotId: "wide_room_hero",
      backgrounds: [legacy]
    })).toEqual([]);
    expect(compatibleBackgroundsForShot({
      productShape: "round",
      shotId: "wide_room_hero",
      backgrounds
    })).toEqual([legacy]);
  });
});
