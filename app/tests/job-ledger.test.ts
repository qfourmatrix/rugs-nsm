import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JobLedger } from "../server/job-ledger";
import type { JobRecord } from "../shared/types";
import { cleanupTempWorkspace, makeTempWorkspace, fixedIso } from "./test-utils";

const job = (index: number, status: JobRecord["status"] = "succeeded"): JobRecord => ({
  jobId: `j${index}`, runId: "run", productId: index % 2 ? "A" : "B", shotId: "hero", shotName: "Hero",
  batchIndex: 1, batchTotal: 1, status, createdAt: fixedIso, updatedAt: fixedIso, message: "Generated"
});

describe("durable job history", () => {
  it("bounds pages without discarding older or active jobs; cursor survives inserts and updates", async () => {
    const root = await makeTempWorkspace();
    const ledger = await JobLedger.open(root);
    try {
      ledger.transaction(() => { for (let i = 0; i < 5000; i++) ledger.put(job(i)); });
      ledger.put(job(-1, "generating"));
      const first = ledger.history({ limit: 100 });
      expect(first.jobs).toHaveLength(100);
      expect(first.jobs[0].jobId).toBe("j4999");
      ledger.put({ ...job(4999), message: "updated" });
      ledger.put(job(5000));
      const second = ledger.history({ limit: 100, before: first.nextCursor! });
      expect(second.jobs[0].jobId).toBe("j4899");
      expect(ledger.get("j0")).toEqual(job(0));
      expect(ledger.active()).toEqual([job(-1, "generating")]);
      expect(ledger.history({ productId: "A" }).jobs.every(record => record.productId === "A")).toBe(true);
      expect(() => ledger.history({ limit: 501 })).toThrow();
    } finally { ledger.close(); await cleanupTempWorkspace(root); }
  });

  it("imports once, preserves the legacy backup, and reopens without losing subsequent jobs", async () => {
    const root = await makeTempWorkspace();
    const dir = path.join(root, ".product-shot-queue");
    await mkdir(dir);
    const legacy = { ...job(2), shotName: undefined, batchIndex: undefined, batchTotal: undefined };
    const original = JSON.stringify([legacy, job(1, "queued")]);
    await writeFile(path.join(dir, "jobs.json"), original);
    let ledger = await JobLedger.open(root);
    try {
      expect(ledger.active()).toEqual([job(1, "queued")]);
      ledger.put(job(3));
      ledger.close();
      ledger = await JobLedger.open(root);
      expect(ledger.history().jobs.map(row => row.jobId)).toEqual(["j3", "j2"]);
      expect(await readFile(path.join(dir, "jobs.pre-ledger-v1.json"), "utf8")).toBe(original);
      expect(await readFile(path.join(dir, "jobs.json"), "utf8")).toBe(original);
    } finally { ledger.close(); await cleanupTempWorkspace(root); }
  });

  it("rolls back an incomplete batch and fails closed on corrupt migration input", async () => {
    const root = await makeTempWorkspace();
    const ledger = await JobLedger.open(root);
    try {
      expect(() => ledger.transaction(() => { ledger.put(job(1)); throw new Error("disk failure simulation"); })).toThrow();
      expect(ledger.get("j1")).toBeNull();
    } finally { ledger.close(); await cleanupTempWorkspace(root); }
    const corrupt = await makeTempWorkspace();
    try {
      await mkdir(path.join(corrupt, ".product-shot-queue"));
      await writeFile(path.join(corrupt, ".product-shot-queue/jobs.json"), "{broken");
      await expect(JobLedger.open(corrupt)).rejects.toThrow();
    } finally { await cleanupTempWorkspace(corrupt); }
  });
});
