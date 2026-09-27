import { z } from "zod";
export const TOP_DOWN_SHOT_ID = "top_down_base";
export const TOP_DOWN_PROMPT = "Use the attached original rug as the only product reference. Produce a straight, directly overhead product photograph: rug lying flat, camera perpendicular to its plane, long axis vertical, whole rug and all fringe visible with clear space around it on a plain neutral background. Preserve the exact rug design, motif count and placement, proportions, colors, wool texture and fringe. Change only camera perspective and placement; do not redesign, add motifs, remove fringe or invent hidden details.";
export const RestorePolygonSchema = z.object({
  requestId: z.string().uuid(),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(3).max(128)
}).strict();
export type RestorePoint = z.infer<typeof RestorePolygonSchema>["points"][number];
export interface TopDownState {
  sourceSha256: string;
  originalSha256: string | null;
  canRestore: boolean;
  candidates: Array<{ assetId: string; file: string; createdAt: string }>;
}
