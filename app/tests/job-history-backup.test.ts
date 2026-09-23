import path from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { JobLedger } from "../server/job-ledger";
import { exportJobHistory } from "../server/job-history-backup";
import { makeTempWorkspace, cleanupTempWorkspace, fixedIso } from "./test-utils";

it("exports all durable history in stable order, preserves the source and refuses overwrite", async () => {
  const root = await makeTempWorkspace();
  const ledger = await JobLedger.open(root);
  try {
    ledger.transaction(() => {
      for (let i = 0; i < 1200; i++) ledger.put({ jobId: `job-${i}`, runId: "run", productId: "rug", shotId: "hero", status: "succeeded", createdAt: fixedIso, updatedAt: fixedIso, message: "Done" });
    });
    const output = path.join(root, "rollback.json");
    const result = await exportJobHistory(root, output);
    const bytes = await readFile(output);
    const records = JSON.parse(bytes.toString());
    expect(result.count).toBe(1200);
    expect(records).toHaveLength(1200);
    expect(records[0].jobId).toBe("job-1199");
    expect(records[1199].jobId).toBe("job-0");
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(ledger.get("job-0")).toEqual(records[1199]);
    await writeFile(output, "existing snapshot");
    await expect(exportJobHistory(root, output)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(output, "utf8")).toBe("existing snapshot");
    expect((await readdir(root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  } finally { ledger.close(); await cleanupTempWorkspace(root); }
});

it("refuses a rollback snapshot while jobs are active", async () => {
  const root = await makeTempWorkspace();
  const ledger = await JobLedger.open(root);
  try {
    ledger.put({ jobId: "active", runId: "run", productId: "rug", shotId: "hero", status: "queued", createdAt: fixedIso, updatedAt: fixedIso, message: "Queued" });
    await expect(exportJobHistory(root, path.join(root, "rollback.json"))).rejects.toThrow("Active jobs exist");
    expect(await readdir(root)).toEqual([".product-shot-queue"]);
  } finally { ledger.close(); await cleanupTempWorkspace(root); }
});

it("refuses unresolved external outcomes even when local jobs are terminal", async () => {
  const root = await makeTempWorkspace();
  const ledger = await JobLedger.open(root);
  try {
    const job = { jobId: "uncertain", runId: "run", productId: "rug", shotId: "hero", status: "failed" as const, createdAt: fixedIso, updatedAt: fixedIso, message: "Provider outcome unknown" };
    ledger.claimRequest("route", "key", "hash");
    ledger.commitRequest("route", "key", "hash", [{ job, payload: {} }], 200, "{}");
    ledger.markDispatch(job.jobId, "started");
    await expect(exportJobHistory(root, path.join(root, "rollback.json"))).rejects.toThrow("Unresolved provider outcomes");
    expect(await readdir(root)).toEqual([".product-shot-queue"]);
  } finally { ledger.close(); await cleanupTempWorkspace(root); }
});
