import { expect, it } from "vitest";
import { ActionGate } from "../src/action-gate";

it("allows unrelated actions and products while preventing overlapping submissions", () => {
  const gate = new ActionGate();
  const first = gate.begin("generate", "a", ["hero"])!;
  expect(gate.begin("generate", "a", ["hero"])).toBeNull();
  expect(gate.begin("retry-exact", "a", ["hero"])).toBeNull();
  expect(gate.begin("generate-missing", "a", ["*"])).toBeNull();
  expect(gate.begin("generate", "a", ["detail"])).not.toBeNull();
  expect(gate.begin("generate", "b", ["hero"])).not.toBeNull();
  expect(gate.begin("accept", "a")).not.toBeNull();
  expect(gate.begin("cancel-job", "a", [], "job1")).not.toBeNull();
  expect(gate.begin("cancel-job", "a", [], "job2")).not.toBeNull();
  gate.finish(first);
  const replacement = gate.begin("generate", "a", ["hero"]);
  expect(replacement).not.toBeNull();
  gate.finish(first);
  expect(gate.snapshot()).toContain(replacement);
});

it("serializes conflicting gallery and global library writes, not unrelated work", () => {
  const gate = new ActionGate();
  gate.begin("accept", "a");
  expect(gate.begin("export-readiness", "a")).toBeNull();
  expect(gate.begin("reject", "b")).not.toBeNull();
  gate.begin("background-library", "a");
  expect(gate.begin("rescan-backgrounds", "b")).toBeNull();
  expect(gate.begin("save-master-shots", "b")).not.toBeNull();
});
