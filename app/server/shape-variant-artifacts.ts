import type { GeneratedResponse } from "../shared/types";
import { SHAPE_VARIANT_SHOT_IDS } from "../shared/shape-variants";

const internalShapeShots = new Set<string>(SHAPE_VARIANT_SHOT_IDS);

export function isShapeVariantShot(shotId: string) {
  return internalShapeShots.has(shotId);
}

export function hideShapeVariantGenerated(generated: GeneratedResponse): GeneratedResponse {
  const aggregates = { ...generated.aggregates };
  for (const shotId of internalShapeShots) delete aggregates[shotId];

  return {
    active: generated.active.filter((asset) => !internalShapeShots.has(asset.shotId)),
    trash: generated.trash.filter((asset) => !internalShapeShots.has(asset.shotId)),
    aggregates
  };
}
