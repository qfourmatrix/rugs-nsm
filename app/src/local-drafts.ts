import type { ProductState } from "../shared/types";
import { ProductStateSchema } from "../shared/schemas";
const PREFIX = "rugs:unsaved-draft:v1:";
export interface LocalDraft { key: string; savedAt: string; state: ProductState }
export function writeLocalDraft(storage: Storage, owner: string, state: ProductState) {
  const key = `${PREFIX}${encodeURIComponent(state.productId)}:${owner}`;
  storage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), state }));
}
export function findLocalDraft(storage: Storage, productId: string): LocalDraft | null {
  const prefix = `${PREFIX}${encodeURIComponent(productId)}:`;
  const drafts: LocalDraft[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) ?? "null");
      const parsed = ProductStateSchema.safeParse(value?.state);
      if (parsed.success && parsed.data.productId === productId && typeof value.savedAt === "string" && Number.isFinite(Date.parse(value.savedAt))) drafts.push({ key, savedAt: value.savedAt, state: parsed.data });
    } catch { /* A corrupt browser draft must not hide the server's saved state. */ }
  }
  return drafts.sort((a,b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null;
}
export function clearSavedLocalDraft(storage: Storage, owner: string, state: ProductState) {
  const key = `${PREFIX}${encodeURIComponent(state.productId)}:${owner}`;
  const raw = storage.getItem(key);
  if (raw && JSON.stringify(JSON.parse(raw).state) === JSON.stringify(state)) storage.removeItem(key);
}
