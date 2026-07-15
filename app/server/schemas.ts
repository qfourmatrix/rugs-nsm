import { z } from "zod";
import { DEFAULT_SOS_CUSTOM_PALETTE, SOS_PALETTE_IDS } from "../shared/sos-palettes";

export const AspectRatioSchema = z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]);
export const ImageSizeSchema = z.enum(["1K", "2K", "4K"]);
export const RugConstructionIdSchema = z.enum(["flatweave", "low_pile", "high_pile", "mixed_high_low", "unknown_custom"]);
export const RefinePatternModeSchema = z.enum(["symmetrical", "asymmetrical", "sos"]);
export const SosPaletteIdSchema = z.enum(SOS_PALETTE_IDS);
export const SosCustomPaletteSchema = z
  .object({
    fieldColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    motifColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/)
  })
  .strict();
export const AssetStatusSchema = z.enum(["done", "accepted", "rejected", "failed"]);
export const JobStatusSchema = z.enum(["queued", "generating", "succeeded", "failed", "cancelled"]);
export const ProviderModeSchema = z.enum(["mock", "laozhang"]);

export const ShotSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    defaultAspectRatio: AspectRatioSchema,
    defaultImageSize: ImageSizeSchema
  })
  .strict();

export const MasterShotsSchema = z
  .object({
    version: z.literal(1),
    updatedAt: z.string().datetime(),
    shots: z.array(ShotSchema).min(1).max(20)
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, shot] of value.shots.entries()) {
      if (seen.has(shot.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate shot id "${shot.id}".`,
          path: ["shots", index, "id"]
        });
      }
      seen.add(shot.id);
    }
  });

export const ProductStateSchema = z
  .object({
    version: z.literal(1),
    productId: z.string(),
    createdAt: z.string().datetime(),
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
    promptBox: z
      .object({
        value: z.string(),
        sourceShotId: z.string().nullable(),
        dirty: z.boolean(),
        updatedAt: z.string().datetime()
      })
      .strict(),
    settings: z
      .object({
        aspectRatio: AspectRatioSchema,
        imageSize: ImageSizeSchema,
        concurrency: z.number().int().min(1).max(3),
        batchSize: z.number().int().min(1).max(4).default(1)
      })
      .strict()
  })
  .strict();

export const ProductStatePatchSchema = z
  .object({
    selectedShotId: z.string().nullable().optional(),
    selectedAssetId: z.string().nullable().optional(),
    selectedBackgroundId: z.string().nullable().optional(),
    selectedConstructionId: RugConstructionIdSchema.nullable().optional(),
    refinePatternMode: RefinePatternModeSchema.optional(),
    refineVariationCount: z.number().int().min(1).max(4).optional(),
    sosPaletteId: SosPaletteIdSchema.optional(),
    sosCustomPalette: SosCustomPaletteSchema.optional(),
    sosDesignChange: z.boolean().optional(),
    referenceImages: z.array(z.string()).optional(),
    loadShotId: z.string().optional(),
    promptBox: z
      .object({
        value: z.string().optional(),
        sourceShotId: z.string().nullable().optional(),
        dirty: z.boolean().optional(),
        updatedAt: z.string().datetime().optional()
      })
      .strict()
      .optional(),
    settings: z
      .object({
        aspectRatio: AspectRatioSchema.optional(),
        imageSize: ImageSizeSchema.optional(),
        concurrency: z.number().int().min(1).max(3).optional(),
        batchSize: z.number().int().min(1).max(4).optional()
      })
      .strict()
      .optional()
  })
  .strict();

const AssetSettingsSchema = z
  .object({
    provider: ProviderModeSchema,
    model: z.string(),
    aspectRatio: AspectRatioSchema,
    imageSize: ImageSizeSchema
  })
  .strict();

const BaseImageInputSchema = z
  .object({
    file: z.string(),
    sha256: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    mtimeMs: z.number().nonnegative(),
    mimeType: z.string()
  })
  .strict();

const ProviderPreviewSchema = z
  .object({
    responseModalities: z.array(z.string()),
    aspectRatio: AspectRatioSchema,
    imageSize: ImageSizeSchema,
    inputImageCount: z.number().int().nonnegative()
  })
  .strict();

export const AssetRecordSchema = z
  .object({
    version: z.literal(1),
    assetId: z.string(),
    productId: z.string(),
    shotId: z.string(),
    shotName: z.string(),
    status: AssetStatusSchema,
    attempt: z.number().int().min(1),
    parentAssetId: z.string().nullable(),
    createdAt: z.string().datetime(),
    prompt: z.string(),
    masterShotsVersion: z.number().int().optional(),
    settings: AssetSettingsSchema,
    inputs: z
      .object({
        baseImage: BaseImageInputSchema,
        references: z.array(z.string()),
        background: z
          .object({
            id: z.string(),
            type: z.string(),
            title: z.string(),
            prompt: z.string(),
            previewImagePath: z.string().nullable()
          })
          .strict()
          .nullable()
          .optional(),
        labelLogo: z
          .object({
            file: z.string(),
            path: z.string(),
            sha256: z.string(),
            mimeType: z.string()
          })
          .strict()
          .nullable()
          .optional(),
        construction: z
          .object({
            id: RugConstructionIdSchema,
            name: z.string(),
            prompt: z.string()
          })
          .strict()
          .nullable()
          .optional()
      })
      .strict(),
    output: z
      .object({
        file: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int().nonnegative()
      })
      .strict()
      .nullable(),
    provider: z
      .object({
        requestId: z.string().nullable(),
        durationMs: z.number().nonnegative(),
        normalizedStatus: z.string(),
        requestPreview: ProviderPreviewSchema
      })
      .strict(),
    error: z
      .object({
        message: z.string(),
        code: z.string(),
        raw: z.unknown()
      })
      .strict()
      .nullable()
  })
  .strict();

export const GenerateRequestSchema = z
  .object({
    shotId: z.string(),
    prompt: z.string().min(1),
    settings: z
      .object({
        aspectRatio: AspectRatioSchema,
        imageSize: ImageSizeSchema
      })
      .strict(),
    batchSize: z.number().int().min(1).max(4).default(1),
    referenceImages: z.array(z.string()).max(14).default([]),
    source: z.enum(["prompt_box", "generate_missing", "retry_failed", "retry_exact"]).optional()
  })
  .strict();

export const BulkRequestSchema = z
  .object({
    concurrency: z.number().int().min(1).max(3).optional()
  })
  .strict()
  .optional();
