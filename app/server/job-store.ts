import path from "node:path";
import type { JobRecord } from "../shared/types";
import { atomicWriteJson, ensureDir, pathExists, readJsonFile } from "./fsUtils";

const appStateDirname = ".product-shot-queue";
const jobFile = "jobs.json";

export function jobStorePath(productRoot: string) {
  return path.join(productRoot, appStateDirname, jobFile);
}

export async function loadPersistedJobs(productRoot: string): Promise<JobRecord[]> {
  const filePath = jobStorePath(productRoot);
  if (!(await pathExists(filePath))) {
    return [];
  }

  const raw = await readJsonFile(filePath);
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(isJobRecordLike)
    .map((job) =>
      job.status === "queued" || job.status === "generating"
        ? {
            ...job,
            status: "cancelled" as const,
            message: "Interrupted by server restart."
          }
        : job
    );
}

type Waiter = { resolve: () => void; reject: (error: unknown) => void };
const writers = new Map<string, { latest: JobRecord[] | null; waiters: Waiter[] }>();
export function savePersistedJobs(productRoot: string, jobs: JobRecord[]): Promise<void> {
  const filePath = jobStorePath(productRoot);
  let writer = writers.get(filePath);
  const start = !writer;
  if (!writer) { writer = { latest: null, waiters: [] }; writers.set(filePath, writer); }
  writer.latest = structuredClone(jobs.slice(0, 500));
  const result = new Promise<void>((resolve, reject) => writer!.waiters.push({ resolve, reject }));
  if (start) {
    const current = writer;
    void (async () => {
      // Coalesce status bursts before touching disk; later writes never overtake earlier ones.
      await Promise.resolve();
      while (current.latest) {
        const snapshot = current.latest;
        const waiters = current.waiters.splice(0);
        current.latest = null;
        try {
          await ensureDir(path.dirname(filePath));
          await atomicWriteJson(filePath, snapshot);
          waiters.forEach(waiter => waiter.resolve());
        } catch (error) { waiters.forEach(waiter => waiter.reject(error)); }
      }
      writers.delete(filePath);
    })();
  }
  return result;
}

function isJobRecordLike(value: unknown): value is JobRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<JobRecord>;
  return (
    typeof candidate.jobId === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.productId === "string" &&
    typeof candidate.shotId === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.message === "string"
  );
}
