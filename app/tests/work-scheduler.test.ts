import { expect, it } from "vitest";
import { WorkScheduler } from "../server/work-scheduler";

it("bounds admission, keeps FIFO order, and releases slots after failure", async () => {
  const queue = new WorkScheduler(1, 2);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const order: number[] = [];
  const first = queue.run(async () => { order.push(1); await gate; });
  const second = queue.run(async () => { order.push(2); throw new Error("intentional"); });
  const failed = expect(second).rejects.toThrow("intentional");
  const third = queue.run(async () => { order.push(3); return 3; });
  await expect(queue.run(async () => 4)).rejects.toMatchObject({ code: "WORK_QUEUE_FULL" });
  expect(queue.active).toBe(1);
  expect(queue.queued).toBe(2);
  release();
  await first;
  await failed;
  expect(await third).toBe(3);
  expect(await queue.run(async () => 5)).toBe(5);
  expect(order).toEqual([1, 2, 3]);
});

it("never runs more than its limit across concurrent submitters", async () => {
  const queue = new WorkScheduler(2, 100);
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 50 }, () => queue.run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
  })));
  expect(peak).toBe(2);
});

it("immediately frees a cancelled waiting slot without executing its task", async () => {
  const queue = new WorkScheduler(1, 1);
  let release!: () => void;
  const first = queue.run(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  const abort = new AbortController();
  let executed = false;
  const waiting = queue.run(async () => { executed = true; }, abort.signal);
  const rejected = expect(waiting).rejects.toThrow();
  abort.abort(new Error("cancelled"));
  await rejected;
  expect(queue.queued).toBe(0);
  const replacement = queue.run(async () => "replacement");
  release(); await first;
  expect(await replacement).toBe("replacement");
  expect(executed).toBe(false);
});
