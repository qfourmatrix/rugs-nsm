import { expect, it } from "vitest";
import { canonicalJson } from "../shared/canonical-json";

it("normalizes nested object ordering without normalizing arrays or prompt text", () => {
  expect(canonicalJson({ z: { b: 2, a: 1 }, a: [2, 1] })).toBe(canonicalJson({ a: [2, 1], z: { a: 1, b: 2 } }));
  expect(canonicalJson({ text: " a ", values: [1, 2] })).not.toBe(canonicalJson({ text: "a", values: [1, 2] }));
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  expect(canonicalJson(JSON.parse('{"__proto__":{"a":1},"x":2}'))).toContain('"__proto__"');
});
