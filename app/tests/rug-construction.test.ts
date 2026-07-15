import { describe, expect, it } from "vitest";
import { RUG_CONSTRUCTION_OPTIONS, RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE } from "../shared/constants";

describe("rug construction prompt presets", () => {
  it("defines the five supported construction choices", () => {
    expect(RUG_CONSTRUCTION_OPTIONS.map((option) => option.id)).toEqual([
      "flatweave",
      "low_pile",
      "high_pile",
      "mixed_high_low",
      "unknown_custom"
    ]);
  });

  it("keeps every construction preset as a pile-only override", () => {
    for (const option of RUG_CONSTRUCTION_OPTIONS) {
      const requestedPile = option.prompt.match(/^Apply only the requested pile texture: (.+?)\./)?.[1];

      expect(option.prompt).toBe(RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE.replace("{{pile_type}}", requestedPile ?? ""));
      expect(option.prompt).toContain("fiber softness, pile height, and surface depth only");
      expect(option.prompt).toContain("must not change the rug's design");
      expect(option.prompt).toContain("silhouette, color map, pattern scale, border width, motif spacing, or proportions");
      expect(option.prompt).not.toMatch(/\b(shag|wool|woven|warp|weft|melted|fuzz)\b/i);
    }
  });

  it("keeps mixed high-low anchored to reference-visible height zones", () => {
    const mixed = RUG_CONSTRUCTION_OPTIONS.find((option) => option.id === "mixed_high_low");

    expect(mixed?.prompt).toContain("reference-visible height zones");
  });
});
