import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMasterShots, validateMasterShots } from "../server/master-shots";
import {
  FORBIDDEN_RUG_CHANGES,
  LABEL_REQUIRED_SHOT_IDS,
  RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE,
  RUG_REFERENCE_LOCK
} from "../shared/constants";
import type { MasterShots } from "../shared/types";
import { cleanupTempWorkspace, makeShot, makeTempWorkspace, pathExists } from "./test-utils";

async function expectValidationFailure(value: unknown, pattern: RegExp): Promise<void> {
  try {
    await validateMasterShots(value);
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toMatch(pattern);
    return;
  }

  throw new Error("Expected master shot validation to fail");
}

describe("master shots validation", () => {
  let workspace: string;
  let productRoot: string;

  beforeEach(async () => {
    workspace = await makeTempWorkspace();
    productRoot = path.join(workspace, "nsm100k");
    await mkdir(productRoot, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempWorkspace(workspace);
  });

  it("creates the placeholder master shot file when it is missing", async () => {
    const shots = await loadMasterShots({ productRoot });

    expect(await pathExists(path.join(productRoot, "master-shots.json"))).toBe(true);
    expect(shots.version).toBe(1);
    expect(shots.shots).toHaveLength(5);
    expect(shots.shots.map((shot) => shot.id)).toEqual([
      "wide_room_hero",
      "high_angle_lifestyle",
      "studio_corner_detail",
      "texture_macro",
      "folded_label_detail"
    ]);
  });

  it("creates placeholder prompts as JSON with the shared rug lock and pile template", async () => {
    const master = await loadMasterShots({ productRoot });

    for (const shot of master.shots) {
      const prompt = JSON.parse(shot.prompt) as Record<string, unknown>;

      expect(prompt.shot_id).toBe(shot.id);
      expect(prompt.rug_reference_lock).toBe(RUG_REFERENCE_LOCK);
      expect(prompt.allowed_rug_material_instruction).toBe(RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE);
      expect(prompt.forbidden_changes).toEqual([...FORBIDDEN_RUG_CHANGES]);
      expect(shot.prompt.match(/\{\{pile_type\}\}/g)).toHaveLength(1);
      expect(Object.keys(prompt).indexOf("rug_reference_lock")).toBeLessThan(Object.keys(prompt).indexOf("scene"));
    }
  });

  it("prevents detail shots from miniaturizing the full rug design into tight crops", async () => {
    const master = await loadMasterShots({ productRoot });
    const detailShotIds = ["studio_corner_detail", "texture_macro", "folded_label_detail"];

    for (const shotId of detailShotIds) {
      const shot = master.shots.find((candidate) => candidate.id === shotId);
      const prompt = JSON.parse(shot?.prompt ?? "{}") as Record<string, unknown>;
      const combined = [
        prompt.scene,
        prompt.rug_placement,
        prompt.camera,
        prompt.styling,
        prompt.output_requirements
      ].join(" ");

      expect(combined).toMatch(/real product scale|real motif scale/i);
      expect(combined).toMatch(/continue off-frame|continue beyond the crop|continues outside this close frame/i);
      expect(combined).toMatch(/larger than the (image )?canvas|larger than the frame/i);
      expect(combined).toMatch(/do not (miniaturize|squeeze|compress|shrink|narrow|fit|re-layout)/i);
    }
  });

  it("keeps studio corner as a physical top-left crop with the reference edge topology", async () => {
    const master = await loadMasterShots({ productRoot });
    const shot = master.shots.find((candidate) => candidate.id === "studio_corner_detail");
    const prompt = JSON.parse(shot?.prompt ?? "{}") as Record<string, unknown>;
    const combined = [
      prompt.scene,
      prompt.crop_lock,
      prompt.fringe_tassel_lock,
      prompt.rug_placement,
      prompt.camera,
      prompt.lighting,
      prompt.styling,
      prompt.quality,
      prompt.output_requirements
    ].join(" ");

    expect(prompt.fringe_tassel_lock).toBeTypeOf("string");
    expect(combined).toMatch(/same Image 1 rug flat/i);
    expect(combined).toMatch(/hard camera boundaries, not a container/i);
    expect(combined).toMatch(/partial local intersection of the Image 1 top-left area/i);
    expect(combined).toMatch(/cut off by the right and bottom image boundaries/i);
    expect(combined).toMatch(/no complete rug rectangle/i);
    expect(combined).toMatch(/no complete corner unit/i);
    expect(combined).toMatch(/fit-to-frame, fit-to-canvas, contain, scale-to-fit, shrink-to-fit/i);
    expect(combined).toMatch(/white margins to make the rug fit/i);
    expect(combined).toMatch(/plain matte white studio floor/i);
    expect(combined).toMatch(/professional macro product image/i);
    expect(combined).toMatch(/physical top-left corner of Image 1/i);
    expect(combined).toMatch(/tassels run along the top horizontal edge/i);
    expect(combined).toMatch(/left vertical edge is a plain bound rug edge with no tassels/i);
    expect(combined).toMatch(/one fringed edge meeting one non-fringed bound edge/i);
    expect(combined).toMatch(/Do not add, mirror, wrap, or invent tassels on the left side/i);
    expect(combined).toMatch(/true macro camera crop/i);
    expect(combined).toMatch(/frame cuts through the rug on the right and bottom/i);
    expect(combined).toMatch(/only a partial top-edge tassel run and a partial bound left edge/i);
    expect(combined).toMatch(/Neither edge may be completed inside the image/i);
    expect(combined).toMatch(/Professional DSLR-style macro product camera/i);
    expect(combined).toMatch(/physical camera crop, not a cutout or graphic composition/i);
    expect(combined).toMatch(/very subtle contact shadow only where the rug touches the floor/i);
    expect(combined).toMatch(/white floor is only the physical area outside the cropped rug, never padding/i);
    expect(combined).toMatch(/fully attached and opaque/i);
    expect(combined).toMatch(/partial bound left edge visible/i);
    expect(combined).toMatch(/Do not show the full rug, complete either edge inside the frame/i);
    expect(combined).not.toMatch(/90-97%|97-99%|roughly 3%|roughly 8%|all four image edges|slice through rug|fully contained fringe row/i);
    expect(combined).not.toMatch(/paper sweep|bokeh|out-of-focus background objects|ghost rectangles|blurred fabric blocks/i);
    expect(combined).not.toMatch(/no secondary shapes, no rectangular forms/i);
  });

  it("requires the folded label shot to use the supplied label-logo reference", async () => {
    const master = await loadMasterShots({ productRoot });
    const shot = master.shots.find((candidate) => candidate.id === "folded_label_detail");
    const prompt = JSON.parse(shot?.prompt ?? "{}") as Record<string, unknown>;
    const combined = [prompt.label_instruction, prompt.scene, prompt.rug_placement, prompt.styling, prompt.output_requirements].join(" ");

    expect(LABEL_REQUIRED_SHOT_IDS).toContain("folded_label_detail");
    expect(combined).toMatch(/Image 2 is the exact label-logo artwork/i);
    expect(combined).toMatch(/must visibly contain Image 2 exactly/i);
    expect(combined).toMatch(/Do not leave the label blank/i);
    expect(combined).not.toMatch(/blank sewn cloth label only unless/i);
  });

  it("locks folded label shot to the rug back side with fixed label geometry", async () => {
    const master = await loadMasterShots({ productRoot });
    const shot = master.shots.find((candidate) => candidate.id === "folded_label_detail");
    const prompt = JSON.parse(shot?.prompt ?? "{}") as Record<string, unknown>;
    const combined = [
      prompt.label_instruction,
      prompt.front_face,
      prompt.back_face,
      prompt.fold_geometry,
      prompt.fringe_tassel_lock,
      prompt.edge_strip_lock,
      prompt.label_placement,
      prompt.label_geometry_lock,
      prompt.scene,
      prompt.rug_placement,
      prompt.camera,
      prompt.styling,
      Array.isArray(prompt.forbidden_label_errors) ? prompt.forbidden_label_errors.join(" ") : "",
      prompt.quality,
      prompt.output_requirements
    ].join(" ");

    expect(prompt.front_face).toBeTypeOf("string");
    expect(prompt.back_face).toBeTypeOf("string");
    expect(prompt.fold_geometry).toBeTypeOf("string");
    expect(prompt.fringe_tassel_lock).toBeTypeOf("string");
    expect(prompt.edge_strip_lock).toBeTypeOf("string");
    expect(prompt.label_placement).toBeTypeOf("string");
    expect(prompt.label_geometry_lock).toBeTypeOf("string");
    expect(prompt.forbidden_label_errors).toEqual(expect.any(Array));
    expect(combined).toMatch(/back side only/i);
    expect(combined).toMatch(/front face must never contain the sewn label/i);
    expect(combined).toMatch(/never attached to the plush front face/i);
    expect(combined).toMatch(/actual reverse of the same hand-knotted Image 1 rug/i);
    expect(combined).toMatch(/individually visible hand-tied knot backs/i);
    expect(combined).toMatch(/slightly muted mirror\/reverse of Image 1's exact local motif shapes and color placement/i);
    expect(combined).toMatch(/not a plain beige field/i);
    expect(combined).toMatch(/not a separate backing fabric/i);
    expect(combined).toMatch(/Do not render canvas, duck cloth, jute cloth, linen, monk's cloth, latex, glue, rubber, mesh, synthetic secondary backing/i);
    expect(combined).toMatch(/Do not render a machine-perfect woven grid/i);
    expect(combined).toMatch(/Do not add broad parallel horizontal or vertical stripes, rails, channels, ribs, or bands/i);
    expect(combined).toMatch(/must not look like the plush patterned front/i);
    expect(combined).toMatch(/same label geometry and placement/i);
    expect(combined).toMatch(/4:3 aspect ratio/i);
    expect(combined).toMatch(/width about 22% of the image width/i);
    expect(combined).toMatch(/height about 16% of the image height/i);
    expect(combined).toMatch(/centered on the exposed back-side flap/i);
    expect(combined).toMatch(/Do not rotate, resize, reshape, curve, warp, crop, duplicate, or move the label/i);
    expect(combined).toMatch(/same tassel color, strand thickness, strand twist, knot or bundle spacing, bundle count density, tassel length/i);
    expect(combined).toMatch(/not a woven band, not a flat strip, not a combed brush/i);
    expect(combined).toMatch(/do not add any new white, cream, beige, or pale .*bar across, behind, under, or over the tassels/i);
    expect(combined).toMatch(/only off-white rectangle allowed is the sewn label itself/i);
    expect(combined).toMatch(/do not add stacked parallel strips, double or triple perimeter bands, wide binding tape, piping/i);
    expect(combined).toMatch(/Do not cover, bridge, connect, flatten, merge, tuck, crop away, or replace tassel strands/i);
    expect(combined).toMatch(/Do not change tassel color, strand thickness, twist, knot spacing, bundle density, length, fray, direction, attachment method, or fringe type/i);
    expect(combined).not.toMatch(/visible top surface, edge, underside, label placement, and fold geometry must remain consistent with Image 1/i);
  });

  it("accepts a valid master shot document", async () => {
    const valid: MasterShots = {
      version: 1,
      updatedAt: "2026-06-29T00:00:00.000Z",
      shots: [
        makeShot({ id: "hero", name: "Hero" }),
        makeShot({ id: "catalog_clean", name: "Catalog Clean", defaultImageSize: "2K" })
      ]
    };

    expect(await validateMasterShots(valid)).toMatchObject(valid);
  });

  it("rejects duplicate shot IDs", async () => {
    await expectValidationFailure(
      {
        version: 1,
        updatedAt: "2026-06-29T00:00:00.000Z",
        shots: [makeShot({ id: "hero" }), makeShot({ id: "hero", name: "Hero 2" })]
      },
      /duplicate|unique|shot id/i
    );
  });

  it("rejects prose master shot prompts", async () => {
    await expectValidationFailure(
      {
        version: 1,
        updatedAt: "2026-06-29T00:00:00.000Z",
        shots: [makeShot({ id: "hero", prompt: "Generate a non-JSON hero image." })]
      },
      /serialized JSON/i
    );
  });

  it("rejects unsupported aspect ratios and image sizes", async () => {
    await expectValidationFailure(
      {
        version: 1,
        updatedAt: "2026-06-29T00:00:00.000Z",
        shots: [
          {
            ...makeShot({ id: "wide" }),
            defaultAspectRatio: "21:9",
            defaultImageSize: "8K"
          }
        ]
      },
      /aspect|image size|unsupported|invalid/i
    );
  });
});
