import { expect, it } from "vitest";
import { WeightedLru } from "../shared/weighted-lru";

it("evicts least-recently-read entries by weight and count", () => {
  const cache = new WeightedLru<string, string>(2, 10);
  cache.set("a", "a", 3); cache.set("b", "b", 3); cache.get("a");
  cache.set("c", "c", 4);
  expect(cache.get("b")).toBeUndefined(); expect(cache.weight).toBe(7);
  cache.set("d", "d", 9);
  expect(cache.size).toBe(1); expect(cache.weight).toBe(9);
});
it("replaces weights correctly and never retains oversized or unknown data", () => {
  const cache = new WeightedLru<string, object>(8, 10);
  cache.set("a", {}, 8); cache.set("a", {}, 2);
  expect(cache.weight).toBe(2);
  expect(cache.set("a", {}, 11)).toBe(false);
  expect(cache.get("a")).toBeUndefined(); expect(cache.weight).toBe(0);
  expect(cache.set("b", {}, Infinity)).toBe(false);
  cache.set("a", {}, 5); cache.clear(); expect(cache.weight).toBe(0); expect(cache.size).toBe(0);
});

it("invalidates one product without discarding unrelated navigation entries", () => {
  const cache = new WeightedLru<string, string>(8, 100);
  cache.set("alpha", "alpha-preview", 20);
  cache.set("beta", "beta-preview", 30);
  cache.delete("beta");
  expect(cache.get("alpha")).toBe("alpha-preview");
  expect(cache.get("beta")).toBeUndefined();
  expect(cache.size).toBe(1);
  expect(cache.weight).toBe(20);
  cache.delete("beta");
  expect(cache.weight).toBe(20);
});
