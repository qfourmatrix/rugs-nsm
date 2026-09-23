import { describe, expect, it } from "vitest";
import type { JobRecord } from "../shared/types";
import { CompletionTracker } from "../src/completion-tracker";
const job = (id: string, productId = "rug--runner", time = 2000): JobRecord => ({ jobId: id, runId: id, productId, shotId: "wide_room_hero", status: "succeeded", createdAt: new Date(time - 1).toISOString(), updatedAt: new Date(time).toISOString(), message: "Done", assetId: id });
describe("completion notifications", () => {
  it("ignores historical shots and current shape; notifies another shape only once", () => {
    const tracker = new CompletionTracker(1000);
    expect(tracker.observe([job("old", "rug", 500), job("same", "rug"), job("runner")], "rug").map(j => j.jobId)).toEqual(["runner"]);
    expect(tracker.observe([job("same", "rug"), job("runner")], "other")).toEqual([]);
    expect(tracker.observe([job("new", "rug--round")], "rug--runner")).toHaveLength(1);
  });
  it("ignores failed and construction outputs", () => {
    expect(new CompletionTracker(0).observe([{ ...job("x"), status: "failed" }, { ...job("y"), shotId: "refine_base" }], "other")).toEqual([]);
  });
  it("bounds replay memory without replaying evicted history", () => {
    const tracker = new CompletionTracker(0);
    const batch = Array.from({ length: 2200 }, (_, i) => job(String(i), "rug", i + 1));
    tracker.observe(batch, "other");
    expect(tracker.observe(batch, "other")).toEqual([]);
  });
});
