import { z } from "zod";
import {
  FORBIDDEN_RUG_CHANGES,
  RUG_CONSTRUCTION_IDS,
  RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE,
  RUG_REFERENCE_LOCK,
  SUPPORTED_ASPECT_RATIOS,
  SUPPORTED_IMAGE_SIZES
} from "./constants";
import { DEFAULT_SOS_CUSTOM_PALETTE, SOS_PALETTE_IDS } from "./sos-palettes";

export const AspectRatioSchema = z.enum(SUPPORTED_ASPECT_RATIOS);
export const ImageSizeSchema = z.enum(SUPPORTED_IMAGE_SIZES);
export const RugConstructionIdSchema = z.enum(RUG_CONSTRUCTION_IDS);
export const RefinePatternModeSchema = z.enum(["symmetrical", "asymmetrical", "sos"]);
export const ProductShapeSchema = z.enum(["area", "runner", "round"]);
export const RunnerRoomShotIdSchema = z.enum(["wide_room_hero", "high_angle_lifestyle"]);
export const RunnerBackgroundArchetypeSchema = z.enum([
  "long_hallway_gallery",
  "entry_foyer_lane",
  "open_living_circulation",
  "bedside_passage",
  "kitchen_galley_transition",
  "stair_landing_corridor"
]);
export const ShapeVariantShapeSchema = z.enum(["runner", "round"]);
export const ShapeVariantStrategySchema = z.enum(["auto", "repeat_border", "endcap", "stripe_band", "focal", "asymmetrical"]);
export const RoundEdgePolicySchema = z.enum(["bound", "preserve_source", "radial_fringe"]);
export const ShapeVariantStatusSchema = z.enum([
  "planned",
  "queued",
  "generating",
  "needs_review",
  "approved",
  "failed",
  "cancelled",
  "stale"
]);
export const SosPaletteIdSchema = z.enum(SOS_PALETTE_IDS);
export const SosCustomPaletteSchema = z
  .object({
    fieldColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    motifColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
  })
  .strict();

function parsePromptObject(prompt: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(prompt);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function containsForbiddenCoverage(items: unknown, pattern: RegExp) {
  return Array.isArray(items) && items.some((item) => typeof item === "string" && pattern.test(item));
}

const ShotPromptOverrideSchema = z.object({
  scene: z.string().trim().min(1),
  rug_placement: z.string().trim().min(1),
  camera: z.string().trim().min(1),
  lighting: z.string().trim().min(1).optional(),
  styling: z.string().trim().min(1).optional(),
  quality: z.string().trim().min(1).optional(),
  output_requirements: z.string().trim().min(1).optional()
}).strict();

export const ShotSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  prompt: z.string().min(1),
  backgroundTypeOverrides: z.record(z.string().regex(/^[a-z0-9_]+$/), ShotPromptOverrideSchema).optional(),
  defaultAspectRatio: AspectRatioSchema,
  defaultImageSize: ImageSizeSchema
}).superRefine((shot, ctx) => {
  const prompt = parsePromptObject(shot.prompt);

  if (!prompt) {
    ctx.addIssue({
      code: "custom",
      path: ["prompt"],
      message: "Shot prompt must be serialized JSON."
    });
    return;
  }

  if (prompt.shot_id !== shot.id) {
    ctx.addIssue({
      code: "custom",
      path: ["prompt", "shot_id"],
      message: `Shot prompt shot_id must match shot id: ${shot.id}`
    });
  }

  if (prompt.rug_reference_lock !== RUG_REFERENCE_LOCK) {
    ctx.addIssue({
      code: "custom",
      path: ["prompt", "rug_reference_lock"],
      message: "Shot prompt must include the shared rug reference lock exactly."
    });
  }

  if (prompt.allowed_rug_material_instruction !== RUG_PILE_MATERIAL_INSTRUCTION_TEMPLATE) {
    ctx.addIssue({
      code: "custom",
      path: ["prompt", "allowed_rug_material_instruction"],
      message: "Shot prompt must include the shared constrained pile instruction template exactly."
    });
  }

  const requiredStringFields = [
    "prompt_priority_note",
    "scene",
    "rug_placement",
    "camera",
    "lighting",
    "styling",
    "quality",
    "output_requirements"
  ];

  for (const field of requiredStringFields) {
    if (typeof prompt[field] !== "string" || !prompt[field].trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["prompt", field],
        message: `Shot prompt must include non-empty ${field}.`
      });
    }
  }

  for (const [label, pattern] of [
    ["shape", /shape|silhouette/i],
    ["motif layout", /motif layout|motif spacing/i],
    ["border", /border/i],
    ["pattern scale", /pattern proportions|motif scale/i],
    ["color map", /color map|color placement/i],
    ["warping", /warp|stretch/i],
    ["cropping", /crop/i]
  ] as const) {
    if (!containsForbiddenCoverage(prompt.forbidden_changes, pattern)) {
      ctx.addIssue({
        code: "custom",
        path: ["prompt", "forbidden_changes"],
        message: `Shot prompt forbidden_changes must cover ${label}.`
      });
    }
  }

  if (Array.isArray(prompt.forbidden_changes) && prompt.forbidden_changes.length < FORBIDDEN_RUG_CHANGES.length) {
    ctx.addIssue({
      code: "custom",
      path: ["prompt", "forbidden_changes"],
      message: "Shot prompt forbidden_changes must include the shared forbidden rug changes."
    });
  }
});

