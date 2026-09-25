import { z } from "zod";

export const BACKGROUND_RECOMMENDATIONS_FILENAME = "background-recommendations.json";
const basename = z.string().min(1).max(200).refine(value => !/[\\/]/.test(value) && value !== "." && value !== "..", "Must be a basename");
const choice = z.object({
  backgroundId: z.string().min(1).max(200),
  reason: z.string().trim().min(1).max(280)
}).strict();
export const CuratedProductRecommendationsSchema = z.object({
  productId: basename,
  shape: z.enum(["area", "runner", "round"]),
  baseImage: z.object({ file: basename, size: z.number().int().positive(), mtimeMs: z.number().int().nonnegative() }).strict(),
  recommendations: z.array(choice).min(1).max(12)
}).strict().refine(entry => new Set(entry.recommendations.map(item => item.backgroundId)).size === entry.recommendations.length, "Duplicate background recommendations");
export const BackgroundRecommendationsPackSchema = z.object({
  version: z.literal(1),
  curatedAt: z.string().datetime(),
  products: z.array(CuratedProductRecommendationsSchema).max(10000)
}).strict().refine(pack => new Set(pack.products.map(item => item.productId)).size === pack.products.length, "Duplicate product recommendations");
export type BackgroundRecommendationsPack = z.infer<typeof BackgroundRecommendationsPackSchema>;
export const BackgroundRecommendationsResponseSchema = z.object({
  productId: z.string(),
  status: z.enum(["ready", "not_curated", "stale", "unavailable", "not_applicable"]),
  curatedAt: z.string().datetime().nullable(),
  unavailableCount: z.number().int().nonnegative(),
  recommendations: z.array(choice.extend({ rank: z.number().int().positive() })).max(12)
}).strict();
export type BackgroundRecommendationsResponse = z.infer<typeof BackgroundRecommendationsResponseSchema>;
