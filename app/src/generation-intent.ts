import { canonicalRequestBody } from "../shared/canonical-json";

const PREFIX = "rugs:generation-intent:v1:";
interface Intent { key: string; body: string; createdAt: number; path?: string }
export interface DamagedGenerationIntent { storageKey: string; raw: string; label: string }

export function listDamagedGenerationIntents(storage: Storage): DamagedGenerationIntent[] {
  const result: DamagedGenerationIntent[] = [];
  for (let index = 0; index < storage.length; index++) {
    const storageKey = storage.key(index);
    if (!storageKey?.startsWith(PREFIX)) continue;
    const raw = storage.getItem(storageKey);
    if (raw === null) continue;
    let label = "Unknown action";
    try {
      label = decodeURIComponent(storageKey.slice(PREFIX.length));
      const value = JSON.parse(raw);
      if (isIntent(value) && (value.path === undefined || value.path === label.split("#shot=")[0])) continue;
    } catch { /* Keep damaged entries visible and never replay them. */ }
    result.push({ storageKey, raw, label });
  }
  return result;
}

/** Explicit user recovery only; a newer record must never be cleared by an old notice. */
export function clearDamagedGenerationIntent(storage: Storage, item: DamagedGenerationIntent) {
  if (!item.storageKey.startsWith(PREFIX) || storage.getItem(item.storageKey) !== item.raw) return false;
  if (!listDamagedGenerationIntents(storage).some(candidate => candidate.storageKey === item.storageKey)) return false;
  storage.removeItem(item.storageKey);
  return true;
}

function isIntent(value: unknown): value is Intent {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Intent>;
  return typeof item.key === "string" && item.key.length > 0 && item.key.length <= 255
    && typeof item.body === "string" && typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
    && (item.path === undefined || typeof item.path === "string");
}

export function listGenerationIntents(storage: Storage): Array<Intent & { path: string }> {
  const result: Array<Intent & { path: string }> = [];
  for (let index = 0; index < storage.length; index++) {
    const name = storage.key(index);
    if (!name?.startsWith(PREFIX)) continue;
    try {
      const value = JSON.parse(storage.getItem(name) ?? "null");
      const storedPath = decodeURIComponent(name.slice(PREFIX.length)).split("#shot=")[0];
      if (isIntent(value) && (value.path === undefined || value.path === storedPath)) result.push({ ...value, path: value.path ?? storedPath });
    } catch { /* Do not let one corrupt entry hide other recoverable requests. */ }
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function clearGenerationIntent(storage: Storage, path: string, key: string) {
  for (let index = storage.length - 1; index >= 0; index--) {
    const name = storage.key(index);
    if (!name?.startsWith(PREFIX)) continue;
    try {
      const current = JSON.parse(storage.getItem(name) ?? "null");
      if (current?.key === key && (current.path ?? decodeURIComponent(name.slice(PREFIX.length))) === path) storage.removeItem(name);
    } catch { /* Do not clear an unrelated or malformed recovery record. */ }
  }
}

/** Ambiguous requests retain their identity across reloads; confirmed ones release it. */
export function prepareGenerationIntent(storage: Storage, path: string, body: string, now = Date.now()) {
  let resource = "";
  if (/\/products\/[^/]+\/generate$/.test(path)) {
    try { const parsed = JSON.parse(body); if (typeof parsed.shotId === "string") resource = `#shot=${parsed.shotId}`; } catch { /* API validates malformed JSON. */ }
  }
  // Keep old path-scoped uncertain requests recoverable; never bypass them.
  const legacyKey = PREFIX + encodeURIComponent(path);
  const storageKey = resource && storage.getItem(legacyKey) === null ? PREFIX + encodeURIComponent(path + resource) : legacyKey;
  const saved = storage.getItem(storageKey);
  let intent: Intent;
  if (saved !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(saved); } catch { /* Preserve uncertain records, including malformed JSON. */ }
    if (!isIntent(parsed) || (parsed.path !== undefined && parsed.path !== path)) throw new Error("Stored generation request is invalid. Review job history before clearing it; nothing was resubmitted.");
    intent = parsed;
    if (now - intent.createdAt > 24 * 60 * 60 * 1000) throw new Error("An unconfirmed generation is older than the safe retry window. Review job history before starting a new request.");
    if (canonicalRequestBody(intent.body) !== canonicalRequestBody(body)) throw new Error("Another generation on this action is unconfirmed. Recover the original submission before changing its input.");
  } else {
    intent = { key: crypto.randomUUID(), body, createdAt: now, path };
    storage.setItem(storageKey, JSON.stringify(intent));
  }
  return {
    key: intent.key,
    confirmed: () => {
      clearGenerationIntent(storage, path, intent.key);
    }
  };
}
