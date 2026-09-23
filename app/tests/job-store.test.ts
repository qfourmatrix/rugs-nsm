import path from "node:path";
import { writeFile, unlink } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadPersistedJobs, savePersistedJobs } from "../server/job-store";
import type { JobRecord } from "../shared/types";
import { cleanupTempWorkspace, fixedIso, makeTempWorkspace } from "./test-utils";

describe("persistent job store", () => {
  it("keeps the newest burst snapshot and isolates caller mutations", async () => {
    const workspace = await makeTempWorkspace();
    try {
      const writes = Array.from({ length: 100 }, (_, index) => savePersistedJobs(workspace, [makeJob({ status: "succeeded", message: String(index) })]));
      const final = [makeJob({ status: "succeeded", message: "final" })];
      writes.push(savePersistedJobs(workspace, final));
      final[0].message = "mutated after enqueue";
      await Promise.all(writes);
      expect((await loadPersistedJobs(workspace))[0].message).toBe("final");
    } finally { await cleanupTempWorkspace(workspace); }
  });

  it("recovers its writer after a filesystem failure", async () => {
    const workspace = await makeTempWorkspace();
    const blocker = path.join(workspace, ".product-shot-queue");
    try {
      await writeFile(blocker, "not a directory");
      await expect(savePersistedJobs(workspace, [makeJob({})])).rejects.toThrow();
      await unlink(blocker);
      await savePersistedJobs(workspace, [makeJob({ status: "succeeded" })]);
      expect((await loadPersistedJobs(workspace))[0].status).toBe("succeeded");
    } finally { await cleanupTempWorkspace(workspace); }
  });
  it("normalizes queued and generating jobs after restart", async () => {
    const workspace = await makeTempWorkspace();
    const productRoot = path.join(workspace, "nsm100k");

    try {
      const jobs: JobRecord[] = [
        makeJob({ jobId: "queued", status: "queued" }),
        makeJob({ jobId: "generating", status: "generating" }),
        makeJob({ jobId: "succeeded", status: "succeeded", message: "Generated" })
      ];

      await savePersistedJobs(productRoot, jobs);
      const reloaded = await loadPersistedJobs(productRoot);

      expect(reloaded).toEqual([
        expect.objectContaining({
          jobId: "queued",
          status: "cancelled",
          message: "Interrupted by server restart."
        }),
        expect.objectContaining({
          jobId: "generating",
          status: "cancelled",
          message: "Interrupted by server restart."
        }),
        expect.objectContaining({
          jobId: "succeeded",
          status: "succeeded",
          message: "Generated"
        })
      ]);
    } finally {
      await cleanupTempWorkspace(workspace);
    }
  });
});

function makeJob(overrides: Partial<JobRecord>): JobRecord {
  return {
    jobId: "job",
    runId: "run",
    productId: "SKU-001",
    shotId: "hero",
    shotName: "Hero",
    batchIndex: 1,
    batchTotal: 1,
    status: "queued",
    createdAt: fixedIso,
    updatedAt: fixedIso,
    message: "Queued",
    ...overrides
  };
}
