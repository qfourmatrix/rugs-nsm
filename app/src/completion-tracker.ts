import type { JobRecord } from "../shared/types";

/** Session-local, bounded replay protection. Old history never becomes a new toast. */
export class CompletionTracker {
  private seen = new Map<string, number>();
  private floor: number;
  constructor(startedAt = Date.now()) { this.floor = startedAt; }
  observe(jobs: JobRecord[], currentProductId: string | null): JobRecord[] {
    const fresh: JobRecord[] = [];
    for (const job of jobs) {
      const time = Date.parse(job.updatedAt);
      if (job.status !== "succeeded" || !job.assetId || !Number.isFinite(time) || time < this.floor || this.seen.has(job.jobId)) continue;
      this.seen.set(job.jobId, time);
      if (job.productId !== currentProductId && !["refine_base", "shape_runner_base", "shape_round_base"].includes(job.shotId)) fresh.push(job);
    }
    if (this.seen.size > 2048) {
      const newest = [...this.seen].sort((a, b) => b[1] - a[1]).slice(0, 1024);
      this.floor = Math.max(this.floor, newest.at(-1)![1] + 1);
      this.seen = new Map(newest);
    }
    return fresh.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  }
}
