import express from "express";
import { afterEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { installPerfTelemetry, recordMockCall } from "../server/perf-telemetry";

const servers: Server[] = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });
async function start(mode: string) {
  const app = express(); installPerfTelemetry(app, mode, () => ({ retainedJobs: 500 }));
  const server = await new Promise<Server>(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test address");
  return `http://127.0.0.1:${address.port}/api/perf-test/metrics`;
}
it("never mounts diagnostics for a real provider, even with a test token", async () => {
  vi.stubEnv("RUGS_PERF_TOKEN", "x".repeat(32));
  expect((await fetch(await start("laozhang"), { headers: { "X-Perf-Token": "x".repeat(32) } })).status).toBe(404);
});
it("requires explicit opt-in and the matching token", async () => {
  vi.stubEnv("RUGS_PERF_TOKEN", "");
  expect((await fetch(await start("mock"))).status).toBe(404);
  const token = "x".repeat(32); vi.stubEnv("RUGS_PERF_TOKEN", token);
  const url = await start("mock");
  expect((await fetch(url)).status).toBe(404);
  const before = await fetch(url, { headers: { "X-Perf-Token": token } }).then(response => response.json());
  recordMockCall();
  const after = await fetch(url, { headers: { "X-Perf-Token": token } }).then(response => response.json());
  expect(after.mockCalls).toBe(before.mockCalls + 1);
  expect(after.retainedJobs).toBe(500);
  expect(after.memory.heapUsed).toBeGreaterThan(0);
  expect(JSON.stringify(after)).not.toContain(token);
});

it("allows collection only on authenticated opt-in mock runtimes with GC available", async () => {
  const token = "x".repeat(32); vi.stubEnv("RUGS_PERF_TOKEN", token);
  const gc = vi.fn(); vi.stubGlobal("gc", gc);
  const real = (await start("laozhang")).replace("metrics", "collect");
  expect((await fetch(real, { method: "POST", headers: { "X-Perf-Token": token } })).status).toBe(404);
  const mock = (await start("mock")).replace("metrics", "collect");
  expect((await fetch(mock, { method: "POST" })).status).toBe(404);
  expect(gc).not.toHaveBeenCalled();
  const result = await fetch(mock, { method: "POST", headers: { "X-Perf-Token": token } }).then(response => response.json());
  expect(result.collected).toBe(true); expect(gc).toHaveBeenCalledTimes(2);
  vi.stubGlobal("gc", undefined);
  expect((await fetch(mock, { method: "POST", headers: { "X-Perf-Token": token } })).status).toBe(503);
});
