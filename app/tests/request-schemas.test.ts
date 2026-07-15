import { describe, expect, it } from "vitest";
import { BulkGenerateRequestSchema, GenerateRequestSchema, RefineRequestSchema } from "../shared/schemas";
import { DEFAULT_SOS_CUSTOM_PALETTE } from "../shared/sos-palettes";

describe("generation request schemas", () => {
  it("defaults selected generation to one image when batch size is omitted", () => {
    const parsed = GenerateRequestSchema.parse({
      shotId: "hero",
      prompt: "Generate a hero image",
      settings: {
        aspectRatio: "1:1",
        imageSize: "4K"
      }
    });

    expect(parsed.batchSize).toBe(1);
  });

  it("accepts bulk generation settings with an explicit batch size", () => {
    const parsed = BulkGenerateRequestSchema.parse({
      settings: {
        aspectRatio: "4:3",
        imageSize: "2K"
      },
      batchSize: 3,
      referenceImages: ["angle.png"],
      shotIds: ["hero", "detail"]
    });

    expect(parsed).toMatchObject({
      settings: {
        aspectRatio: "4:3",
        imageSize: "2K"
      },
      batchSize: 3,
      referenceImages: ["angle.png"],
      shotIds: ["hero", "detail"]
    });
  });

  it("rejects unsafe batch sizes", () => {
    expect(() =>
      BulkGenerateRequestSchema.parse({
        settings: {
          aspectRatio: "1:1",
          imageSize: "4K"
        },
        batchSize: 99
      })
    ).toThrow();
  });

  it("accepts supported refine modes and defaults older requests", () => {
    expect(RefineRequestSchema.parse({ imageSize: "2K", patternMode: "asymmetrical" })).toEqual({
      imageSize: "2K",
      patternMode: "asymmetrical",
      variationCount: 3,
      sosPaletteId: "auto_flip",
      sosCustomPalette: DEFAULT_SOS_CUSTOM_PALETTE,
      sosDesignChange: false
    });
    expect(
      RefineRequestSchema.parse({
        patternMode: "sos",
        sosPaletteId: "custom",
        sosCustomPalette: { fieldColor: "#123456", motifColor: "#ABCDEF" },
        sosDesignChange: true
      })
    ).toEqual({
      imageSize: "4K",
      patternMode: "sos",
      variationCount: 3,
      sosPaletteId: "custom",
      sosCustomPalette: { fieldColor: "#123456", motifColor: "#ABCDEF" },
      sosDesignChange: true
    });
    expect(RefineRequestSchema.parse({})).toEqual({
      imageSize: "4K",
      patternMode: "symmetrical",
      variationCount: 3,
      sosPaletteId: "auto_flip",
      sosCustomPalette: DEFAULT_SOS_CUSTOM_PALETTE,
      sosDesignChange: false
    });
    expect(() => RefineRequestSchema.parse({ imageSize: "8K" })).toThrow();
    expect(() => RefineRequestSchema.parse({ patternMode: "organic" })).toThrow();
    expect(() => RefineRequestSchema.parse({ sosPaletteId: "neon_surprise" })).toThrow();
    expect(RefineRequestSchema.parse({ variationCount: 4 }).variationCount).toBe(4);
    expect(() => RefineRequestSchema.parse({ variationCount: 0 })).toThrow();
    expect(() => RefineRequestSchema.parse({ variationCount: 5 })).toThrow();
  });
});