export const MasterShotsSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().min(1),
  shots: z.array(ShotSchema).min(1).max(20)
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.shots.forEach((shot, index) => {
    if (seen.has(shot.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["shots", index, "id"],
        message: `Duplicate shot id: ${shot.id}`
      });
    }
    seen.add(shot.id);
  });
});

export const ProductStateSchema = z.object({
  version: z.literal(1),
  productId: z.string().min(1),
  createdAt: z.string().min(1),
  selectedShotId: z.string().nullable(),
  selectedAssetId: z.string().nullable(),
  selectedBackgroundId: z.string().nullable().default(null),
  selectedConstructionId: RugConstructionIdSchema.nullable().default(null),
  refinePatternMode: RefinePatternModeSchema.default("symmetrical"),
  refineVariationCount: z.number().int().min(1).max(4).default(3),
  sosPaletteId: SosPaletteIdSchema.default("auto_flip"),
  sosCustomPalette: SosCustomPaletteSchema.default(DEFAULT_SOS_CUSTOM_PALETTE),
  sosDesignChange: z.boolean().default(false),
  referenceImages: z.array(z.string()).default([]),
  promptBox: z.object({
    value: z.string(),
    sourceShotId: z.string().nullable(),
    dirty: z.boolean(),
    updatedAt: z.string().min(1)
  }),
  settings: z.object({
    aspectRatio: AspectRatioSchema,
    imageSize: ImageSizeSchema,
    concurrency: z.number().int().min(1).max(3),
    batchSize: z.number().int().min(1).max(4).default(1)
  })
});

const BaseImageInfoSchema = z.object({
  file: z.string().min(1),
  sha256: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  mimeType: z.string().min(1)
});

export const AssetRecordSchema = z.object({
  version: z.literal(1),
  assetId: z.string().min(1),
  productId: z.string().min(1),
  shotId: z.string().min(1),
  shotName: z.string().min(1),
  status: z.enum(["done", "accepted", "rejected", "failed"]),
  attempt: z.number().int().min(1),
  parentAssetId: z.string().nullable(),
  createdAt: z.string().min(1),
  prompt: z.string(),
  masterShotsVersion: z.number().optional(),
  settings: z.object({
    provider: z.enum(["mock", "laozhang"]),
    model: z.string().min(1),
    aspectRatio: AspectRatioSchema,
    imageSize: ImageSizeSchema
  }),
  inputs: z.object({
    baseImage: BaseImageInfoSchema,
    references: z.array(z.string()),
    background: z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      prompt: z.string(),
      previewImagePath: z.string().nullable(),
      runnerArchetype: RunnerBackgroundArchetypeSchema.nullable().optional(),
      runnerShotCompatibility: z.array(RunnerRoomShotIdSchema).optional()
    }).nullable().optional(),
    labelLogo: z.object({
      file: z.string(),
      path: z.string(),
      sha256: z.string(),
      mimeType: z.string()
    }).nullable().optional(),
    construction: z.object({
      id: RugConstructionIdSchema,
      name: z.string(),
      prompt: z.string()
    }).nullable().optional(),
    shapeVariant: z.object({
      familyId: z.string().min(1),
      sourceProductId: z.string().min(1),
      variantProductId: z.string().min(1),
      shape: ShapeVariantShapeSchema,
      strategy: ShapeVariantStrategySchema,
      runnerRatio: z.number().min(2).max(6).nullable(),
      roundEdgePolicy: RoundEdgePolicySchema.nullable(),
      promptVersion: z.string().min(1),
      runId: z.string().min(1)
    }).strict().nullable().optional()
  }),
  output: z.object({
    file: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative()
  }).nullable(),
  provider: z.object({
    requestId: z.string().nullable(),
    durationMs: z.number().nonnegative(),
    normalizedStatus: z.string().min(1),
    requestPreview: z.object({
      responseModalities: z.array(z.string()),
      aspectRatio: AspectRatioSchema,
      imageSize: ImageSizeSchema,
      inputImageCount: z.number().int().min(1)
    })
  }),
  error: z.object({
    message: z.string(),
    code: z.string(),
    raw: z.unknown()
  }).nullable()
});

