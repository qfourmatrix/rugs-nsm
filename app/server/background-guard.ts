import type { GenerationBackgroundSnapshot, ProductShape } from "../shared/types";
import {
  isBackgroundCompatibleForShot,
  isRunnerOnlyBackground,
  isRunnerRoomShotId
} from "../shared/background-compatibility";
import { validationError } from "./errors";

interface CurrentBackgroundApproval {
  id: string;
  type: string;
}

export function assertRetryBackgroundAllowed({
  backgroundRequired,
  productShape,
  shotId,
  shotName,
  savedBackground,
  currentBackgrounds
}: {
  backgroundRequired: boolean;
  productShape: ProductShape;
  shotId: string;
  shotName: string;
  savedBackground: GenerationBackgroundSnapshot | null;
  currentBackgrounds: readonly CurrentBackgroundApproval[];
}) {
  if (!backgroundRequired) return;
  if (!savedBackground) {
    throw validationError("BACKGROUND_REQUIRED", `${shotName} retry requires saved background metadata.`);
  }
  if (productShape !== "runner" && isRunnerOnlyBackground(savedBackground)) {
    throw validationError(
      "BACKGROUND_INCOMPATIBLE",
      `${shotName} retry cannot use a Runner-only Foyer/Hallway background for an Area or Round rug.`
    );
  }
  if (productShape !== "runner" || !isRunnerRoomShotId(shotId)) return;

  const currentBackground = currentBackgrounds.find((item) => item.id === savedBackground.id);
  if (!currentBackground || !isBackgroundCompatibleForShot({
    productShape,
    shotId,
    background: currentBackground
  })) {
    throw validationError(
      "BACKGROUND_INCOMPATIBLE",
      `${shotName} retry requires a Runner Foyer/Hallway background that still exists in the connected library.`
    );
  }
}
