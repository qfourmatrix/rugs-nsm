import path from "node:path";
import type {
  ShapeVariantCampaign,
  ShapeVariantRecord,
  ShapeVariantStatus,
  ShapeVariantSummary
} from "../shared/types";
import { ShapeVariantCampaignSchema } from "../shared/schemas";
import { notFoundError, validationError } from "./errors";
import { atomicWriteJson, pathExists, readJsonFile } from "./fsUtils";

const EMPTY_COUNTS: Record<ShapeVariantStatus, number> = {
  planned: 0,
  queued: 0,
  generating: 0,
  needs_review: 0,
  approved: 0,
  failed: 0,
  cancelled: 0,
  stale: 0
};

const mutationChains = new Map<string, Promise<unknown>>();

export function shapeVariantCampaignPath(productRoot: string) {
  return path.join(productRoot, ".product-shot-queue", "shape-variants.json");
}

function emptyCampaign(): ShapeVariantCampaign {
  return { version: 1, updatedAt: new Date().toISOString(), variants: [] };
}

export async function loadShapeVariantCampaign(productRoot: string): Promise<ShapeVariantCampaign> {
  const filePath = shapeVariantCampaignPath(productRoot);
  if (!(await pathExists(filePath))) return emptyCampaign();

  const parsed = ShapeVariantCampaignSchema.safeParse(await readJsonFile(filePath));
  if (!parsed.success) {
    throw validationError(
      "INVALID_SHAPE_VARIANT_CAMPAIGN",
      "Shape-variant campaign data is invalid. Generation was stopped to protect catalog state.",
      parsed.error.issues
    );
  }
  return parsed.data;
}

async function serializeMutation<T>(productRoot: string, mutation: () => Promise<T>): Promise<T> {
  const previous = (mutationChains.get(productRoot) ?? Promise.resolve()).catch(() => undefined);
  const next = previous.then(mutation);
  mutationChains.set(productRoot, next);
  try {
    return await next;
  } finally {
    if (mutationChains.get(productRoot) === next) mutationChains.delete(productRoot);
  }
}

export async function mutateShapeVariantCampaign<T>(
  productRoot: string,
  mutator: (campaign: ShapeVariantCampaign) => T | Promise<T>
): Promise<T> {
  return serializeMutation(productRoot, async () => {
    const campaign = await loadShapeVariantCampaign(productRoot);
    const result = await mutator(campaign);
    campaign.updatedAt = new Date().toISOString();
    campaign.variants.sort((left, right) => left.sourceProductId.localeCompare(right.sourceProductId) || left.shape.localeCompare(right.shape));
    await atomicWriteJson(shapeVariantCampaignPath(productRoot), campaign);
    return result;
  });
}

export function shapeVariantRecordId(sourceProductId: string, shape: ShapeVariantRecord["shape"]) {
  return `${sourceProductId}::${shape}`;
}

export async function getShapeVariantRecord(productRoot: string, id: string) {
  const campaign = await loadShapeVariantCampaign(productRoot);
  const record = campaign.variants.find((candidate) => candidate.id === id);
  if (!record) throw notFoundError("SHAPE_VARIANT_NOT_FOUND", `Unknown shape variant: ${id}`);
  return record;
}

export async function updateShapeVariantRecord(
  productRoot: string,
  id: string,
  updater: (record: ShapeVariantRecord) => void | Promise<void>
) {
  return mutateShapeVariantCampaign(productRoot, async (campaign) => {
    const record = campaign.variants.find((candidate) => candidate.id === id);
    if (!record) throw notFoundError("SHAPE_VARIANT_NOT_FOUND", `Unknown shape variant: ${id}`);
    await updater(record);
    record.updatedAt = new Date().toISOString();
    return structuredClone(record);
  });
}

export function summarizeShapeVariantCampaign(campaign: ShapeVariantCampaign): ShapeVariantSummary {
  const counts = { ...EMPTY_COUNTS };
  for (const record of campaign.variants) counts[record.status] += 1;
  return { records: campaign.variants, counts };
}
