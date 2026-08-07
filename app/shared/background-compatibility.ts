import type { ProductShape, RunnerRoomShotId } from "./types";

interface RunnerCompatibleBackground {
  type: string;
}

export const RUNNER_ROOM_SHOT_IDS = ["wide_room_hero", "high_angle_lifestyle"] as const satisfies readonly RunnerRoomShotId[];
export const RUNNER_ROOM_BACKGROUND_TYPES = ["runner_foyer", "runner_hallway"] as const;
export const RUNNER_BACKGROUND_LIBRARY_CAPABILITY = "runner-library-v1-area-round-isolated-text-only" as const;

export function isRunnerRoomShotId(shotId: string): shotId is RunnerRoomShotId {
  return (RUNNER_ROOM_SHOT_IDS as readonly string[]).includes(shotId);
}

export function isRunnerOnlyBackground(background: RunnerCompatibleBackground | null | undefined) {
  return background != null && (RUNNER_ROOM_BACKGROUND_TYPES as readonly string[]).includes(background.type);
}

export function isBackgroundCompatibleForShot({
  productShape,
  shotId,
  background
}: {
  productShape: ProductShape;
  shotId: string;
  background: RunnerCompatibleBackground | null | undefined;
}) {
  if (productShape === "runner" && isRunnerRoomShotId(shotId)) {
    return isRunnerOnlyBackground(background);
  }

  // Foyer and Hallway records are a Runner-only add-on. Keep them out of the
  // established Area/Round room library even though all records share one
  // portable manifest.
  if (productShape !== "runner") {
    return !isRunnerOnlyBackground(background);
  }

  return true;
}

export function compatibleBackgroundsForShot<T extends RunnerCompatibleBackground>({
  productShape,
  shotId,
  backgrounds
}: {
  productShape: ProductShape;
  shotId: string | null | undefined;
  backgrounds: T[];
}) {
  if (!shotId) {
    return productShape === "runner"
      ? backgrounds
      : backgrounds.filter((background) => !isRunnerOnlyBackground(background));
  }
  return backgrounds.filter((background) => isBackgroundCompatibleForShot({ productShape, shotId, background }));
}
