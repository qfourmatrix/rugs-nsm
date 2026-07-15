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

export async function savePersistedJobs(productRoot: string, jobs: JobRecord[]) {
  const filePath = jobStorePath(productRoot);
  await ensureDir(path.dirname(filePath));
  await atomicWriteJson(filePath, jobs.slice(0, 500));
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
