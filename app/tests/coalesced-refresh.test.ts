import { expect, it, vi } from "vitest";
import { createCoalescedRefresh } from "../src/coalesced-refresh";

it("discards a delayed pre-review snapshot and shares a trailing read without overlap", async () => {
  const resolvers: ((value: string) => void)[] = [];
  const read = vi.fn(() => new Promise<string>(resolve => resolvers.push(resolve)));
  const apply = vi.fn(() => true);
  const refresh = createCoalescedRefresh(read, apply);
  const old = refresh();
  await Promise.resolve();
  // Accept finished while the earlier GET was still pending.
  const afterAccept = refresh();
  const alsoRequested = refresh();
  expect(read).toHaveBeenCalledTimes(1);
  expect(afterAccept).toBe(old);
  resolvers[0]("done");
  await Promise.resolve();
  expect(apply).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(2);
  resolvers[1]("accepted");
  expect(await Promise.all([old, afterAccept, alsoRequested])).toEqual([true, true, true]);
  expect(apply.mock.calls).toEqual([["accepted"]]);
});

it("releases the gate on failure without an automatic retry storm", async () => {
  const read = vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce("fresh");
  const apply = vi.fn(() => true);
  const refresh = createCoalescedRefresh(read, apply);
  await expect(refresh()).rejects.toThrow("offline");
  expect(read).toHaveBeenCalledTimes(1);
  expect(await refresh()).toBe(true);
  expect(apply).toHaveBeenCalledWith("fresh");
});

it("does not apply catalog readiness captured before a completed mutation", async () => {
  type Catalog = { exportReady: boolean; galleryRevision: number }[];
  const resolvers: ((value: Catalog) => void)[] = [];
  const read = vi.fn(() => new Promise<Catalog>(resolve => resolvers.push(resolve)));
  const applied: Catalog[] = [];
  const refresh = createCoalescedRefresh(read, snapshot => { applied.push(snapshot); return true; });
  const polling = refresh();
  await Promise.resolve();
  const mutation = refresh();
  resolvers[0]([{ exportReady: false, galleryRevision: 1 }]);
  await Promise.resolve();
  expect(applied).toEqual([]);
  expect(read).toHaveBeenCalledTimes(2);
  resolvers[1]([{ exportReady: true, galleryRevision: 2 }]);
  await Promise.all([polling, mutation]);
  expect(applied).toEqual([[{ exportReady: true, galleryRevision: 2 }]]);
});
