import { describe, expect, it } from "vitest";
import {
  composeSosRefinePrompt,
  normalizeHexColor,
  SOS_PRESET_PALETTES
} from "../shared/sos-palettes";

describe("SOS palette prompt composition", () => {
  it("normalizes valid hex colors and rejects malformed values", () => {
    expect(normalizeHexColor("a5653c")).toBe("#A5653C");
    expect(normalizeHexColor("#xyzxyz")).toBeNull();
  });

  it("keeps exact recolor separate from minimal design variation", () => {
    const exact = composeSosRefinePrompt({
      basePrompt: "Base SOS prompt",
      paletteId: "auto_flip",
      customPalette: { fieldColor: "#123456", motifColor: "#ABCDEF" },
      designChange: false
    });
    const minimal = composeSosRefinePrompt({
      basePrompt: "Base SOS prompt",
      paletteId: "auto_flip",
      customPalette: { fieldColor: "#123456", motifColor: "#ABCDEF" },
      designChange: true
    });

    expect(exact).toContain("EXACT RECOLOR ONLY");
    expect(exact).toContain("same rug design with only its color assignment changed");
    expect(minimal).toContain("MINIMAL VARIATION ONLY");
    expect(minimal).toContain("Only small localized adjustments are allowed");
    expect(minimal).not.toContain("EXACT RECOLOR ONLY");

    for (const prompt of [exact, minimal]) {
      expect(prompt).toContain("SOS TASSEL / FRINGE LOCK — ABSOLUTE");
      expect(prompt).toContain("tassels on those edges only");
      expect(prompt).toContain("same visible strand or bundle count density");
      expect(prompt).toContain("Do not add tassels to a plain or bound edge");
      expect(prompt).toContain("must not recolor or reconstruct the tassels or fringe");
      expect(prompt).toContain("Tassel and fringe fidelity overrides all color");
      expect(prompt.indexOf("SOS TASSEL / FRINGE LOCK")).toBeGreaterThan(
        prompt.indexOf("SOS COLOR DIRECTION")
      );
    }
  });

  it("composes preset and custom color roles without extra palette colors", () => {
    const preset = SOS_PRESET_PALETTES.find((palette) => palette.id === "terracotta_teal");
    const presetPrompt = composeSosRefinePrompt({
      basePrompt: "Base",
      paletteId: "terracotta_teal",
      customPalette: { fieldColor: "#111111", motifColor: "#EEEEEE" },
      designChange: false
    });
    const customPrompt = composeSosRefinePrompt({
      basePrompt: "Base",
      paletteId: "custom",
      customPalette: { fieldColor: "#123456", motifColor: "#ABCDEF" },
      designChange: false
    });

    expect(presetPrompt).toContain(preset?.fieldColor);
    expect(presetPrompt).toContain(preset?.motifColor);
    expect(customPrompt).toContain("#123456");
    expect(customPrompt).toContain("#ABCDEF");
    expect(customPrompt).toContain("only two base hues");
  });
});
