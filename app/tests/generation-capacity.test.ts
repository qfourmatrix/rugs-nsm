import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { makeProduct } from "./test-utils";

it.each(["different products", "same shot"])("runs twelve jobs for %s, queues the thirteenth, and reuses a manually cancelled slot", async mode => {
  const root = await mkdtemp(path.join(tmpdir(), "rugs-capacity-"));
  await Promise.all(Array.from({ length: 13 }, (_, i) => makeProduct(root, `rug-${i}`)));
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as { port: number };
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const token = randomUUID();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: appRoot, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, RUGS_PRODUCT_ROOT_OVERRIDE: root, RUGS_PORT_OVERRIDE: String(port),
      RUGS_PROVIDER_MODE_OVERRIDE: "mock", RUGS_PERF_TOKEN: token, MOCK_LATENCY_MIN_MS: "3000", MOCK_LATENCY_MAX_MS: "3000" }
  });
  let logs = "";
  child.stdout!.on("data", chunk => { logs = (logs + chunk).slice(-2000); });
  child.stderr!.on("data", chunk => { logs = (logs + chunk).slice(-2000); });
  const read = async (route: string) => {
    const response = await fetch(origin + route, { headers: { "X-Perf-Token": token } });
    expect(response.ok).toBe(true);
    return response.json();
  };
  const until = async (check: () => Promise<boolean>) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw Error(`Fixture exited: ${logs}`);
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(`Fixture condition not reached: ${logs}`);
  };
  try {
    await until(async () => {
      try {
        const { appInfo } = await read("/api/app-info");
        expect(appInfo).toMatchObject({ providerMode: "mock", productRoot: root, queueConcurrency: 12 });
        return true;
      } catch (error) {
        if (error instanceof TypeError) return false;
        throw error;
      }
    });
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) {
      const route = origin + `/api/products/rug-${mode === "same shot" ? 0 : i}/generate`;
      const request = { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        body: JSON.stringify({ shotId: "texture_macro", prompt: `Local mock concurrency check ${i}`, settings: { aspectRatio: "1:1", imageSize: "1K" }, batchSize: 1, referenceImages: [] }) };
      const response = await fetch(route, request);
      expect(response.ok).toBe(true);
      const admitted = await response.json();
      ids.push(...admitted.jobIds);
      if (i === 0) {
        const replay = await fetch(route, request);
        expect(replay.ok).toBe(true);
        expect(await replay.json()).toEqual(admitted);
      }
    }
    await until(async () => (await read("/api/perf-test/metrics")).mockCalls === 12);
    const { jobs } = await read("/api/jobs");
    expect(jobs.filter((job: { status: string }) => job.status === "generating")).toHaveLength(12);
    expect(jobs.find((job: { jobId: string }) => job.jobId === ids[12]).status).toBe("queued");
    if (mode === "same shot") {
      const { products } = await read("/api/products");
      expect(products.find((product: { id: string }) => product.id === "rug-0").counts.running).toBe(13);
    }
    const cancel = await fetch(origin + `/api/jobs/${ids[0]}/cancel`, { method: "POST" });
    expect(cancel.ok).toBe(true);
    await until(async () => (await read("/api/perf-test/metrics")).mockCalls === 13);
    await until(async () => {
      const { jobs: current } = await read("/api/jobs");
      expect(current.filter((job: { status: string }) => job.status === "generating").length).toBeLessThanOrEqual(12);
      return current.filter((job: { status: string }) => job.status === "succeeded").length === 12;
    });
    expect((await read("/api/perf-test/metrics")).mockCalls).toBe(13);
    if (mode === "same shot") {
      const { generated } = await read("/api/products/rug-0/generated");
      expect(generated.active).toHaveLength(12);
      expect(new Set(generated.active.map((asset: { assetId: string }) => asset.assetId)).size).toBe(12);
      expect(generated.active.map((asset: { attempt: number }) => asset.attempt).sort((a: number, b: number) => a - b))
        .toEqual(Array.from({ length: 12 }, (_, index) => index + 2));
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
  }
}, 20_000);
