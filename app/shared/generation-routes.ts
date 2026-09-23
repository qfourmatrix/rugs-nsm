/** Keep client intent handling and server enforcement on the same route inventory. */
export function isGenerationRoute(path: string): boolean {
  return /^\/api\/products\/[^/]+\/(generate|generate-missing|retry-failed|refine)$/.test(path)
    || /^\/api\/products\/[^/]+\/generated\/[^/]+\/retry$/.test(path)
    || /^\/api\/shape-variants\/(generate|generate-shots)$/.test(path);
}
