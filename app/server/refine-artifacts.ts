import type { GeneratedResponse } from "../shared/types";

export const REFINE_SHOT_ID = "refine_base";
export const REFINE_REFERENCE_BASENAME = "refine-reference";

export function isRefineReferenceImage(filename: string) {
  return filename.toLowerCase().startsWith(`${REFINE_REFERENCE_BASENAME}.`);
}

export function withoutRefineReferences(filenames: string[]) {
  return filenames.filter((filename) => !isRefineReferenceImage(filename));
}

export function hideRefineGenerated(generated: GeneratedResponse): GeneratedResponse {
  const aggregates = { ...generated.aggregates };
  delete aggregates[REFINE_SHOT_ID];

  return {
    active: generated.active.filter((asset) => asset.shotId !== REFINE_SHOT_ID),
    trash: generated.trash.filter((asset) => asset.shotId !== REFINE_SHOT_ID),
    aggregates
  };
}
