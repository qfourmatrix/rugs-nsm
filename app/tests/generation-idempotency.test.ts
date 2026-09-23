import { afterEach, beforeEach, expect, it } from "vitest";
import { JobLedger } from "../server/job-ledger";
import type { JobRecord } from "../shared/types";
import { cleanupTempWorkspace, fixedIso, makeTempWorkspace } from "./test-utils";

let root: string, ledger: JobLedger;
const record: JobRecord = { jobId: "j1", runId: "run", productId: "rug", shotId: "hero", status: "queued", createdAt: fixedIso, updatedAt: fixedIso, message: "Queued" };
beforeEach(async () => { root = await makeTempWorkspace(); ledger = await JobLedger.open(root); });
afterEach(async () => { ledger.close(); await cleanupTempWorkspace(root); });

it("admits one concurrent intent and replays exact response after restart", async () => {
  const results = await Promise.allSettled([0, 1].map(() => Promise.resolve().then(() => ledger.claimRequest("generate/rug", "key", "hash"))));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "GENERATION_REQUEST_PENDING" } });
  const response = '{"runId":"run", "jobIds":["j1"]}';
  ledger.commitRequest("generate/rug", "key", "hash", [{ job: record, payload: { prompt: "frozen resolved input" } }], 200, response);
  ledger.close(); ledger = await JobLedger.open(root);
  expect(ledger.requestStatus("generate/rug", "key")).toMatchObject({ state: "complete", responseStatus: 200, response: { jobIds: ["j1"] } });
  expect(ledger.claimRequest("generate/rug", "key", "hash")).toEqual({ status: 200, body: response });
  expect(ledger.active()).toEqual([record]);
});

it("rejects mismatched payloads and missing keys while allowing a separate deliberate intent", () => {
  expect(ledger.requestStatus("route", "absent").state).toBe("missing");
  expect(() => ledger.claimRequest("route", "", "hash")).toThrow();
  ledger.claimRequest("route", "key", "hash");
  expect(ledger.requestStatus("route", "key").state).toBe("in_progress");
  expect(() => ledger.claimRequest("route", "key", "changed")).toThrow(expect.objectContaining({ code: "IDEMPOTENCY_BODY_MISMATCH" }));
  expect(ledger.claimRequest("route", "new-key", "hash")).toBeNull();
  expect(ledger.claimRequest("other-route", "key", "hash")).toBeNull();
});

it("rolls back both job admission and response when any batch member fails validation", () => {
  ledger.claimRequest("route", "key", "hash");
  expect(() => ledger.commitRequest("route", "key", "hash", [{ job: record, payload: {} }, { job: { ...record, jobId: "j2", status: "invalid" as never }, payload: {} }], 200, "{}")).toThrow();
  expect(ledger.get("j1")).toBeNull();
  expect(() => ledger.claimRequest("route", "key", "hash")).toThrow(expect.objectContaining({ code: "GENERATION_REQUEST_PENDING" }));
});

it("does not expire unresolved provider dispatches or interrupted admission", () => {
  ledger.claimRequest("route", "unfinished", "hash", 0);
  ledger.claimRequest("route", "key", "hash", 0);
  ledger.commitRequest("route", "key", "hash", [{ job: record, payload: {} }], 200, "{}");
  ledger.markDispatch("j1", "started");
  const later = 8 * 24 * 60 * 60 * 1000;
  expect(ledger.sweepRequests(later)).toBe(0);
  ledger.markDispatch("j1", "finished");
  expect(ledger.sweepRequests(later)).toBe(1);
  expect(ledger.get("j1")).toEqual(record); // History isn't a dedup cache and remains available.
  expect(() => ledger.claimRequest("route", "unfinished", "hash")).toThrow();
});

it("reclaims safely cancelled queued dispatches but preserves ambiguous started calls", () => {
  for (const key of ["queued", "started"]) {
    ledger.claimRequest("route", key, "hash", 0);
    ledger.commitRequest("route", key, "hash", [{ job: { ...record, jobId: key }, payload: {} }], 200, "{}");
  }
  ledger.markDispatch("started", "started");
  ledger.finishUndispatched("queued");
  ledger.finishUndispatched("started");
  expect(ledger.sweepRequests(8 * 24 * 60 * 60 * 1000)).toBe(1);
  expect(ledger.requestStatus("route", "queued").state).toBe("missing");
  expect(ledger.requestStatus("route", "started").state).toBe("complete");
});
