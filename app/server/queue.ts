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
  private snapshot: JobRecord[] | null = null;
  private revisionValue = 0;

  constructor(private readonly onChange?: JobChangeListener, private readonly persist?: (job: JobRecord) => void) {}

  get revision() { return this.revisionValue; }

  all(): JobRecord[] {
    this.snapshot ??= [...this.jobs.values()].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
    return this.snapshot.slice();
  }

  add(job: JobRecord) {
    this.persist?.(job);
    this.addCommitted(job);
  }

  /** For batches already committed atomically by the admission ledger. */
  addCommitted(job: JobRecord) {
    this.jobs.set(job.jobId, job);
    this.changed();
    this.emit();
  }

  restore(jobs: JobRecord[]) {
    this.jobs.clear();
    for (const job of jobs) {
      this.jobs.set(job.jobId, job);
    }
    this.changed();
  }

  get(jobId: string) {
    return this.jobs.get(jobId) ?? null;
  }

  update(jobId: string, patch: Partial<JobRecord>) {
    const existing = this.jobs.get(jobId);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.persist?.(updated);
    this.jobs.set(jobId, updated);
    this.changed();
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
      this.changed();
      this.emit();
    }

    return deleted;
  }

  private emit() {
    this.onChange?.(this.all());
  }

  private changed() {
    this.snapshot = null;
    this.revisionValue++;
    // Disk persistence precedes eviction. Never hide queued/generating work.
    const terminal = this.all().filter(job => job.status !== "queued" && job.status !== "generating");
    for (const job of terminal.slice(500)) this.jobs.delete(job.jobId);
    if (terminal.length > 500) this.snapshot = null;
  }
}
