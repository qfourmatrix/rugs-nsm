import { describe, expect, it } from "vitest";
import { resolveShapeShotContext, resolveShapeShotProfile } from "../shared/shape-shot-prompts";
import { composeGenerationPrompt } from "../server/prompt-compose";
import { makeShot } from "./test-utils";

describe("approved natural Runner room cameras", () => {
  it("uses a straight-on wide view and a distinct closer elevated view", () => {
    const wide = resolveShapeShotProfile("runner", makeShot({ id: "wide_room_hero" }));
    const close = resolveShapeShotProfile("runner", makeShot({ id: "high_angle_lifestyle" }));
    expect(wide.override.camera).toContain("Offset three-quarter");
    expect(wide.override.camera).toContain("all four corners");
    expect(close.override.camera).toContain("High oblique cropped detail");
    expect(close.override.crop_lock).toContain("long body continues beyond the frame");
    expect(JSON.stringify(close)).not.toMatch(/three quarters|both ends.*inside|all edges visible|Reject a missing short end/);
    expect(close.override.camera).toContain("No ceiling");
    for (const profile of [wide, close]) {
      expect(profile.override.rug_placement).toContain("parallel in world space");
      expect(profile.override.camera).not.toMatch(/60-75|never directly end-on|near the Runner's midpoint/);
      expect(profile.override.lighting).toContain("contact shadows");
    }
    expect(close.override.output_requirements).toContain("end-specific fringe");
  });

  it("gives the Runner camera priority over legacy room-camera directions", () => {
    const shot = makeShot({ id: "high_angle_lifestyle" });
    const shapeContext = resolveShapeShotContext({ shape: "runner", shot, prompt: shot.prompt });
    const result = JSON.parse(composeGenerationPrompt({
      prompt: shot.prompt, shapeContext, construction: null, labelLogo: null,
      background: { id: "hall", title: "Hall", type: "runner_hallway", previewImagePath: null,
        prompt: "FINAL REUSABLE ROOM PROMPT: Stone walls and timber floor.\nCAMERA_SIDE: diagonal overhead" }
    }));
    expect(result.camera).toContain("High oblique cropped detail");
    expect(result.background_context.instruction).toContain("must not override");
  });

  it("preserves Round and Runner studio detail cameras", () => {
    const round = resolveShapeShotProfile("round", makeShot({ id: "high_angle_lifestyle" }));
    expect(round.override.camera).not.toContain("Closer, gently elevated");
    const detail = resolveShapeShotProfile("runner", makeShot({ id: "studio_corner_detail" }));
    expect(detail.override.camera).toContain("20-35 degree");
  });

  it("removes stale full-rug draft locks and room framing from the assembled detail", () => {
    const shot = makeShot({ id: "high_angle_lifestyle" });
    const prompt = JSON.stringify({ camera: "OLD CAMERA", crop_lock: "OLD FULL OUTLINE", rug_placement: "OLD BOTH ENDS", output_requirements: "OLD FULL RUG", forbidden_changes: ["OLD NO CROPPING"], lighting: "soft daylight" });
    const shapeContext = resolveShapeShotContext({ shape: "runner", shot, prompt });
    const result = JSON.parse(composeGenerationPrompt({
      prompt, shapeContext, construction: null, labelLogo: null,
      background: { id: "hall", title: "Hall", type: "runner_hallway", previewImagePath: null,
        prompt: "ROOM TYPE: Stone hall\nFLOOR: Limestone\nWALLS: Plaster\nRUG PLACEMENT ZONE: OLD BOTH ENDS\nNEGATIVE CONSTRAINTS: OLD NO CROPPING\nFINAL REUSABLE ROOM PROMPT: OLD FULL RUG\nCAMERA_SIDE: OLD CAMERA" }
    }));
    expect(JSON.stringify(result)).not.toContain("OLD");
    expect(result.background_context.prompt).toContain("Limestone");
    expect(result.crop_lock).toContain("intentionally");
    expect(result.operator_customization.requested_lighting).toBe("soft daylight");
  });
});
