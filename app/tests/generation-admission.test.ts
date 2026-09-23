import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GenerationAdmission } from "../server/generation-admission";
import { JobLedger } from "../server/job-ledger";
import { asyncRoute, errorMiddleware } from "../server/errors";
import type { JobRecord } from "../shared/types";
import { makeTempWorkspace, cleanupTempWorkspace, fixedIso } from "./test-utils";

let root: string, ledger: JobLedger, server: Server, origin: string;
let calls: string[];
let recoveryCalls: number;
let failRecovery: boolean;
beforeEach(async () => {
  root = await makeTempWorkspace(); ledger = await JobLedger.open(root); calls = []; recoveryCalls = 0; failRecovery = false;
  const app = express(); app.use(express.json());
  const admission = new GenerationAdmission<{ job: JobRecord }>(ledger, () => {}, batch => { calls.push(...batch.map(item => item.job.jobId)); });
  app.use(admission.middleware);
  app.post(/.*/, asyncRoute(async (_req, res) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    const jobId = randomUUID();
    admission.onRejected(async () => { recoveryCalls++; if (failRecovery) throw Error("Simulated preparation recovery failure"); });
    admission.stage({ job: { jobId, productId: "rug", runId: jobId, shotId: "hero", status: "queued", createdAt: fixedIso, updatedAt: fixedIso, message: "Queued" } });
    res.json({ jobIds: [jobId] });
  }));
  app.use(errorMiddleware);
  server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("No address");
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { vi.restoreAllMocks(); await new Promise<void>(resolve => server.close(() => resolve())); ledger.close(); await cleanupTempWorkspace(root); });
const post = (route: string, key?: string, body = "{}") => fetch(origin + route, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body });
const protectedRoutes = ["/api/products/rug/generate", "/api/products/rug/generate-missing", "/api/products/rug/retry-failed", "/api/products/rug/refine", "/api/products/rug/generated/asset/retry", "/api/shape-variants/generate", "/api/shape-variants/generate-shots"];

it.each(protectedRoutes)("guards %s with one dispatch for simultaneous retries", async route => {
  expect((await post(route)).status).toBe(400);
  const responses = await Promise.all([post(route, "same"), post(route, "same"), post(route, "same")]);
  // A late arrival may already receive the committed replay instead of a 409.
  expect(responses.every(response => [200, 409].includes(response.status))).toBe(true);
  const accepted = await responses.find(response => response.status === 200)!.text();
  for (const response of responses.filter(response => response.status === 200)) {
    if (!response.bodyUsed) expect(await response.text()).toBe(accepted);
  }
  expect(await (await post(route, "same")).text()).toBe(accepted);
  expect(calls).toHaveLength(1);
  expect(recoveryCalls).toBe(0);
  expect(ledger.active().map(job => job.jobId)).toEqual(calls);
});

it.each(protectedRoutes)("admits three intentional keys on %s without deduplicating legitimate work", async route => {
  const keys = ["intent-one", "intent-two", "intent-three"];
  const responses = await Promise.all(keys.map(key => post(route, key)));
  expect(responses.map(response => response.status)).toEqual([200, 200, 200]);
  const bodies = await Promise.all(responses.map(response => response.text()));
  expect(calls).toHaveLength(3);
  expect(new Set(calls).size).toBe(3);
  const replays = await Promise.all(keys.map(key => post(route, key).then(response => response.text())));
  expect(replays).toEqual(bodies);
  expect(calls).toHaveLength(3);
  expect(new Set(ledger.active().map(job => job.jobId))).toEqual(new Set(calls));
  expect(recoveryCalls).toBe(0);
});

it.each(protectedRoutes)("does not dispatch when durable admission fails on %s and replays the definitive error", async route => {
  vi.spyOn(ledger, "commitRequest").mockImplementationOnce(() => { throw Error("Simulated storage failure"); });
  const first = await post(route, "disk-failure");
  expect(first.status).toBe(500);
  expect(calls).toEqual([]); expect(ledger.active()).toEqual([]);
  expect(recoveryCalls).toBe(1);
  expect(await (await post(route, "disk-failure")).text()).toBe(await first.text());
});

it.each(protectedRoutes)("replays an unconsumed response on %s and equivalent reordered JSON without another dispatch", async route => {
  const response = await post(route, "lost", '{"prompt":"mock","settings":{"a":1,"b":2}}');
  await response.body?.cancel(); // Client never consumes the accepted response.
  const replay = await post(route, "lost", '{"settings":{"b":2,"a":1},"prompt":"mock"}');
  expect(replay.status).toBe(200);
  expect((await replay.json()).jobIds).toEqual(calls);
  expect(calls).toHaveLength(1);
  expect((await post(route, "lost", '{"prompt":"changed"}')).status).toBe(422);
  expect(calls).toHaveLength(1);
});

it.each(protectedRoutes)("keeps %s unresolved when storage also fails while recording rejection", async route => {
  vi.spyOn(ledger, "commitRequest").mockImplementation(() => { throw Error("Persistent simulated storage failure"); });
  expect((await post(route, "persistent-disk-failure")).status).toBe(500);
  expect(calls).toEqual([]);
  expect(ledger.active()).toEqual([]);
  expect(recoveryCalls).toBe(1);
  const retry = await post(route, "persistent-disk-failure");
  expect(retry.status).toBe(409);
  expect(retry.headers.get("Retry-After")).toBe("2");
  expect(recoveryCalls).toBe(1);
  expect(calls).toEqual([]);
});

it("keeps failed preparation recovery unresolved without dispatching or rerunning preparation", async () => {
  failRecovery = true;
  vi.spyOn(ledger, "commitRequest").mockImplementationOnce(() => { throw Error("Simulated storage failure"); });
  const first = await post("/api/shape-variants/generate", "recovery-failure");
  expect(first.status).toBe(500);
  expect(calls).toEqual([]);
  expect(ledger.active()).toEqual([]);
  expect(recoveryCalls).toBe(1);
  const retry = await post("/api/shape-variants/generate", "recovery-failure");
  expect(retry.status).toBe(409);
  expect(retry.headers.get("Retry-After")).toBe("2");
  expect(recoveryCalls).toBe(1);
  expect(calls).toEqual([]);
});
