import { z } from "zod";

export const WebpSettingsSchema = z.object({
  quality: z.number().int().min(1).max(100).default(90),
  maximumDimension: z.number().int().min(256).max(4096).default(4096),
  lossless: z.boolean().default(false)
}).strict();
export const MainImageSettingsSchema = z.object({
  cutoutId: z.string().uuid().optional(),
  reviewedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  portrait: z.boolean().default(false),
  rotation: z.number().min(-180).max(180).default(0),
  trim: z.boolean().default(false),
  trimThreshold: z.number().min(1).max(40).default(10),
  occupancy: z.number().int().min(40).max(100).default(90),
  frame: z.boolean().default(false),
  background: z.string().regex(/^#[a-fA-F0-9]{6}$/).default("#f1eee8")
}).strict();
export const ExportPreparationSchema = z.object({
  webp: WebpSettingsSchema.default(() => WebpSettingsSchema.parse({})),
  mainImages: z.record(z.string().min(1).max(240), MainImageSettingsSchema).default({})
}).strict();
export const ExportPreviewSchema = z.object({
  productId: z.string().trim().min(1).max(240),
  assetId: z.string().trim().min(1).max(240).optional(),
  preparation: ExportPreparationSchema,
  purpose: z.enum(["layout", "webp"]).default("webp")
}).strict();
export type WebpSettings = z.infer<typeof WebpSettingsSchema>;
export type MainImageSettings = z.infer<typeof MainImageSettingsSchema>;
export type ExportPreparation = z.infer<typeof ExportPreparationSchema>;
export const DEFAULT_WEBP = WebpSettingsSchema.parse({});
export const DEFAULT_MAIN_IMAGE = MainImageSettingsSchema.parse({});
export const DEFAULT_PREPARATION = ExportPreparationSchema.parse({});
export interface ExportPreview {
  image: string;
  reference: string;
  sourceBytes: number;
  outputBytes: number;
  width: number;
  height: number;
  sourceSha256: string;
}
