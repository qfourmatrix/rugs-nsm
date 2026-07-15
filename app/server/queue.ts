import type { JobRecord, Shot, ShotAggregateState } from "../shared/types";

type JobChangeListener = (jobs: JobRecord[]) => void;

export function selectGenerateMissingShots({
  shots,
  aggregates
}: {
  shots: Shot[];
  aggregates: Record<string, ShotAggregateState>;
}): Shot[] {
  return shots.filter((shot) => (aggregates[shot.id] ?? "empty") === "empty");
}

export class JobRegistry {
  private jobs = new Map<string, JobRecord>();

  constructor(private readonly onChange?: JobChangeListener) {}

  all(): JobRecord[] {
    return [...this.jobs.values()].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  add(job: JobRecord) {
    this.jobs.set(job.jobId, job);
    this.emit();
  }

  restore(jobs: JobRecord[]) {
    this.jobs.clear();
    for (const job of jobs) {
      this.jobs.set(job.jobId, job);
    }
  }

  get(jobId: string) {
    return this.jobs.get(jobId) ?? null;
  }

  update(jobId: string, patch: Partial<JobRecord>) {
    const existing = this.jobs.get(jobId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(jobId, updated);
    this.emit();
    return updated;
  }

  hasRunning(productId: string, shotId: string) {
    return [...this.jobs.values()].some(
      (job) =>
        job.productId === productId &&
        job.shotId === shotId &&
        (job.status === "queued" || job.status === "generating")
    );
  }

  cancel(jobId: string) {
    const existing = this.jobs.get(jobId);
    if (!existing || (existing.status !== "queued" && existing.status !== "generating")) {
      return existing ?? null;
    }

    return this.update(jobId, {
      status: "cancelled",
      message:
        existing.status === "queued"
          ? "Cancelled before provider call."
          : "Cancellation requested."
    });
  }

  cancelAllPending() {
    for (const job of this.jobs.values()) {
      if (job.status === "queued") {
        this.cancel(job.jobId);
      }
    }
  }

  pruneTerminalJobsForProducts(productIds: Set<string>) {
    let deleted = 0;
    for (const job of this.jobs.values()) {
      const active = job.status === "queued" || job.status === "generating";
      if (!active && !productIds.has(job.productId)) {
        this.jobs.delete(job.jobId);
        deleted += 1;
      }
    }

    if (deleted > 0) {
      this.emit();
    }

    return deleted;
  }

  private emit() {
    this.onChange?.(this.all());
  }
}
