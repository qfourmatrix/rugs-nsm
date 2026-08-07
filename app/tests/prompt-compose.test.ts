import { describe, expect, it } from "vitest";
import {
  composeGenerationPrompt,
  sanitizeBackgroundPrompt
} from "../server/prompt-compose";
import { resolveShotBackgroundTypeOverride } from "../shared/contextual-prompts";
import {
  FORBIDDEN_RUG_CHANGES,
  PLACEHOLDER_MASTER_SHOTS,
  PROMPT_PRIORITY_NOTE,
  RUG_REFERENCE_LOCK,
  rugPileMaterialInstruction
} from "../shared/constants";
import { makeShot } from "./test-utils";

function parsePrompt(prompt: string) {
  return JSON.parse(prompt) as Record<string, unknown>;
}

describe("generation prompt composition", () => {
  it("removes rug-type recommendation blocks from background prompts", () => {
    const sanitized = sanitizeBackgroundPrompt(
      [
        "ROOM TYPE: quiet living room.",
        "",
        "MATERIAL REALISM NOTES: keep the plaster and wood.",
        "",
        "BEST RUG TYPES: plush pile, graphic rug, high-low texture, bordered rug.",
        "LESS SUITABLE RUG TYPES: runner rug."
      ].join("\n")
    );

    expect(sanitized).toContain("ROOM TYPE");
    expect(sanitized).toContain("MATERIAL REALISM NOTES");
    expect(sanitized).not.toContain("BEST RUG TYPES");
    expect(sanitized).not.toContain("plush pile");
    expect(sanitized).not.toContain("graphic rug");
  });

  it("uses the reusable room section and resolves reverse-engineering placeholders", () => {
    const sanitized = sanitizeBackgroundPrompt(
      [
        "Quiet Timber Living.",
        "",
        "ROOM TYPE: analysis-only room description.",
        "BEST RUG TYPES: colorful rug.",
        "NEGATIVE CONSTRAINTS: Do not alter [RUG_REFERENCE] or use the wrong [RUG_SIZE].",
        "FINAL REUSABLE ROOM PROMPT: Create a [SHOT_TYPE] in [SHOT_ASPECT_RATIO]. Place [RUG_REFERENCE] at [RUG_SIZE] and treat [RUG_COLOR_FAMILY] only as metadata.",
        "CAMERA_SIDE: front-left"
      ].join("\n")
    );

    expect(sanitized).toContain("ROOM STYLE: Quiet Timber Living.");
    expect(sanitized).toContain("REUSABLE ROOM SCENE:");
    expect(sanitized).toContain("ROOM NEGATIVE CONSTRAINTS:");
    expect(sanitized).toContain("CAMERA SIDE: front-left");
    expect(sanitized).toContain("Image 1");
    expect(sanitized).toContain("configured output aspect ratio");
    expect(sanitized).not.toContain("analysis-only room description");
    expect(sanitized).not.toContain("BEST RUG TYPES");
    expect(sanitized).not.toMatch(/\[(?:RUG|SHOT)_[A-Z_]+\]/);
  });

  it("composes a valid ordered JSON prompt with room context and constrained pile", () => {
    const shot = makeShot({ id: "wide_room_hero" });
    const prompt = composeGenerationPrompt({
      prompt: shot.prompt,
      background: {
        id: "living-1",
        type: "living",
        title: "Living One",
        prompt: "ROOM TYPE: living room.\n\nBEST RUG TYPES: colorful graphic rug.",
        previewImagePath: null
      },
      labelLogo: null,
      construction: {
        id: "low_pile",
        name: "Low pile",
        prompt: rugPileMaterialInstruction("low pile")
      }
    });
    const parsed = parsePrompt(prompt);
    const keys = Object.keys(parsed);

    expect(keys.slice(0, 4)).toEqual([
      "shot_id",
      "prompt_priority_note",
      "rug_reference_lock",
      "allowed_rug_material_instruction"
    ]);
    expect(parsed.prompt_priority_note).toBe(PROMPT_PRIORITY_NOTE);
    expect(parsed.rug_reference_lock).toBe(RUG_REFERENCE_LOCK);
    expect(parsed.allowed_rug_material_instruction).toBe(rugPileMaterialInstruction("low pile"));
    expect(prompt.match(/low pile/g)).toHaveLength(1);
    expect(prompt).toContain("Ignore room-context wording");
    expect(prompt).not.toContain("colorful graphic rug");
    expect(parsed.forbidden_changes).toEqual([...FORBIDDEN_RUG_CHANGES]);
    expect(keys.indexOf("rug_reference_lock")).toBeLessThan(keys.indexOf("scene"));
    expect(keys.indexOf("allowed_rug_material_instruction")).toBeLessThan(keys.indexOf("scene"));
  });

  it("uses the background prompt as text-only room context while keeping Image 1 as the rug", () => {
    const parsed = parsePrompt(
      composeGenerationPrompt({
        prompt: makeShot({ id: "wide_room_hero" }).prompt,
        background: {
          id: "runner-hall-1",
          type: "runner_hallway",
          title: "Runner Hall",
          prompt: "FINAL REUSABLE ROOM PROMPT: Preserve the selected hall architecture.",
          previewImagePath: "../Preping bgs/Runner Hallway/KEEP/hall.jpg"
        },
        labelLogo: null,
        construction: null
      })
    );
    const backgroundContext = parsed.background_context as { instruction: string };

    expect(backgroundContext.instruction).toMatch(/Text-only secondary room context/i);
    expect(backgroundContext.instruction).toMatch(/no room reference image is attached/i);
    expect(backgroundContext.instruction).not.toMatch(/Image 2/i);
    expect(backgroundContext.instruction).toMatch(/Image 1 remains the only product identity reference/i);
  });

  it("activates the bedroom override for an untouched master prompt", () => {
    const shot = PLACEHOLDER_MASTER_SHOTS.shots.find((candidate) => candidate.id === "wide_room_hero");
    expect(shot).toBeDefined();

    const background = {
      id: "bedroom-1",
      type: " Bedroom ",
      title: "Bedroom One",
      prompt: "FINAL REUSABLE ROOM PROMPT: Reconstruct the selected bedroom.",
      previewImagePath: null
    };
    const backgroundTypeOverride = resolveShotBackgroundTypeOverride({
      shot: shot ?? null,
      prompt: shot?.prompt ?? "",
      backgroundType: background.type
    });
    const parsed = parsePrompt(
      composeGenerationPrompt({
        prompt: shot?.prompt ?? "",
        background,
        labelLogo: null,
        construction: null,
        backgroundTypeOverride
      })
    );

    expect(backgroundTypeOverride?.backgroundType).toBe("bedroom");
    expect(parsed.scene).toMatch(/Bedroom-specific wide lifestyle hero/i);
    expect(parsed.rug_placement).toMatch(/beneath the lower portion of the bed/i);
    expect(parsed.camera).toMatch(/foot or foot-side of the bed/i);
    expect(parsed.context_variant).toEqual({
      background_type: "bedroom",
      source: "master_shot_background_type_override"
    });
  });

  it("does not replace a custom prompt with the bedroom override", () => {
    const shot = PLACEHOLDER_MASTER_SHOTS.shots.find((candidate) => candidate.id === "high_angle_lifestyle");
    expect(shot).toBeDefined();

    const customPrompt = "Custom operator bedroom composition.";
    const backgroundTypeOverride = resolveShotBackgroundTypeOverride({
      shot: shot ?? null,
      prompt: customPrompt,
      backgroundType: "bedroom"
    });
    const parsed = parsePrompt(
      composeGenerationPrompt({
        prompt: customPrompt,
        background: {
          id: "bedroom-2",
          type: "bedroom",
          title: "Bedroom Two",
          prompt: "ROOM TYPE: bedroom.",
          previewImagePath: null
        },
        labelLogo: null,
        construction: null,
        backgroundTypeOverride
      })
    );

    expect(backgroundTypeOverride).toBeNull();
    expect(parsed.scene).toBe(customPrompt);
    expect(parsed.context_variant).toBeUndefined();
  });

  it("falls back to the normal shot prompt for other background types", () => {
    const shot = PLACEHOLDER_MASTER_SHOTS.shots.find((candidate) => candidate.id === "wide_room_hero");
    expect(shot).toBeDefined();

    const backgroundTypeOverride = resolveShotBackgroundTypeOverride({
      shot: shot ?? null,
      prompt: shot?.prompt ?? "",
      backgroundType: "architectural_living"
    });

    expect(backgroundTypeOverride).toBeNull();
  });

  it("preserves the studio corner crop lock in the composed generation request", () => {
    const shot = PLACEHOLDER_MASTER_SHOTS.shots.find((candidate) => candidate.id === "studio_corner_detail");
    expect(shot).toBeDefined();

    const parsed = parsePrompt(
      composeGenerationPrompt({
        prompt: shot?.prompt ?? "",
        background: null,
        labelLogo: null,
        construction: null
      })
    );

    expect(parsed.crop_lock).toMatch(/hard camera boundaries, not a container/i);
    expect(parsed.crop_lock).toMatch(/fit-to-frame, fit-to-canvas, contain, scale-to-fit, shrink-to-fit/i);
    expect(Object.keys(parsed).indexOf("crop_lock")).toBeLessThan(Object.keys(parsed).indexOf("scene"));
  });

  it("normalizes raw prompt-box edits into JSON without losing the reference lock", () => {
    const prompt = composeGenerationPrompt({
      prompt: "Custom operator edit for one shot.",
      background: null,
      labelLogo: null,
      construction: null
    });

    const parsed = parsePrompt(prompt);

    expect(parsed.shot_id).toBe("custom_prompt");
    expect(parsed.rug_reference_lock).toBe(RUG_REFERENCE_LOCK);
    expect(parsed.allowed_rug_material_instruction).toBe(rugPileMaterialInstruction("infer conservatively from Image 1"));
    expect(parsed.scene).toBe("Custom operator edit for one shot.");
  });

  it("keeps supplied label-logo instruction in the composed JSON prompt", () => {
    const shot = makeShot({
      id: "folded_label_detail",
      prompt: JSON.stringify(
        {
          shot_id: "folded_label_detail",
          prompt_priority_note: PROMPT_PRIORITY_NOTE,
          rug_reference_lock: RUG_REFERENCE_LOCK,
          allowed_rug_material_instruction: "{{pile_type}}",
          label_instruction: "Image 2 is the exact label-logo artwork. Place it on the rug back side only.",
          front_face: "The plush front face must never contain the sewn label.",
          back_face: "The exposed back side is flatter woven backing with low or no pile.",
          fold_geometry: "Fold one real corner so the folded flap exposes its back side facing camera.",
          fringe_tassel_lock: "Keep the same tassel color, strand thickness, strand twist, knot spacing, bundle count density, tassel length, fray, direction, and attachment method visible in Image 1.",
          edge_strip_lock: "Do not add any new white, cream, beige, or pale bar across, behind, under, or over the tassels.",
          label_placement: "The sewn cloth label is attached only to the exposed woven back side.",
          label_geometry_lock: "One off-white 4:3 landscape label, width about 22% of the image width and height about 16% of the image height.",
          scene: "Folded label shot.",
          rug_placement: "Fold one corner.",
          camera: "Close camera.",
          lighting: "Soft light.",
          styling: "Use supplied label-logo.",
          forbidden_changes: [...FORBIDDEN_RUG_CHANGES],
          forbidden_label_errors: [
            "Do not put the label or logo on the plush front face.",
            "Do not change the label's rectangular 4:3 landscape shape, size, placement, stitched border, or orientation."
          ],
          quality: "Clean detail.",
          output_requirements: "The sewn cloth label must visibly contain Image 2 exactly."
        },
        null,
        2
      )
    });
    const prompt = composeGenerationPrompt({
      prompt: shot.prompt,
      background: null,
      labelLogo: {
        file: "label-logo.png",
        path: "/tmp/label-logo.png",
        sha256: "sha256",
        mimeType: "image/png"
      },
      construction: null
    });

    const parsed = parsePrompt(prompt);

    expect(parsed.label_instruction).toContain("Image 2 is the exact label-logo artwork");
    expect(parsed.label_instruction).toContain("back side only");
    expect(parsed.label_instruction).toContain("Do not omit it, leave the label blank");
    expect(parsed.label_instruction).toContain("redraw the logo");
    expect(parsed.front_face).toContain("must never contain the sewn label");
    expect(parsed.back_face).toContain("flatter woven backing");
    expect(parsed.fold_geometry).toContain("exposes its back side");
    expect(parsed.fringe_tassel_lock).toContain("same tassel color");
    expect(parsed.edge_strip_lock).toContain("pale bar");
    expect(parsed.label_placement).toContain("exposed woven back side");
    expect(parsed.label_geometry_lock).toContain("4:3 landscape label");
    expect(parsed.forbidden_label_errors).toEqual([
      "Do not put the label or logo on the plush front face.",
      "Do not change the label's rectangular 4:3 landscape shape, size, placement, stitched border, or orientation."
    ]);
    expect(Object.keys(parsed).indexOf("label_instruction")).toBeLessThan(Object.keys(parsed).indexOf("forbidden_changes"));
    expect(Object.keys(parsed).indexOf("fringe_tassel_lock")).toBeLessThan(Object.keys(parsed).indexOf("scene"));
    expect(Object.keys(parsed).indexOf("edge_strip_lock")).toBeLessThan(Object.keys(parsed).indexOf("scene"));
    expect(Object.keys(parsed).indexOf("label_geometry_lock")).toBeLessThan(Object.keys(parsed).indexOf("scene"));
  });
});
