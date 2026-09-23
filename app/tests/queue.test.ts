import { describe, expect, it } from "vitest";
import type { JobRecord, Shot, ShotAggregateState } from "../shared/types";
import { fixedIso, makeShot } from "./test-utils";

async function loadQueueModule(): Promise<{
  JobRegistry: new (onChange?: (jobs: JobRecord[]) => void) => {
    add: (job: JobRecord) => void;
    all: () => JobRecord[];
    cancel: (jobId: string) => JobRecord | null;
    pruneTerminalJobsForProducts: (productIds: Set<string>) => number;
  };
  selectGenerateMissingShots: (input: {
    shots: Shot[];
    aggregates: Record<string, ShotAggregateState>;
  }) => Promise<unknown> | unknown;
}> {
  return import("../server/queue");
}

function selectedShotIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : (item as Shot).id));
  }

  if (value && typeof value === "object") {
    const candidate = value as { shotIds?: string[]; shots?: Shot[] };

    if (Array.isArray(candidate.shotIds)) {
      return candidate.shotIds;
    }

    if (Array.isArray(candidate.shots)) {
      return candidate.shots.map((shot) => shot.id);
    }
  }

  throw new Error("selectGenerateMissingShots must return shot IDs, shots, or { shotIds/shots }");
}

describe("queue selection rules", () => {
  it("keeps active jobs regardless of age while bounding terminal history", async () => {
    const { JobRegistry } = await import("../server/queue");
    const persisted = new Map<string, JobRecord>();
    const registry = new JobRegistry(undefined, job => persisted.set(job.jobId, job));
    registry.add(makeJob({ jobId: "old-active", status: "generating", createdAt: "2020-01-01T00:00:00.000Z" }));
    for (let index = 0; index < 1000; index++) registry.add(makeJob({ jobId: `done-${index}`, status: "succeeded", createdAt: new Date(1700000000000 + index).toISOString() }));
    expect(registry.all()).toHaveLength(501);
    expect(registry.get("old-active")?.status).toBe("generating");
    expect(registry.hasRunning("SKU-001", "hero")).toBe(true);
    expect(persisted.size).toBe(1001);
    expect(registry.get("done-0")).toBeNull();
    expect(registry.get("done-999")).not.toBeNull();
  });

  it("does not accept or change a job when durable persistence fails", async () => {
    const { JobRegistry } = await import("../server/queue");
    const registry = new JobRegistry(undefined, () => { throw new Error("disk full"); });
    expect(() => registry.add(makeJob({}))).toThrow("disk full");
    expect(registry.all()).toEqual([]);
  });

  it("Generate Missing enqueues only empty shots and skips anti-loop states", async () => {
    const shots = [
      makeShot({ id: "hero" }),
      makeShot({ id: "lifestyle" }),
      makeShot({ id: "detail" }),
      makeShot({ id: "room_scene" }),
      makeShot({ id: "texture_focus" }),
      makeShot({ id: "catalog_clean" })
    ];
    const aggregates: Record<string, ShotAggregateState> = {
      hero: "empty",
      lifestyle: "review_needed",
      detail: "accepted",
      room_scene: "failed",
      texture_focus: "generating",
      catalog_clean: "rejected_only"
    };

    const { selectGenerateMissingShots } = await loadQueueModule();
    const selected = selectedShotIds(await selectGenerateMissingShots({ shots, aggregates }));

    expect(selected).toEqual(["hero"]);
  });

  it("prunes terminal orphan jobs but keeps active jobs", async () => {
    const emitted: JobRecord[][] = [];
    const { JobRegistry } = await loadQueueModule();
    const registry = new JobRegistry((jobs) => emitted.push(jobs));

    registry.add(makeJob({ jobId: "done-orphan", productId: "deleted", status: "succeeded" }));
    registry.add(makeJob({ jobId: "failed-orphan", productId: "deleted", status: "failed" }));
    registry.add(makeJob({ jobId: "active-orphan", productId: "deleted", status: "generating" }));
    registry.add(makeJob({ jobId: "kept", productId: "kept", status: "succeeded" }));

    expect(registry.pruneTerminalJobsForProducts(new Set(["kept"]))).toBe(2);
    expect(registry.all().map((job) => job.jobId).sort()).toEqual(["active-orphan", "kept"]);
    expect(emitted.at(-1)?.map((job) => job.jobId).sort()).toEqual(["active-orphan", "kept"]);
  });

  it("cancels queued and generating jobs but not terminal jobs", async () => {
    const { JobRegistry } = await loadQueueModule();
    const registry = new JobRegistry();

    registry.add(makeJob({ jobId: "queued", status: "queued" }));
    registry.add(makeJob({ jobId: "generating", status: "generating" }));
    registry.add(makeJob({ jobId: "succeeded", status: "succeeded" }));

    expect(registry.cancel("queued")).toMatchObject({
      jobId: "queued",
      status: "cancelled",
      message: "Cancelled before provider call."
    });
    expect(registry.cancel("generating")).toMatchObject({
      jobId: "generating",
      status: "cancelled",
      message: "Cancellation requested."
    });
    expect(registry.cancel("succeeded")).toMatchObject({
      jobId: "succeeded",
      status: "succeeded"
    });
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
