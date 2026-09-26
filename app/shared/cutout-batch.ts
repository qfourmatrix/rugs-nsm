import { z } from "zod";
export const CutoutBatchRequestSchema = z.object({ requestId: z.string().uuid(), productIds: z.array(z.string().min(1).max(240)).min(1).max(5000) }).strict();
export interface CutoutBatchItem {
  productId: string; requestId: string;
  status: "queued" | "processing" | "ready" | "failed" | "attention";
  retryAuthorized?: boolean;
  cutoutId?: string; sourceSha256?: string; error?: string;
}
export interface CutoutBatch {
  id: string; status: "running" | "paused" | "complete";
  items: CutoutBatchItem[]; updatedAt: string; error?: string;
}
