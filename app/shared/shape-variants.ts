import type {
  RoundEdgePolicy,
  ShapeVariantShape,
  ShapeVariantStrategy
} from "./types";

export const RUNNER_VARIANT_SHOT_ID = "shape_runner_base";
export const ROUND_VARIANT_SHOT_ID = "shape_round_base";
export const SHAPE_VARIANT_SHOT_IDS = [RUNNER_VARIANT_SHOT_ID, ROUND_VARIANT_SHOT_ID] as const;
export const RUNNER_PROMPT_VERSION = "runner-v1";
export const ROUND_PROMPT_VERSION = "round-v1";

const STRATEGY_INSTRUCTIONS: Record<ShapeVariantStrategy, string> = {
  auto: "Infer the source design grammar, then choose the least-destructive reconstruction method for that grammar.",
  repeat_border: "Preserve border width and motif scale; extend the design by adding whole repeats, never by stretching existing repeats.",
  endcap: "Preserve recognizable end panels or end motifs and extend or rebuild only the center field between them.",
  stripe_band: "Keep every stripe and band at its original visual width and preserve the color rhythm; change only the number or continuation of repeats.",
  focal: "Redraw the focal composition for the new boundary while preserving the focal motif's proportions, visual weight, orientation, and surrounding negative space.",
  asymmetrical: "Preserve the source's directional balance and relative zone relationships; recompose minimally for the new boundary without mirroring or forcing symmetry."
};

const ROUND_EDGE_INSTRUCTIONS: Record<RoundEdgePolicy, string> = {
  bound: "Finish the circular perimeter with a clean bound edge using the source rug's existing edge color and material language.",
  preserve_source: "Preserve the source rug's edge treatment wherever physically plausible. Do not invent fringe, binding, or a contrasting perimeter absent from the source.",
  radial_fringe: "Use short, evenly distributed radial fringe around the circular perimeter, matching the source fringe's fiber, color, density, and length."
};

function sharedIdentityRules() {
  return [
    "Image 1 is the sole product-identity authority.",
    "Preserve the exact color palette, color placement logic, fiber/material, pile height, weave character, texture, edge finish, and handmade irregularity visible in Image 1.",
    "Preserve motif scale and line/border thickness in real visual terms; do not scale the entire rectangular artwork to fit.",
    "This is a product-family extension: create a genuinely manufactured sibling rug, not a liquified, warped, squeezed, stretched, or merely masked copy.",
    "Do not add text, logos, props, furniture, people, labels, extra objects, new colors, or new decorative motifs.",
    "Render one complete rug only, isolated and centered on a pure white square catalog canvas, viewed straight down with orthographic product-photography geometry.",
    "Keep the complete perimeter visible with generous white space. No perspective tilt, clipped edges, drop-shadow drama, room scene, floor texture, or environmental background.",
    "Retain realistic rug thickness, pile direction, subtle natural edge variation, and photographic material detail."
  ];
}

export function promptVersionForShape(shape: ShapeVariantShape) {
  return shape === "runner" ? RUNNER_PROMPT_VERSION : ROUND_PROMPT_VERSION;
}

export function shotIdForShape(shape: ShapeVariantShape) {
  return shape === "runner" ? RUNNER_VARIANT_SHOT_ID : ROUND_VARIANT_SHOT_ID;
}

export function shotNameForShape(shape: ShapeVariantShape) {
  return shape === "runner" ? "Runner Design Candidate" : "Round Design Candidate";
}

export function buildShapeVariantPrompt({
  shape,
  strategy,
  runnerRatio,
  roundEdgePolicy
}: {
  shape: ShapeVariantShape;
  strategy: ShapeVariantStrategy;
  runnerRatio: number;
  roundEdgePolicy: RoundEdgePolicy;
}) {
  const shared = sharedIdentityRules();

  if (shape === "runner") {
    return JSON.stringify(
      {
        task: "Create the Runner sibling of the exact area rug shown in Image 1.",
        prompt_version: RUNNER_PROMPT_VERSION,
        target_geometry: `A long horizontal runner rug whose physical rug body is approximately ${runnerRatio.toFixed(2)}:1, displayed within a square output image.`,
        design_strategy: STRATEGY_INSTRUCTIONS[strategy],
        reconstruction_rules: [
          ...shared,
          "Reconstruct the design specifically for a long runner format. Never resize the source rectangle non-uniformly.",
          "For all-over or border patterns, add or remove complete repeats while preserving repeat dimensions and border thickness.",
          "For endcap designs, keep the endcaps recognizable and extend the central field.",
          "For stripes or bands, preserve stripe widths, spacing, order, and direction; continue their rhythm across the runner.",
          "For focal, diagonal, or sparse compositions, redraw their relationships across the long field without duplicating a singular focal motif unless repetition is clearly part of the source grammar.",
          "If the source has fringe, preserve its original topology: fringe stays only on the equivalent short end or ends. Do not move fringe onto the long sides."
        ],
        output_checks: [
          "true runner silhouette",
          "approximately requested body ratio",
          "no stretching or squeezing",
          "source palette and materials unchanged",
          "whole rug visible on pure white"
        ]
      },
      null,
      2
    );
  }

  return JSON.stringify(
    {
      task: "Create the Round sibling of the exact area rug shown in Image 1.",
      prompt_version: ROUND_PROMPT_VERSION,
      target_geometry: "A true circular rug, not an oval, displayed within a square output image.",
      design_strategy: STRATEGY_INSTRUCTIONS[strategy],
      edge_policy: ROUND_EDGE_INSTRUCTIONS[roundEdgePolicy],
      reconstruction_rules: [
        ...shared,
        "Reconstruct the design specifically for a circular boundary. Never squeeze a rectangle into a circle and never leave square corners.",
        "Do not automatically turn straight bands, stripes, or motifs into radial spokes or concentric rings.",
        "For all-over patterns, use a balanced circular crop/reframe while retaining original motif dimensions.",
        "For a central focal motif, keep it centered and proportional, rebuilding only the surrounding field for the circular edge.",
        "For bordered designs, create a continuous circular border at the original visual thickness and resolve corner motifs intentionally rather than smearing them around the perimeter.",
        "For directional or asymmetrical designs, preserve direction and visual balance with the smallest possible reflow. Do not force symmetry."
      ],
      output_checks: [
        "mathematically convincing circular silhouette",
        "no oval distortion",
        "no square corners",
        "no automatic radialization",
        "source palette and materials unchanged",
        "whole rug visible on pure white"
      ]
    },
    null,
    2
  );
}
