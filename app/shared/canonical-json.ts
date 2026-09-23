/** Stable JSON object order; arrays and string contents retain their meaning. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item !== null && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : item);
}

export function canonicalRequestBody(body: string): string {
  try { return canonicalJson(JSON.parse(body)); }
  catch { return body; }
}
