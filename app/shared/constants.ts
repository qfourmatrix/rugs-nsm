import type { AspectRatio, ImageSize, MasterShots, ProductState, RugConstructionOption } from "./types";
import { DEFAULT_SOS_CUSTOM_PALETTE } from "./sos-palettes";

export const SUPPORTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"] as const;
export const SUPPORTED_ASPECT_RATIOS: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4"];
export const SUPPORTED_IMAGE_SIZES: ImageSize[] = ["1K", "2K", "4K"];

export const DEFAULT_PRODUCT_ROOT = "../data/nsm100k";
export const DEFAULT_PORT = 8787;
export const DEFAULT_CONCURRENCY = 2;
export const MAX_CONCURRENCY = 3;
export const BACKGROUND_REQUIRED_SHOT_IDS = ["wide_room_hero", "high_angle_lifestyle"] as const;
export const LABEL_REQUIRED_SHOT_IDS = ["folded_label_detail"] as const;
export const RUG_CONSTRUCTION_IDS = ["flatweave", "low_pile", "high_pile", "mixed_high_low", "unknown_custom"] as const;

export const RUG_REFERENCE_LOCK =
  "VISUAL LOCK — HIGHEST PRIORITY: Image 1 is the exact rug product. Reproduce the rug exactly as shown in Image 1: same real-world outer shape, same real-world proportions, same border thickness, same corner radius or edge shape, same motif layout, same motif scale, same color placement, same negative space, same fringe/edge binding if present, and same relationship between all design elements. Do not redesign, simplify, stretch, warp, rescale, shrink, narrow, widen, recolor, reinterpret, rebalance, or re-layout the rug pattern. Camera angle and camera framing may show only part of the rug when a shot explicitly requires a detail crop, but the visible crop must be a true camera crop from Image 1 at real product scale; never compress or fit the full rug design into a smaller frame. The rug design must remain visually identical to Image 1 in every shot.";

export const RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE =
  "Apply only the requested pile texture: {{pile_type}}. This may affect fiber softness, pile height, and surface depth only. It must not change the rug's design, silhouette, color map, pattern scale, border width, motif spacing, or proportions.";

export const PROMPT_PRIORITY_NOTE =
  "Use this JSON as the complete generation instruction. Fields appear in priority order. The rug_reference_lock overrides all scene, camera, styling, and material instructions.";

export const FORBIDDEN_RUG_CHANGES = [
  "Do not change the rug outer shape or silhouette.",
  "Do not change motif layout, motif spacing, motif scale, or pattern proportions.",
  "Do not change border thickness, border width, corner radius, edge shape, fringe, or edge binding.",
  "Do not change the rug color map, color placement, negative space, or relationships between design elements.",
  "Do not stretch, warp, rescale, shrink, narrow, widen, simplify, recolor, reinterpret, rebalance, redesign, or re-layout the rug pattern.",
  "Do not fit the full rug design into a detail crop; the rug may continue outside the camera frame when the shot is a close detail.",
  "Do not let scene, camera, lighting, styling, background, label, or material instructions override Image 1."
] as const;

export function rugPileMaterialInstruction(pileType: string) {
  return RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE.replace("{{pile_type}}", pileType);
}

export const RUG_CONSTRUCTION_OPTIONS: RugConstructionOption[] = [
  {
    id: "flatweave",
    name: "Flatweave",
    summary: "Thin, tight woven surface with minimal pile height.",
    prompt: rugPileMaterialInstruction("flatweave")
  },
  {
    id: "low_pile",
    name: "Low pile",
    summary: "Short dense pile with subtle directional fiber sheen.",
    prompt: rugPileMaterialInstruction("low pile")
  },
  {
    id: "high_pile",
    name: "High pile",
    summary: "Taller pile with visible depth, constrained to the locked reference identity.",
    prompt: rugPileMaterialInstruction("high pile")
  },
  {
    id: "mixed_high_low",
    name: "Mixed high-low",
    summary: "Mixed surface height inferred only from the locked reference image.",
    prompt: rugPileMaterialInstruction("mixed high-low pile texture matching only the reference-visible height zones")
  },
  {
    id: "unknown_custom",
    name: "Unknown/custom",
    summary: "Conservative construction inference from the base image.",
    prompt: rugPileMaterialInstruction("infer conservatively from Image 1")
  }
];

