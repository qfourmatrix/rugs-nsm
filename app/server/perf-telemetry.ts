import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Express } from "express";

let mockCalls = 0;
export function recordMockCall() { mockCalls++; }

/** Opt-in disposable-test diagnostics. Never mounted with a real provider. */
export function installPerfTelemetry(app: Express, providerMode: string, snapshot: () => object) {
  const token = process.env.RUGS_PERF_TOKEN;
  if (providerMode !== "mock" || !token || token.length < 32) return;
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  app.post("/api/perf-test/collect", (req, res) => {
    if (req.get("X-Perf-Token") !== token) { res.sendStatus(404); return; }
    if (typeof globalThis.gc !== "function") { res.status(503).json({ error: "Test runtime lacks --expose-gc" }); return; }
    globalThis.gc();
    globalThis.gc();
    res.json({ timestamp: Date.now(), memory: process.memoryUsage(), ...snapshot(), collected: true });
  });
  app.get("/api/perf-test/metrics", (req, res) => {
    if (req.get("X-Perf-Token") !== token) { res.sendStatus(404); return; }
    const result = {
      timestamp: Date.now(), memory: process.memoryUsage(), cpu: process.cpuUsage(),
      resourceUsage: process.resourceUsage(), mockCalls,
      eventLoop: { p95Ms: delay.percentile(95) / 1e6, p99Ms: delay.percentile(99) / 1e6, maxMs: delay.max / 1e6 },
      ...snapshot()
    };
    delay.reset();
    res.json(result);
  });
}
