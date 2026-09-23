// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { clearGenerationIntent, listGenerationIntents, prepareGenerationIntent, listDamagedGenerationIntents, clearDamagedGenerationIntent } from "../src/generation-intent";
import { isGenerationRoute } from "../shared/generation-routes";
beforeEach(() => localStorage.clear());
it.each([
  "", "{broken", "null", "42", '"text"',
  JSON.stringify({ key: "", body: "{}", createdAt: 100 }),
  JSON.stringify({ key: "key", body: "{}", createdAt: 100, path: 42 }),
  JSON.stringify({ key: "key", body: "{}", createdAt: 100, path: "another-route" })
])("preserves damaged or mismatched intent without silently starting again: %s", saved => {
  const name = "rugs:generation-intent:v1:" + encodeURIComponent("route");
  localStorage.setItem(name, saved);
  expect(() => prepareGenerationIntent(localStorage, "route", "{}", 101)).toThrow("nothing was resubmitted");
  expect(localStorage.getItem(name)).toBe(saved);
  expect(localStorage.length).toBe(1);
  const damaged = listDamagedGenerationIntents(localStorage);
  expect(damaged).toHaveLength(1);
  expect(listGenerationIntents(localStorage)).toHaveLength(0);
  expect(clearDamagedGenerationIntent(localStorage, damaged[0])).toBe(true);
  expect(localStorage.getItem(name)).toBeNull();
});
it("never clears a repaired record from an outdated damaged notice", () => {
  const name = "rugs:generation-intent:v1:" + encodeURIComponent("route");
  localStorage.setItem(name, "broken");
  const item = listDamagedGenerationIntents(localStorage)[0];
  localStorage.removeItem(name);
  const fresh = prepareGenerationIntent(localStorage, "route", "{}");
  expect(clearDamagedGenerationIntent(localStorage, item)).toBe(false);
  expect(listGenerationIntents(localStorage)[0].key).toBe(fresh.key);
});
it("does not bypass an empty legacy record with a shot-specific submission", () => {
  const path = "/api/products/rug/generate";
  localStorage.setItem("rugs:generation-intent:v1:" + encodeURIComponent(path), "");
  expect(() => prepareGenerationIntent(localStorage, path, '{"shotId":"detail"}')).toThrow("nothing was resubmitted");
  expect(localStorage.length).toBe(1);
});
it("keeps the retry key for reordered JSON fields but not changed array order", () => {
  const first = prepareGenerationIntent(localStorage, "route", '{"settings":{"size":"1K","ratio":"1:1"},"references":["a","b"]}');
  expect(prepareGenerationIntent(localStorage, "route", '{"references":["a","b"],"settings":{"ratio":"1:1","size":"1K"}}').key).toBe(first.key);
  expect(() => prepareGenerationIntent(localStorage, "route", '{"references":["b","a"],"settings":{"ratio":"1:1","size":"1K"}}')).toThrow("unconfirmed");
});
it("allows a different shot while retaining the pending shot's retry identity", () => {
  const path = "/api/products/rug/generate";
  const first = prepareGenerationIntent(localStorage, path, '{"shotId":"hero"}');
  const second = prepareGenerationIntent(localStorage, path, '{"shotId":"detail"}');
  expect(first.key).not.toBe(second.key);
  expect(listGenerationIntents(localStorage).map(item => item.path)).toEqual([path, path]);
  expect(prepareGenerationIntent(localStorage, path, '{"shotId":"hero"}').key).toBe(first.key);
  first.confirmed();
  expect(listGenerationIntents(localStorage).map(item => item.key)).toEqual([second.key]);
});
it("reuses uncertain intent across callers, and gives a deliberate next submission a fresh key", () => {
  const first = prepareGenerationIntent(localStorage, "/api/products/rug/generate", "{}", 100);
  expect(prepareGenerationIntent(localStorage, "/api/products/rug/generate", "{}", 101).key).toBe(first.key);
  first.confirmed();
  expect(prepareGenerationIntent(localStorage, "/api/products/rug/generate", "{}", 102).key).not.toBe(first.key);
});
it("blocks changed input or expired uncertain submissions instead of generating again", () => {
  prepareGenerationIntent(localStorage, "route", "original", 0);
  expect(() => prepareGenerationIntent(localStorage, "route", "changed", 1)).toThrow("unconfirmed");
  expect(() => prepareGenerationIntent(localStorage, "route", "original", 86400001)).toThrow("safe retry window");
});
it("covers every generation family but excludes review and preparation", () => {
  for (const route of ["generate", "generate-missing", "retry-failed", "refine", "generated/a/retry"]) expect(isGenerationRoute(`/api/products/rug/${route}`)).toBe(true);
  expect(isGenerationRoute("/api/shape-variants/generate")).toBe(true);
  expect(isGenerationRoute("/api/shape-variants/generate-shots")).toBe(true);
  expect(isGenerationRoute("/api/shape-variants/prepare")).toBe(false);
  expect(isGenerationRoute("/api/products/rug/generated/a/accept")).toBe(false);
});

it("lists recovery intents and never clears a newer intent with an older key", () => {
  const first = prepareGenerationIntent(localStorage, "route", "{}", 0);
  expect(listGenerationIntents(localStorage)[0].key).toBe(first.key);
  first.confirmed();
  const next = prepareGenerationIntent(localStorage, "route", "{}", 1);
  clearGenerationIntent(localStorage, "route", first.key);
  expect(listGenerationIntents(localStorage)[0].key).toBe(next.key);
});