const editorialStyleLock = `Premium editorial home decor catalogue photography, realistic DSLR product photography, natural window light, warm afternoon sunlight, soft filmic color grading, gentle highlight rolloff, creamy whites, muted saturation, realistic soft shadows, warm wood tones, balanced warm/cool color separation, interior design magazine aesthetic, natural product integration.`;

const studioStyleLock = `Plain white sweep studio product photography, realistic DSLR/mirrorless catalogue product photo. Continuous matte white seamless paper sweep, controlled softbox lighting, neutral color temperature, clean exposure, neutral white balance, soft contact shadows, restrained contrast, accurate color.`;

const studioGuard = `Studio product check: the rug is the only subject, its geometry is physically plausible, edges rest naturally on the surface, and the final image reads as a clean catalogue product photograph.`;

const detailStudioStyleLock = `Pure-white close-detail product photography, realistic DSLR/mirrorless close crop. Any visible non-rug pixels must be flat solid white void, not a physical paper sweep, floor, wall, tile, panel, fabric, or surface. Controlled neutral lighting, neutral color temperature, clean exposure, neutral white balance, restrained contrast, accurate color.`;

const detailStudioGuard = `Studio close-detail check: the rug is the only subject, the rug is larger than the image frame, its visible edge geometry is physically plausible, and off-frame rug areas continue outside the image boundaries.`;

const detailCropScaleLock = `Detail crop scale lock: this is a close camera crop from Image 1 at real product scale, not a miniature product shot. The rug is physically larger than the image canvas. Do not squeeze, compress, shrink, narrow, rotate-to-fit, or re-layout the full rug design to fit inside the detail frame. Do not show the full rug outline. Off-frame portions of the rug design must continue outside the image boundaries. Preserve the local motif scale, border width, color-map boundaries, fringe scale, and edge thickness exactly as they appear in the corresponding area of Image 1.`;

const cleanStudioBackgroundLock = `Clean background lock: any visible non-rug area must be plain flat white with no depth cues, no texture, no tiles, no panels, no square or rectangular patches, no ghost rectangles, no blurred fabric blocks, no bokeh, no stains, no smudges, no decorative shadows, and no out-of-focus background objects. Do not render a physical studio floor, paper sweep, wall, prop, reflection, or contact patch in the empty area. Shadows may appear only as very subtle contact shadows immediately under the rug edge or fringe, never as detached blocks.`;

type RugShotJsonPrompt = {
  shot_id: string;
  prompt_priority_note: string;
  rug_reference_lock: string;
  allowed_rug_material_instruction: string;
  crop_lock?: string;
  label_instruction?: string;
  front_face?: string;
  back_face?: string;
  fold_geometry?: string;
  fringe_tassel_lock?: string;
  edge_strip_lock?: string;
  label_placement?: string;
  label_geometry_lock?: string;
  scene: string;
  rug_placement: string;
  camera: string;
  lighting: string;
  styling: string;
  forbidden_changes: readonly string[];
  forbidden_label_errors?: readonly string[];
  quality: string;
  output_requirements: string;
};

function serializeRugShotPrompt(prompt: RugShotJsonPrompt) {
  return JSON.stringify(prompt, null, 2);
}

