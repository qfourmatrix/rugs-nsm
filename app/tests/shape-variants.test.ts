import { describe, expect, it } from "vitest";
import { composeGenerationPrompt } from "../server/prompt-compose";
import { resolveShapeShotContext } from "../shared/shape-shot-prompts";
import { buildShapeVariantPrompt } from "../shared/shape-variants";
import { makeShot } from "./test-utils";

describe("shape-variant prompt engineering", () => {
  it("reconstructs runners by design grammar instead of stretching", () => {
    const parsed = JSON.parse(buildShapeVariantPrompt({
      shape: "runner",
      strategy: "repeat_border",
      runnerRatio: 3.33,
      roundEdgePolicy: "preserve_source"
    })) as Record<string, unknown>;
    const text = JSON.stringify(parsed);

    expect(parsed.prompt_version).toBe("runner-v1");
    expect(parsed.target_geometry).toMatch(/3\.33:1/);
    expect(text).toMatch(/whole repeats/i);
    expect(text).toMatch(/never resize|never by stretching/i);
    expect(text).toMatch(/fringe stays only on the equivalent short end/i);
    expect(text).toMatch(/sole product-identity authority/i);
  });

  it("builds a true circle without squeezing or automatic radialization", () => {
    const parsed = JSON.parse(buildShapeVariantPrompt({
      shape: "round",
      strategy: "focal",
      runnerRatio: 3.33,
      roundEdgePolicy: "bound"
    })) as Record<string, unknown>;
    const text = JSON.stringify(parsed);

    expect(parsed.prompt_version).toBe("round-v1");
    expect(parsed.target_geometry).toMatch(/true circular rug, not an oval/i);
    expect(text).toMatch(/never squeeze/i);
    expect(text).toMatch(/not automatically turn.*radial/i);
    expect(text).toMatch(/clean bound edge/i);
  });

  it("applies shape placement after room overrides while keeping custom scene edits", () => {
    const shot = makeShot({ id: "wide_room_hero" });
    const runnerContext = resolveShapeShotContext({
      shape: "runner",
      shot,
      prompt: shot.prompt,
      backgroundType: "bedroom"
    });
    const parsed = JSON.parse(composeGenerationPrompt({
      prompt: shot.prompt,
      background: null,
      labelLogo: null,
      construction: null,
      shapeContext: runnerContext
    })) as Record<string, unknown>;

    expect(parsed.scene).toMatch(/corridor|hallway|bedside/i);
    expect(parsed.rug_placement).toMatch(/complete runner lengthwise/i);
    expect(parsed.shape_context).toMatchObject({ product_shape: "runner", background_compatibility: "recommended" });

    const customContext = resolveShapeShotContext({
      shape: "round",
      shot,
      prompt: "My custom foyer scene.",
      backgroundType: "bedroom"
    });
    const custom = JSON.parse(composeGenerationPrompt({
      prompt: "My custom foyer scene.",
      background: null,
      labelLogo: null,
      construction: null,
      shapeContext: customContext
    })) as Record<string, unknown>;
    expect(custom.scene).toBe("My custom foyer scene.");
    expect(custom.shape_context).toMatchObject({ product_shape: "round", background_compatibility: "usable" });
  });
});
