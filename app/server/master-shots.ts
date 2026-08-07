import path from "node:path";
import {
  BEDROOM_BACKGROUND_TYPE,
  BEDROOM_SHOT_OVERRIDES,
  PLACEHOLDER_MASTER_SHOTS
} from "../shared/constants";
import type { MasterShots } from "../shared/types";
import { MasterShotsSchema } from "../shared/schemas";
import { AppError } from "./errors";
import { atomicWriteJson, ensureDir, pathExists, readJsonFile } from "./fsUtils";

export async function validateMasterShots(value: unknown): Promise<MasterShots> {
  const parsed = MasterShotsSchema.safeParse(value);

  if (!parsed.success) {
    throw new AppError(400, "INVALID_MASTER_SHOTS", `Invalid master-shots.json: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  return parsed.data;
}

function withBuiltInBedroomOverrides(masterShots: MasterShots): MasterShots {
  return {
    ...masterShots,
    shots: masterShots.shots.map((shot) => {
      const builtInOverride = BEDROOM_SHOT_OVERRIDES[shot.id];
      if (!builtInOverride) return shot;

      return {
        ...shot,
        backgroundTypeOverrides: {
          [BEDROOM_BACKGROUND_TYPE]: builtInOverride,
          ...shot.backgroundTypeOverrides
        }
      };
    })
  };
}

export async function loadMasterShots({ productRoot }: { productRoot: string }): Promise<MasterShots> {
  await ensureDir(productRoot);
  const masterPath = path.join(productRoot, "master-shots.json");

  if (!(await pathExists(masterPath))) {
    await atomicWriteJson(masterPath, PLACEHOLDER_MASTER_SHOTS);
    return PLACEHOLDER_MASTER_SHOTS;
  }

  return withBuiltInBedroomOverrides(await validateMasterShots(await readJsonFile(masterPath)));
}

export async function saveMasterShots({ productRoot, masterShots }: { productRoot: string; masterShots: unknown }): Promise<MasterShots> {
  const validated = await validateMasterShots(masterShots);
  await atomicWriteJson(path.join(productRoot, "master-shots.json"), validated);
  return validated;
}