export const PLACEHOLDER_MASTER_SHOTS: MasterShots = {
  version: 1,
  updatedAt: "2026-07-07T00:00:00.000Z",
  shots: [
    {
      id: "wide_room_hero",
      name: "Wide Room Hero",
      prompt: serializeRugShotPrompt({
        shot_id: "wide_room_hero",
        prompt_priority_note: PROMPT_PRIORITY_NOTE,
        rug_reference_lock: RUG_REFERENCE_LOCK,
        allowed_rug_material_instruction: rugPileMaterialInstruction("{{pile_type}}"),
        scene:
          "Wide straight-on lifestyle room hero shot. Reconstruct the selected background as secondary room context, then place the same locked rug naturally on the floor at realistic scale.",
        rug_placement:
          "The full rug must be visible, centered in the foreground, lying flat on the floor with believable contact shadows. Furniture may frame the rug for scale, but it must not cover identity-critical rug areas.",
        camera:
          "Camera at seated eye level, approximately 4-5 feet high, level with straight vertical architecture lines, 28-35mm full-frame lens feel.",
        lighting: "Natural window light, bright airy interior exposure, realistic room shadows, believable floor contact.",
        styling: editorialStyleLock,
        forbidden_changes: FORBIDDEN_RUG_CHANGES,
        quality:
          "Premium editorial home decor catalogue photography with realistic DSLR detail, natural product integration, restrained color grading, and no CGI sheen.",
        output_requirements:
          "Use Image 1 as the product spec, not inspiration. Keep all rug geometry and pattern relationships visually identical to Image 1."
      }),
      defaultAspectRatio: "1:1",
      defaultImageSize: "4K"
    },
    {
      id: "high_angle_lifestyle",
      name: "High-Angle Lifestyle Detail",
      prompt: serializeRugShotPrompt({
        shot_id: "high_angle_lifestyle",
        prompt_priority_note: PROMPT_PRIORITY_NOTE,
        rug_reference_lock: RUG_REFERENCE_LOCK,
        allowed_rug_material_instruction: rugPileMaterialInstruction("{{pile_type}}"),
        scene:
          "High-angle oblique lifestyle product photo in the selected room context. The room is secondary and exists only to show scale, architecture, furniture context, and natural light.",
        rug_placement:
          "The rug fills about 70-85% of the image and remains easy to compare against Image 1. Use partial furniture only at frame edges; no object may hide the center, edges, or identity-critical design areas.",
        camera:
          "Camera above the rug at standing height, angled downward about 50-65 degrees, 35mm DSLR interior-photography feel, not a flat top-down render.",
        lighting: "Natural sunlight, soft realistic interior shadows, visible depth in the rug surface without changing the design.",
        styling: editorialStyleLock,
        forbidden_changes: FORBIDDEN_RUG_CHANGES,
        quality:
          "Premium editorial lifestyle detail with realistic materials, accurate perspective, natural shadows, and no generic rug substitution.",
        output_requirements:
          "Use Image 1 as the product spec, not inspiration. Keep all rug geometry and pattern relationships visually identical to Image 1."
      }),
      defaultAspectRatio: "1:1",
      defaultImageSize: "4K"
    },
    {
      id: "studio_corner_detail",
      name: "Studio Corner Detail",
      prompt: serializeRugShotPrompt({
        shot_id: "studio_corner_detail",
        prompt_priority_note: PROMPT_PRIORITY_NOTE,
        rug_reference_lock: RUG_REFERENCE_LOCK,
        allowed_rug_material_instruction: rugPileMaterialInstruction("{{pile_type}}"),
        crop_lock:
          "The image boundaries are hard camera boundaries, not a container. Capture only a partial local intersection of the Image 1 top-left area. The rug is intentionally larger than the frame and must be cut off by the right and bottom image boundaries. Show no complete rug rectangle, no complete product outline, no full edge length, no complete corner unit, and no centered contained rug. Do not use fit-to-frame, fit-to-canvas, contain, scale-to-fit, shrink-to-fit, padding, or white margins to make the rug fit.",
        scene:
          "Lay the same Image 1 rug flat on a plain matte white studio floor. Photograph only this real rug as a professional macro product image; there is no room, furniture, wall, prop, or second textile.",
        fringe_tassel_lock:
          "Use Image 1 as the exact edge-topology reference. The target is the physical top-left corner of Image 1: tassels run along the top horizontal edge, while the left vertical edge is a plain bound rug edge with no tassels. The top-left corner is therefore one fringed edge meeting one non-fringed bound edge. Do not add, mirror, wrap, or invent tassels on the left side.",
        rug_placement:
          "Use a true macro camera crop at real product scale. The rug is larger than the frame. The frame cuts through the rug on the right and bottom; the rug must continue off-frame beyond those boundaries. Show only a partial top-edge tassel run and a partial bound left edge. Neither edge may be completed inside the image. Do not shrink, narrow, or fit the rug to make the whole design fit.",
        camera:
          "Professional DSLR-style macro product camera, near top-down over the real top-left corner, with a tight crop and enough depth of field to keep the corner geometry, pile, bound edge, and top tassels sharp. This is a physical camera crop, not a cutout or graphic composition.",
        lighting:
          "Even neutral studio lighting on the white floor, with accurate color and a very subtle contact shadow only where the rug touches the floor. No detached shadow shape or lighting object.",
        styling:
          "Clean white-floor product photography. The only subject is the Image 1 rug and its attached top-edge tassels; any white floor is only the physical area outside the cropped rug, never padding used to contain it. Keep the crop boundary clean and the tassels fully attached and opaque.",
        forbidden_changes: FORBIDDEN_RUG_CHANGES,
        quality:
          "Sharp, realistic macro detail with the Image 1 motif scale, border width, pile texture, edge binding, and tassel construction preserved exactly.",
        output_requirements:
          "Return one physically plausible partial top-left crop. The rug must be cut off by the right and bottom image boundaries, with only a short incomplete run of original top-edge tassels and a partial bound left edge visible. Do not show the full rug, complete either edge inside the frame, redesign the pattern, create a second fringed edge, or add any background feature."
      }),
      defaultAspectRatio: "1:1",
      defaultImageSize: "4K"
    },
    {
      id: "texture_macro",
      name: "Texture Macro",
      prompt: serializeRugShotPrompt({
        shot_id: "texture_macro",
        prompt_priority_note: PROMPT_PRIORITY_NOTE,
        rug_reference_lock: RUG_REFERENCE_LOCK,
        allowed_rug_material_instruction: rugPileMaterialInstruction("{{pile_type}}"),
        scene: "Studio macro surface detail from the same Image 1 rug, not a generic texture sample.",
        rug_placement:
          "The rug is much larger than the frame, and the frame is almost entirely rug surface. A tiny matte white paper edge may appear only if useful for context. Visible pattern areas must match Image 1 at real motif scale; do not compress, narrow, or fit the full rug design into the macro frame.",
        camera:
          "Shallow oblique angle around 25-40 degrees with a 70-100mm macro lens feel, natural focus falloff, restrained sharpening. This is a local camera crop; off-frame pattern continues outside the image.",
        lighting: "Controlled side softbox lighting that reveals surface depth without changing color placement or motif scale.",
        styling: `${detailStudioStyleLock} ${detailStudioGuard} ${detailCropScaleLock}`,
        forbidden_changes: FORBIDDEN_RUG_CHANGES,
        quality: "Crisp but natural macro product detail with tactile surface depth.",
        output_requirements:
          "Only a local macro region should be visible. The rug must be larger than the canvas. Preserve real motif scale and let the rest of the rug continue off-frame; do not miniaturize, narrow, simplify, or rebalance any visible pattern."
      }),
      defaultAspectRatio: "1:1",
      defaultImageSize: "4K"
    },
    {
      id: "folded_label_detail",
      name: "Folded Label Detail",
      prompt: serializeRugShotPrompt({
        shot_id: "folded_label_detail",
        prompt_priority_note: PROMPT_PRIORITY_NOTE,
        rug_reference_lock: RUG_REFERENCE_LOCK,
        allowed_rug_material_instruction: rugPileMaterialInstruction("{{pile_type}}"),
        label_instruction:
          "Image 2 is the exact label-logo artwork. Place Image 2 exactly on the sewn cloth label on the rug back side only. Do not omit it, leave the label blank, invent alternate text, redraw the logo, translate it, crop it, distort it, or replace it with generic branding.",
        front_face:
          "FRONT FACE: the front is the plush/pile patterned side from Image 1. It keeps Image 1's exact visible colors, motif boundaries, pile texture, and local motif scale. The front face must never contain the sewn label, logo artwork, printed text, tag patch, or any branding.",
        back_face:
          "BACK FACE — HAND-KNOTTED UNDERSIDE: the exposed flap is the actual reverse of the same hand-knotted Image 1 rug, not a separate backing fabric. Fill the entire exposed underside, right up to its real edges, with dense compact rows of individually visible hand-tied knot backs interlocked through the warp and weft. The low, flat reverse must show a clear but slightly muted mirror/reverse of Image 1's exact local motif shapes and color placement, built from many small colored knot ends with subtle handmade irregularity. It is not a plain beige field. Do not render canvas, duck cloth, jute cloth, linen, monk's cloth, latex, glue, rubber, mesh, synthetic secondary backing, or any attached backing sheet. Do not render a machine-perfect woven grid. Do not add broad parallel horizontal or vertical stripes, rails, channels, ribs, or bands anywhere on the underside. The back must not look like the plush patterned front and must have no raised pile.",
        fold_geometry:
          "FOLD GEOMETRY: fold one real corner over so the folded flap exposes its hand-knotted back side facing the camera. The fold edge shows one continuous rug body: plush front pile on the outside/front side and the compact colored knot foundation on the exposed underside. Do not sandwich the rug with a second fabric layer. The original rug edge and any original fringe/tassels remain separate, visible, and physically continuous with Image 1. Front and back surfaces must remain visually different.",
        fringe_tassel_lock:
          "FRINGE/TASSEL LOCK: if Image 1 shows fringe or tassels in this cropped area, reproduce that exact construction. Keep the same tassel color, strand thickness, strand twist, knot or bundle spacing, bundle count density, tassel length, fray, direction, and attachment method visible in Image 1. Tassels are individual free-hanging strands emerging from the real rug edge; they are not a woven band, not a flat strip, not a combed brush, not braided rope, not macrame loops, and not generic yarn tufts.",
        edge_strip_lock:
          "NO EDGE STRIPS OR WHITE BAR: do not add stacked parallel strips, double or triple perimeter bands, wide binding tape, piping, rails, channels, or decorative borders on any edge of the exposed flap. Do not add any new white, cream, beige, or pale horizontal/diagonal bar across, behind, under, or over the tassels. Do not create an extra hem strip, sleeve, tape, binding band, folded cloth panel, backing extension, or selvedge panel that bridges the tassel roots. The only off-white rectangle allowed is the sewn label itself; the hand-knotted foundation must run continuously to the real rug edge and tassels must remain unobstructed.",
        label_placement:
          "LABEL PLACEMENT: the sewn cloth label is attached only to the exposed woven back side of the folded flap. It is never attached to the plush front face, never printed directly on pile, never floating above the rug, never placed on the main front surface underneath the fold, and never touching, covering, crossing, or replacing the tassels.",
        label_geometry_lock:
          "LABEL GEOMETRY LOCK: every output must use the same label geometry and placement: one off-white sewn rectangular cloth label in landscape orientation, 4:3 aspect ratio, straight edges, subtle stitched border, flat against the exposed back side. Size is consistent: label width about 22% of the image width and label height about 16% of the image height. Placement is consistent: centered on the exposed back-side flap, long edge parallel to the nearest folded rug edge, with a small even margin from the fold and side edges. Do not rotate, resize, reshape, curve, warp, crop, duplicate, or move the label.",
        scene:
          "Close product branding detail from the same hand-knotted Image 1 rug with one corner folded back naturally, the authentic colored-knot reverse clearly exposed across the folded flap, the original tassels/fringe preserved exactly from Image 1, and the exact Image 2 label-logo artwork visible on a sewn label attached to that back side only.",
        rug_placement:
          "The rug is much larger than the frame. The main rug area remains front-face-up and plush/patterned. Fold one real corner back so the folded flap exposes the low, flat, densely hand-knotted reverse with Image 1's local colors and motif geometry visible through the knot backs. The label carrying Image 2 sits on that exposed back side only. The real rug edge and any tassels/fringe remain visible, free, separate, and unchanged from Image 1; no added strip may cross or border them. Let the rug continue beyond the image boundaries. Do not fit the full rug design into the folded detail frame.",
        camera:
          "Close three-quarter top-down view, angled about 45-55 degrees with a 70-100mm macro lens feel. Frame the fold so the distinction between plush front face and flatter woven back face is obvious. Use a true local camera crop; never shrink, narrow, rotate-to-fit, or re-layout motifs to make the whole design readable.",
        lighting: "Soft realistic light with natural fold shadow and believable textile thickness.",
        styling:
          `Premium close product detail. The plush front side and woven back side must read as different physical faces of the same rug. The sewn cloth label must show the supplied Image 2 label-logo artwork exactly and must be stitched to the exposed back side only. Do not leave the label blank. Do not invent readable text, logos, patches, tags, stickers, or extra branding. ${detailCropScaleLock}`,
        forbidden_changes: FORBIDDEN_RUG_CHANGES,
        forbidden_label_errors: [
          "Do not put the label or logo on the plush front face.",
          "Do not print the logo directly onto rug pile.",
          "Do not make the back side look like the plush patterned front.",
          "Do not show the same raised pile texture on the exposed back side.",
          "Do not replace the hand-knotted reverse with plain beige canvas, jute, linen, monk's cloth, mesh, latex, rubber, glue, or synthetic secondary backing.",
          "Do not hide the Image 1 motif and color placement on the reverse; show it as a slightly muted mirror built from dense individual knot backs.",
          "Do not add broad parallel stripes, rails, ribs, channels, stacked edge strips, double or triple borders, wide binding tape, or piping anywhere on the exposed flap.",
          "Do not place the label on the main front surface under the fold.",
          "Do not add a white, cream, beige, or pale bar, hem, sleeve, tape, backing band, folded cloth panel, or selvedge strip across or behind the tassels.",
          "Do not cover, bridge, connect, flatten, merge, tuck, crop away, or replace tassel strands.",
          "Do not change tassel color, strand thickness, twist, knot spacing, bundle density, length, fray, direction, attachment method, or fringe type from Image 1.",
          "Do not replace real tassels with a woven band, combed brush fringe, braided rope, macrame loops, pom-poms, flat selvedge, or generic yarn tufts.",
          "Do not change the label's rectangular 4:3 landscape shape, size, placement, stitched border, or orientation.",
          "Do not duplicate the label or add any other tags, stickers, patches, or branding."
        ],
        quality:
          "Physically plausible fold, realistic rug thickness, authentic dense hand-knotted reverse with individually visible colored knot backs, clear front/back material distinction, unchanged Image 1 tassel construction, no backing sheet, no edge strips, no added pale bar across the tassels, visible supplied label-logo artwork on the back-side label, no generic rug substitution.",
        output_requirements:
          "Only a local folded-corner region should be visible. The rug must be larger than the canvas. The front face remains plush and patterned; the folded flap exposes the authentic low, flat hand-knotted reverse, densely filled with small colored knot backs that form a slightly muted mirror of the exact local Image 1 pattern. The sewn cloth label is on that back side only and must visibly contain Image 2 exactly. Preserve the fixed label shape, size, orientation, stitched border, and placement in every output. Preserve Image 1 tassel/fringe construction exactly and keep tassels unobstructed, with no backing fabric, broad stripes, stacked perimeter strips, wide binding, white bar, hem strip, backing band, or selvedge panel. Preserve real motif scale and let the rest of the rug continue off-frame; do not miniaturize, narrow, or fit the full Image 1 design into the crop."
      }),
      defaultAspectRatio: "1:1",
      defaultImageSize: "4K"
    }
  ]
};

export function createDefaultProductState(productId: string, selectedShotId: string | null = "wide_room_hero"): ProductState {
  const firstShot = PLACEHOLDER_MASTER_SHOTS.shots.find((shot) => shot.id === selectedShotId) ?? PLACEHOLDER_MASTER_SHOTS.shots[0];
  return {
    version: 1,
    productId,
    createdAt: new Date().toISOString(),
    selectedShotId: firstShot?.id ?? null,
    selectedAssetId: null,
    selectedBackgroundId: null,
    selectedConstructionId: null,
    refinePatternMode: "symmetrical",
    refineVariationCount: 3,
    sosPaletteId: "auto_flip",
    sosCustomPalette: { ...DEFAULT_SOS_CUSTOM_PALETTE },
    sosDesignChange: false,
    referenceImages: [],
    promptBox: {
      value: firstShot?.prompt ?? "",
      sourceShotId: firstShot?.id ?? null,
      dirty: false,
      updatedAt: new Date().toISOString()
    },
    settings: {
      aspectRatio: firstShot?.defaultAspectRatio ?? "1:1",
      imageSize: firstShot?.defaultImageSize ?? "4K",
      concurrency: DEFAULT_CONCURRENCY,
      batchSize: 1
    }
  };
}
