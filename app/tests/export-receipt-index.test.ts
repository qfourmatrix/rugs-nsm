import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { getExportReceipt, listExportReceiptPage } from "../server/export-receipt-index";

let root: string;
let directory: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "receipt-index-test-"));
  directory = path.join(root, ".product-shot-queue", "export-receipts");
  await fs.mkdir(directory, { recursive: true });
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
async function receipt(id: string, time = "2026-01-01T00:00:00.000Z", downloadedAt: string | null = null) {
  const value = { exportId: id, archiveFilename: `${id}.zip`, completedAt: time, downloadedAt, archiveBytes: 123, includedShapes: 1, skippedShapes: 0, shapes: [{ images: ["large-detail".repeat(10000)] }] };
  await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify(value));
  return value;
}
it("paginates summaries without losing tied timestamps and retains full original details", async () => {
  const original = await receipt("export_a");
  await receipt("export_b"); await receipt("export_c");
  const first = await listExportReceiptPage(root, { limit: 2 });
  expect(first.receipts.map(item => item.exportId)).toEqual(["export_c", "export_b"]);
  expect(JSON.stringify(first).length).toBeLessThan(1000);
  expect(first.receipts[0]).not.toHaveProperty("shapes");
  const second = await listExportReceiptPage(root, { limit: 2, cursor: first.nextCursor! });
  expect(second.receipts.map(item => item.exportId)).toEqual(["export_a"]);
  expect(second.nextCursor).toBeNull();
  expect(await getExportReceipt(root, "export_a")).toEqual(original);
});
it("reconciles downloads, externally added/deleted/corrupt files and rebuilds a missing index", async () => {
  await receipt("export_a");
  expect((await listExportReceiptPage(root)).receipts).toHaveLength(1);
  await receipt("export_a", undefined, "2026-01-02T00:00:00.000Z");
  await receipt("export_b", "2026-01-03T00:00:00.000Z");
  const page = await listExportReceiptPage(root);
  expect(page.receipts.map(item => item.exportId)).toEqual(["export_b", "export_a"]);
  expect(page.receipts[1].downloadedAt).toBe("2026-01-02T00:00:00.000Z");
  await fs.unlink(path.join(directory, "export_b.json"));
  await fs.writeFile(path.join(directory, "export_a.json"), "{bad");
  expect((await listExportReceiptPage(root)).receipts).toEqual([]);
  await receipt("export_c");
  await fs.unlink(path.join(root, ".product-shot-queue", "export-receipt-index.sqlite"));
  expect((await listExportReceiptPage(root)).receipts.map(item => item.exportId)).toEqual(["export_c"]);
});
it("validates bounds, cursor and paths, and handles concurrent readers", async () => {
  await receipt("export_a");
  for (const limit of [0, -1, 101, 1.5, NaN]) await expect(listExportReceiptPage(root, { limit })).rejects.toMatchObject({ status: 400 });
  await expect(listExportReceiptPage(root, { cursor: "bad" })).rejects.toMatchObject({ status: 400 });
  await expect(getExportReceipt(root, "../../secret")).rejects.toMatchObject({ status: 400 });
  await expect(getExportReceipt(root, "export_missing")).rejects.toMatchObject({ status: 404 });
  await fs.symlink(path.join(directory, "export_a.json"), path.join(directory, "export_link.json"));
  await expect(getExportReceipt(root, "export_link")).rejects.toMatchObject({ status: 400 });
  const pages = await Promise.all(Array.from({ length: 4 }, () => listExportReceiptPage(root)));
  expect(pages.every(page => page.receipts.length === 1)).toBe(true);
});
