import type { ProductShape, Shot, ShotPromptOverride } from "./types";

export interface ShapeShotContext {
  shape: Exclude<ProductShape, "area">;
  override: Partial<ShotPromptOverride> | null;
  identityInstruction: string;
  backgroundCompatibility: "recommended" | "usable";
}

const RUNNER_OVERRIDES: Record<string, Partial<ShotPromptOverride>> = {
  wide_room_hero: {
    scene: "A premium elongated entry corridor, hallway, or spacious bedside setting whose architecture naturally fits a runner rug.",
    rug_placement: "Place the complete runner lengthwise along the main circulation axis with both short ends visible and clear of furniture.",
    camera: "Wide eye-level interior product photograph composed along the runner's long axis; keep the runner silhouette visibly long and undistorted."
  },
  high_angle_lifestyle: {
    scene: "A refined corridor, long foyer, galley transition, or bedside passage designed around a runner rug.",
    rug_placement: "Show the full runner from a high angle, aligned to the passage with its long sides parallel to the architecture.",
    camera: "High three-quarter angle showing the complete long-format rug without foreshortening it into an area-rug proportion."
  },
  studio_corner_detail: {
    scene: "A clean neutral studio product setup focused on one short end and a substantial section of the runner's long edge.",
    rug_placement: "Keep the runner flat and reveal its true long body, short-end finish, long-edge construction, and pile depth.",
    camera: "Low oblique detail view down the long edge; do not make the runner appear square or crop away all evidence of its long format."
  },
  texture_macro: {
    rug_placement: "Photograph a representative interior section of the runner at true material scale; preserve the runner's exact fibers, colors, and local motif proportions."
  },
  folded_label_detail: {
    rug_placement: "Fold back one short end of the runner only, preserving the long-edge topology and placing the sewn label on the exposed back near that short end."
  }
};

const ROUND_OVERRIDES: Record<string, Partial<ShotPromptOverride>> = {
  wide_room_hero: {
    scene: "A premium dining nook, round-table setting, open foyer, or seating vignette whose layout naturally fits a circular rug.",
    rug_placement: "Place the complete Round rug as the compositional anchor with its entire circular perimeter readable and unblocked.",
    camera: "Wide eye-level interior product photograph that clearly communicates a true circular silhouette rather than an oval or cropped rectangle."
  },
  high_angle_lifestyle: {
    scene: "A refined foyer, dining nook, or compact seating arrangement organized around a Round rug.",
    rug_placement: "Show the full circular rug from above with balanced negative space around the whole perimeter.",
    camera: "High three-quarter angle with enough elevation to preserve an unmistakably circular shape; avoid perspective that makes it look strongly oval."
  },
  studio_corner_detail: {
    scene: "A clean neutral studio product setup focused on the Round rug's curved perimeter and material depth.",
    rug_placement: "Keep the rug flat and show a continuous curved edge, realistic thickness, edge finish, and pile transition.",
    camera: "Low oblique detail view tangent to the curved perimeter; no fabricated square corner."
  },
  texture_macro: {
    rug_placement: "Photograph a representative interior section of the Round rug at true material scale; preserve its exact fibers, colors, and local motif proportions."
  },
  folded_label_detail: {
    rug_placement: "Fold back a small arc of the circular perimeter and place the sewn label on the exposed back near that curved edge; never create a square corner."
  }
};

const RECOMMENDED_BACKGROUND_TYPES: Record<Exclude<ProductShape, "area">, Set<string>> = {
  runner: new Set(["bedroom", "architectural_living"]),
  round: new Set(["interior_living", "architectural_living"])
};

export function resolveShapeShotContext({
  shape,
  shot,
  prompt,
  backgroundType
}: {
  shape: ProductShape;
  shot: Shot;
  prompt: string;
  backgroundType?: string | null;
}): ShapeShotContext | null {
  if (shape === "area") return null;
  const defaultPromptIsActive = prompt.trim() === shot.prompt.trim();
  const normalizedBackgroundType = backgroundType?.trim().toLowerCase() ?? "";
  return {
    shape,
    override: defaultPromptIsActive ? (shape === "runner" ? RUNNER_OVERRIDES : ROUND_OVERRIDES)[shot.id] ?? null : null,
    identityInstruction:
      shape === "runner"
        ? "Image 1 is an approved Runner product. Preserve its exact long-format body ratio, short ends, long edges, design layout, edge finish, and fringe topology in every shot. Never turn it into an Area or Round rug."
        : "Image 1 is an approved Round product. Preserve its exact circular perimeter, circular design layout, edge finish, and material identity in every shot. Never turn it into an oval, square, rectangle, or Runner.",
    backgroundCompatibility: RECOMMENDED_BACKGROUND_TYPES[shape].has(normalizedBackgroundType) ? "recommended" : "usable"
  };
}
