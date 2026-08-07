import { describe, expect, it } from "vitest";
import { composeGenerationPrompt } from "../server/prompt-compose";
import { PLACEHOLDER_MASTER_SHOTS } from "../shared/constants";
import { resolveShapeShotContext, resolveShapeShotProfile, shapeShotDisplayName } from "../shared/shape-shot-prompts";
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

  const expectedShotSignals: Record<"runner" | "round", Record<string, RegExp[]>> = {
    runner: {
      wide_room_hero: [/both short ends/i, /30-45 degree/i, /never directly end-on/i],
      high_angle_lifestyle: [/corner-to-corner diagonal/i, /60-75 degree/i, /both long edges/i],
      studio_corner_detail: [/short-end-to-long-edge junction/i, /20-35 degree/i, /pure white/i],
      texture_macro: [/true local section/i, /80-120mm/i, /do not compress the full Runner design/i],
      folded_label_detail: [/one true short end/i, /sewn cloth label/i, /must not migrate to a long side/i]
    },
    round: {
      wide_room_hero: [/entire continuous circular perimeter/i, /35-50 degree/i, /do not invent a round table/i],
      high_angle_lifestyle: [/65-80 degree/i, /complete Round rug/i, /avoid strong oval distortion/i],
      studio_corner_detail: [/continuous authentic arc/i, /tangent to the circular perimeter/i, /never flatten it into a straight edge/i],
      texture_macro: [/true local section/i, /80-120mm/i, /do not compress the full circular design/i],
      folded_label_detail: [/small shallow arc/i, /sewn cloth label/i, /must not create a square corner/i]
    }
  };

  for (const shape of ["runner", "round"] as const) {
    for (const shot of PLACEHOLDER_MASTER_SHOTS.shots) {
      it(`applies a complete mandatory ${shape} profile to ${shot.id}`, () => {
        const backgroundType = shape === "runner" ? "bedroom" : "interior_living";
        const context = resolveShapeShotContext({
          shape,
          shot,
          prompt: shot.prompt,
          backgroundType
        });
        expect(context).not.toBeNull();

        const profile = context?.profile;
        expect(profile?.id).toBe(`${shape}_${shot.id}`);
        expect(profile?.label).toBe(shapeShotDisplayName(shape, shot.name));
        for (const field of ["camera", "lighting", "output_requirements", "quality", "rug_placement", "scene", "styling"] as const) {
          expect(profile?.override[field]).toEqual(expect.any(String));
        }
        if (shot.id === "studio_corner_detail") {
          expect(profile?.override.crop_lock).toEqual(expect.any(String));
          expect(profile?.override.fringe_tassel_lock).toEqual(expect.any(String));
        }
        if (shot.id === "folded_label_detail") {
          for (const field of ["fold_geometry", "fringe_tassel_lock", "edge_strip_lock", "label_placement", "label_geometry_lock"] as const) {
            expect(profile?.override[field]).toEqual(expect.any(String));
          }
        }
        expect(profile?.validationChecks.length).toBeGreaterThanOrEqual(4);
        expect(profile?.rejectConditions.length).toBeGreaterThanOrEqual(4);

        const parsed = JSON.parse(composeGenerationPrompt({
          prompt: shot.prompt,
          background: null,
          labelLogo: null,
          construction: null,
          shapeContext: context
        })) as Record<string, unknown>;
        const text = JSON.stringify(parsed);

        for (const signal of expectedShotSignals[shape][shot.id] ?? []) {
          expect(text).toMatch(signal);
        }
        expect(parsed).toMatchObject(profile?.override ?? {});
        expect(parsed.shape_context).toMatchObject({
          product_shape: shape,
          shot_profile: `${shape}_${shot.id}`,
          shot_label: shapeShotDisplayName(shape, shot.name),
          background_compatibility: "recommended",
          custom_prompt_policy: "The canonical shape-specific shot profile is active."
        });
        expect(parsed).not.toHaveProperty("operator_customization");
      });
    }
  }

  it.each(["runner_foyer", "runner_hallway", "foyer", "hallway"])(
    "treats %s as a preferred Runner room background type",
    (backgroundType) => {
      const shot = PLACEHOLDER_MASTER_SHOTS.shots.find((candidate) => candidate.id === "wide_room_hero");
      const context = resolveShapeShotContext({
        shape: "runner",
        shot: shot ?? makeShot({ id: "wide_room_hero" }),
        prompt: shot?.prompt ?? "",
        backgroundType
      });

      expect(context?.backgroundCompatibility).toBe("recommended");
    }
  );

  it("keeps custom operator edits as secondary guidance while the shape contract remains mandatory", () => {
    const shot = PLACEHOLDER_MASTER_SHOTS.shots.find((candidate) => candidate.id === "wide_room_hero");
    expect(shot).toBeDefined();
    const context = resolveShapeShotContext({
      shape: "round",
      shot: shot ?? makeShot({ id: "wide_room_hero" }),
      prompt: "My custom low-angle rectangular foyer scene.",
      backgroundType: "bedroom"
    });
    const custom = JSON.parse(composeGenerationPrompt({
      prompt: "My custom low-angle rectangular foyer scene.",
      background: null,
      labelLogo: null,
      construction: null,
      shapeContext: context
    })) as Record<string, unknown>;

    expect(custom.scene).toMatch(/Shape-specific Round wide lifestyle hero/i);
    expect(custom.operator_customization).toMatchObject({
      requested_scene: "My custom low-angle rectangular foyer scene."
    });
    expect(custom.shape_context).toMatchObject({
      product_shape: "round",
      background_compatibility: "usable"
    });
    expect(JSON.stringify(custom.shape_context)).toMatch(/shape-specific shot profile remains mandatory/i);
  });

  it("overrides Area-specific corner and fold geometry for shaped products", () => {
    const studioShot = PLACEHOLDER_MASTER_SHOTS.shots.find((candidate) => candidate.id === "studio_corner_detail");
    const labelShot = PLACEHOLDER_MASTER_SHOTS.shots.find((candidate) => candidate.id === "folded_label_detail");
    expect(studioShot).toBeDefined();
    expect(labelShot).toBeDefined();

    const roundStudio = JSON.parse(composeGenerationPrompt({
      prompt: studioShot?.prompt ?? "",
      background: null,
      labelLogo: null,
      construction: null,
      shapeContext: resolveShapeShotContext({
        shape: "round",
        shot: studioShot ?? makeShot({ id: "studio_corner_detail" }),
        prompt: studioShot?.prompt ?? "",
        backgroundType: null
      })
    })) as Record<string, unknown>;
    expect(roundStudio.crop_lock).toMatch(/curved arc/i);
    expect(roundStudio.crop_lock).not.toMatch(/top-left area/i);
    expect(roundStudio.fringe_tassel_lock).toMatch(/approved edge treatment/i);

    const roundLabel = JSON.parse(composeGenerationPrompt({
      prompt: labelShot?.prompt ?? "",
      background: null,
      labelLogo: null,
      construction: null,
      shapeContext: resolveShapeShotContext({
        shape: "round",
        shot: labelShot ?? makeShot({ id: "folded_label_detail" }),
        prompt: labelShot?.prompt ?? "",
        backgroundType: null
      })
    })) as Record<string, unknown>;
    expect(roundLabel.fold_geometry).toMatch(/shallow arc segment/i);
    expect(roundLabel.fold_geometry).not.toMatch(/fold one real corner over/i);
    expect(roundLabel.label_placement).toMatch(/shallow curved flap/i);
    expect(roundLabel.label_geometry_lock).toMatch(/tangent to the nearby circular perimeter/i);

    const runnerLabel = JSON.parse(composeGenerationPrompt({
      prompt: labelShot?.prompt ?? "",
      background: null,
      labelLogo: null,
      construction: null,
      shapeContext: resolveShapeShotContext({
        shape: "runner",
        shot: labelShot ?? makeShot({ id: "folded_label_detail" }),
        prompt: labelShot?.prompt ?? "",
        backgroundType: null
      })
    })) as Record<string, unknown>;
    expect(runnerLabel.fold_geometry).toMatch(/one authentic short end/i);
    expect(runnerLabel.fold_geometry).toMatch(/not a corner fold/i);
    expect(runnerLabel.fringe_tassel_lock).toMatch(/never move, mirror, or wrap fringe onto either long side/i);
  });

  it("protects unknown custom shots with a complete fallback profile", () => {
    const shot = makeShot({ id: "custom_installation" });
    const profile = resolveShapeShotProfile("runner", shot);
    expect(profile.id).toBe("runner_custom_installation");
    expect(profile.override.rug_placement).toMatch(/exact long body ratio/i);
    expect(profile.override.camera).toMatch(/avoid end-on foreshortening/i);
    expect(profile.rejectConditions.join(" ")).toMatch(/square|Area-shaped/i);
  });
});
