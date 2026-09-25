import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, it } from "vitest";
import { GalleryExportSelectionSchema } from "../shared/schemas";

it("exports 210 selected galleries through preflight, build and ZIP download", async () => {
  const productIds = Array.from({ length: 210 }, (_, i) => `rug-${i}`);
  expect(GalleryExportSelectionSchema.parse({ productIds }).productIds).toEqual(productIds);
  const root = await mkdtemp(path.join(tmpdir(), "rugs-export-batch-"));
  const original = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#bca" } }).png().toBuffer();
  for (const id of productIds) {
    await mkdir(path.join(root, id));
    await writeFile(path.join(root, id, "base.png"), original);
  }
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    env: { ...process.env, RUGS_PRODUCT_ROOT_OVERRIDE: root, RUGS_PORT_OVERRIDE: String(port), RUGS_PROVIDER_MODE_OVERRIDE: "mock" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", data => { logs = (logs + data).slice(-2000); });
  child.stderr.on("data", data => { logs = (logs + data).slice(-2000); });
  const url = `http://127.0.0.1:${port}`;
  const post = (route: string, body: unknown) => fetch(url + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  async function until<T>(check: () => Promise<T | undefined>): Promise<T> {
    for (let i = 0; i < 800; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      const value = await check();
      if (value !== undefined) return value;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Server did not finish: ${logs}`);
  }
  try {
    const info = await until(async () => {
      try { return await (await fetch(url + "/api/app-info")).json(); } catch { return undefined; }
    });
    expect(info.appInfo.providerMode).toBe("mock");
    expect(info.appInfo.productRoot).toBe(root);
    for (const route of ["/api/gallery-exports/preflight", "/api/gallery-exports"]) {
      for (const invalid of [[], [""], ["x".repeat(241)]]) {
        expect((await post(route, { productIds: invalid })).status).toBe(400);
      }
      const duplicate = await post(route, { productIds: [productIds[0], productIds[0]] });
      expect(duplicate.status).toBe(400);
      expect((await duplicate.json()).error.code).toBe("DUPLICATE_PRODUCT_SELECTION");
      expect((await post(route, { productIds: ["missing"] })).status).toBe(404);
    }
    const checked = await post("/api/gallery-exports/preflight", { productIds });
    expect(checked.status).toBe(200);
    const { preflight } = await checked.json();
    expect(preflight.readyCount).toBe(210);
    expect(preflight.skippedCount).toBe(0);
    const expectedFingerprints = Object.fromEntries(preflight.shapes.map((shape: { productId: string; contentFingerprint: string }) => [shape.productId, shape.contentFingerprint]));
    const started = await post("/api/gallery-exports", { productIds, expectedFingerprints });
    expect(started.status).toBe(202);
    const { exportJob } = await started.json();
    await until(async () => {
      const { exportJob: job } = await (await fetch(`${url}/api/gallery-exports/${exportJob.exportId}`)).json();
      if (job.status === "failed") throw new Error(JSON.stringify(job));
      return job.status === "ready" ? job : undefined;
    });
    const download = await fetch(`${url}/api/gallery-exports/${exportJob.exportId}/download`);
    expect(download.status).toBe(200);
    const zip = path.join(root, "export.zip");
    await writeFile(zip, Buffer.from(await download.arrayBuffer()));
    const exec = promisify(execFile);
    const { stdout } = await exec("unzip", ["-p", zip, "export-manifest.json"]);
    const manifest = JSON.parse(stdout);
    expect(manifest.shapes).toHaveLength(210);
    expect(manifest.includedShapes).toBe(210);
    expect(manifest.skippedShapes).toBe(0);
    expect(manifest.requestedProductIds).toEqual(productIds);
    const { stdout: files } = await exec("unzip", ["-Z1", zip]);
    expect(files.trim().split("\n").filter(file => !file.endsWith("/"))).toHaveLength(421);
    const { stdout: extracted } = await exec("unzip", ["-p", zip, "rug-209/area/originals/base.png"], { encoding: "buffer" });
    expect(extracted.equals(original)).toBe(true);
  } finally {
    if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