export const GenerateRequestSchema = z.object({
  shotId: z.string().regex(/^[a-z0-9_]+$/),
  prompt: z.string().min(1),
  settings: z.object({
    aspectRatio: AspectRatioSchema,
    imageSize: ImageSizeSchema
  }),
  batchSize: z.number().int().min(1).max(4).default(1),
  referenceImages: z.array(z.string()).max(14).default([]),
  source: z.enum(["prompt_box", "retry_exact"]).default("prompt_box")
});

export const BulkGenerateRequestSchema = z.object({
  settings: z.object({
    aspectRatio: AspectRatioSchema,
    imageSize: ImageSizeSchema
  }),
  batchSize: z.number().int().min(1).max(4).default(1),
  referenceImages: z.array(z.string()).max(14).default([]),
  shotIds: z.array(z.string().regex(/^[a-z0-9_]+$/)).optional()
});

export const RefineRequestSchema = z
  .object({
    imageSize: ImageSizeSchema.default("4K"),
    patternMode: RefinePatternModeSchema.default("symmetrical"),
    variationCount: z.number().int().min(1).max(4).default(3),
    sosPaletteId: SosPaletteIdSchema.default("auto_flip"),
    sosCustomPalette: SosCustomPaletteSchema.default(DEFAULT_SOS_CUSTOM_PALETTE),
    sosDesignChange: z.boolean().default(false)
  })
  .strict();

export const ShapeVariantMetadataSchema = z.object({
  version: z.literal(1),
  familyId: z.string().min(1),
  sourceProductId: z.string().min(1),
  shape: ShapeVariantShapeSchema,
  sourceBaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAssetId: z.string().min(1),
  promptVersion: z.string().min(1),
  createdAt: z.string().datetime()
}).strict();

export const ShapeVariantRecordSchema = z.object({
  id: z.string().min(1),
  familyId: z.string().min(1),
  sourceProductId: z.string().min(1),
  variantProductId: z.string().min(1),
  shape: ShapeVariantShapeSchema,
  status: ShapeVariantStatusSchema,
  strategy: ShapeVariantStrategySchema,
  runnerRatio: z.number().min(2).max(6).nullable(),
  roundEdgePolicy: RoundEdgePolicySchema.nullable(),
  imageSize: z.enum(["2K", "4K"]),
  candidateCount: z.union([z.literal(1), z.literal(2)]),
  sourceBaseFile: z.string().min(1),
  sourceBaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
  promptVersion: z.string().min(1),
  prompt: z.string().min(1),
  candidateAssetIds: z.array(z.string()),
  approvedAssetId: z.string().nullable(),
  activeRunId: z.string().nullable(),
  requestedCandidateCount: z.number().int().nonnegative(),
  completedCandidateCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

export const ShapeVariantCampaignSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime(),
  variants: z.array(ShapeVariantRecordSchema)
}).strict();

export const ShapeVariantPrepareRequestSchema = z.object({
  sourceProductIds: z.array(z.string().min(1)).min(1).max(500),
  shapes: z.array(ShapeVariantShapeSchema).min(1).max(2).default(["runner", "round"]),
  strategy: ShapeVariantStrategySchema.default("auto"),
  runnerRatio: z.number().min(2).max(6).default(3.33),
  roundEdgePolicy: RoundEdgePolicySchema.default("preserve_source"),
  imageSize: z.enum(["2K", "4K"]).default("4K"),
  candidateCount: z.union([z.literal(1), z.literal(2)]).default(1)
}).strict();

export const ShapeVariantGenerateRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500)
}).strict();

export const ShapeVariantApproveRequestSchema = z.object({
  assetId: z.string().min(1)
}).strict();

export const ShapeVariantShotsBatchRequestSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(100),
  imageSize: z.enum(["2K", "4K"]).default("4K")
}).strict();
