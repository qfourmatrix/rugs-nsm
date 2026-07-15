import path from "node:path";
import type { ProductState, Shot } from "../shared/types";
import { withoutRefineReferences } from "./refine-artifacts";
import { loadProductState as loadStateStore, saveProductState as saveStateStore } from "./stateStore";

function productTarget(productRoot: string, productId: string) {
  return {
    id: productId,
    dirPath: path.join(productRoot, productId)
  };
}

export async function loadProductState({
  productRoot,
  productId
}: {
  productRoot: string;
  productId: string;
}): Promise<ProductState> {
  const target = productTarget(productRoot, productId);
  const state = await loadStateStore(target);
  const referenceImages = withoutRefineReferences(state.referenceImages);

  if (referenceImages.length === state.referenceImages.length) {
    return state;
  }

  return saveStateStore(target, { ...state, referenceImages });
}

export async function saveProductState({
  productRoot,
  productId,
  state
}: {
  productRoot: string;
  productId: string;
  state: ProductState;
}): Promise<ProductState> {
  return saveStateStore(productTarget(productRoot, productId), {
    ...state,
    referenceImages: withoutRefineReferences(state.referenceImages)
  });
}

export async function applyShotToProductState({
  state,
  shot,
  now = new Date().toISOString()
}: {
  state: ProductState;
  shot: Shot;
  now?: Date | string;
}): Promise<ProductState> {
  const updatedAt = typeof now === "string" ? now : now.toISOString();
  return {
    ...state,
    selectedShotId: shot.id,
    promptBox: {
      value: shot.prompt,
      sourceShotId: shot.id,
      dirty: false,
      updatedAt
    },
    settings: {
      ...state.settings,
      aspectRatio: shot.defaultAspectRatio,
      imageSize: shot.defaultImageSize
    }
  };
}
