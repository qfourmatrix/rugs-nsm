import type { Shot, ShotPromptOverride } from "./types";

export interface ResolvedBackgroundTypeOverride {
  backgroundType: string;
  override: ShotPromptOverride;
}

export function normalizeBackgroundType(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveShotBackgroundTypeOverride({
  shot,
  prompt,
  backgroundType
}: {
  shot: Shot | null;
  prompt: string;
  backgroundType: string | null | undefined;
}): ResolvedBackgroundTypeOverride | null {
  if (!shot || !backgroundType || prompt.trim() !== shot.prompt.trim()) {
    return null;
  }

  const normalizedType = normalizeBackgroundType(backgroundType);
  const override = shot.backgroundTypeOverrides?.[normalizedType];
  return override ? { backgroundType: normalizedType, override } : null;
}
