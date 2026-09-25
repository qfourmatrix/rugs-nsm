// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GalleryExportWorkspace } from "../src/components/GalleryExportWorkspace";
import { getGalleryExportReceipts, getAvailableGalleryDownloads, getGalleryExportJob, getGallerySelection, getGenerated, preflightGalleryExport, startGalleryExport } from "../src/api";
import type { GalleryExportJob, ProductSummary } from "../shared/types";

vi.mock("../src/api", async importOriginal => ({
  ...await importOriginal<typeof import("../src/api")>(),
  getPhotoroomStatus: vi.fn(async () => ({ configured: false })), getMainCutouts: vi.fn(async () => []),
  getGalleryExportReceipts: vi.fn(),
  getAvailableGalleryDownloads: vi.fn(), getGalleryExportJob: vi.fn(), getGallerySelection: vi.fn(),
  getGenerated: vi.fn(), preflightGalleryExport: vi.fn(), startGalleryExport: vi.fn()
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.mocked(getGalleryExportReceipts).mockReset().mockResolvedValue({ receipts: [], nextCursor: null });
  vi.mocked(getAvailableGalleryDownloads).mockReset().mockResolvedValue([]);
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(GalleryExportWorkspace, {
    products: [], currentProduct: null, masterShots: null, onClose: vi.fn()
  })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function toggleHistory() {
  await act(async () => container.querySelector<HTMLButtonElement>(".galleryHistoryButton")!.click());
}

it("does not read receipts until history is opened and aborts the read on close", async () => {
  expect(getGalleryExportReceipts).not.toHaveBeenCalled();
  expect(getAvailableGalleryDownloads).not.toHaveBeenCalled();
  await toggleHistory();
  expect(getGalleryExportReceipts).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(getGalleryExportReceipts).mock.calls[0][0]!;
  expect(signal.aborted).toBe(false);
  expect(container.textContent).toContain("No exports yet.");
  await toggleHistory();
  expect(signal.aborted).toBe(true);
  expect(getGalleryExportReceipts).toHaveBeenCalledTimes(1);
  await toggleHistory();
  expect(getGalleryExportReceipts).toHaveBeenCalledTimes(2);
});

it("reports a receipt read failure instead of claiming history is empty", async () => {
  vi.mocked(getGalleryExportReceipts).mockRejectedValueOnce(Error("Receipt read failed"));
  await toggleHistory();
  expect(container.textContent).toContain("Could not load export history: Receipt read failed");
  expect(container.textContent).not.toContain("No exports yet.");
});

it("pages bounded summaries and retries an older-page failure without losing navigation", async () => {
  const summary = { exportId: "export_a", completedAt: "2026-01-01T00:00:00.000Z", downloadedAt: null, archiveFilename: "a.zip", archiveBytes: 100, includedShapes: 1, skippedShapes: 0 };
  vi.mocked(getGalleryExportReceipts)
    .mockResolvedValueOnce({ receipts: [summary], nextCursor: "older" })
    .mockRejectedValueOnce(Error("Offline"))
    .mockResolvedValueOnce({ receipts: [{ ...summary, exportId: "export_b" }], nextCursor: null });
  await toggleHistory();
  const click = async (label: string) => act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === label)!.click());
  await click("Older exports");
  expect(document.activeElement).toBe(container.querySelector('nav[aria-label="Export history pages"] [role="status"]'));
  expect(vi.mocked(getGalleryExportReceipts).mock.calls[1][1]).toBe("older");
  expect(container.textContent).toContain("Offline");
  await click("Retry history");
  expect(document.activeElement).toBe(container.querySelector('nav[aria-label="Export history pages"] [role="status"]'));
  expect(vi.mocked(getGalleryExportReceipts).mock.calls[2][1]).toBe("older");
  expect(container.textContent).toContain("Page 2");
  expect(container.querySelectorAll(".galleryHistory article")).toHaveLength(1);
  await click("Newer exports");
  expect(vi.mocked(getGalleryExportReceipts).mock.calls[3][1]).toBeUndefined();
  expect(container.textContent).toContain("Page 1");
});

it("backs off failed available-download reads and resets after recovery", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.mocked(getAvailableGalleryDownloads).mockRejectedValueOnce(Error("Offline")).mockRejectedValueOnce(Error("Offline"));
  await toggleHistory();
  expect(getAvailableGalleryDownloads).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(getAvailableGalleryDownloads).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(getAvailableGalleryDownloads).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(getAvailableGalleryDownloads).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(getAvailableGalleryDownloads).toHaveBeenCalledTimes(3);
  expect(container.textContent).not.toContain("Could not check available ZIPs");
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(getAvailableGalleryDownloads).toHaveBeenCalledTimes(4);
});

it("never overlaps slow export polls, skips hidden tabs and aborts on unmount", async () => {
  vi.useFakeTimers();
  let hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const product: ProductSummary = { id: "rug", name: "Rug", familyId: "rug", sourceProductId: "rug", shape: "area", status: "ready",
    baseImage: "base.png", referenceImages: [], createdAt: "2026-01-01T00:00:00Z", errors: [], exportReady: true, galleryRevision: 0,
    counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 0, running: 0 } };
  const job: GalleryExportJob = { exportId: "export_test", status: "queued", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    archiveFilename: null, progress: { completed: 0, total: 1, message: "Queued" }, error: null, receipt: null };
  vi.mocked(getGallerySelection).mockResolvedValue({ version: 2, productId: "rug", assetIds: [], initializedAt: "", updatedAt: "", revision: 0, exportReady: true, readyAt: null, reviewedContent: null });
  vi.mocked(getGenerated).mockResolvedValue({ active: [], trash: [], aggregates: {} });
  vi.mocked(preflightGalleryExport).mockResolvedValue({ version: 1, checkedAt: "", productIds: ["rug"], shapes: [], readyCount: 1, skippedCount: 0 });
  vi.mocked(startGalleryExport).mockResolvedValue(job);
  let finishPoll!: (job: GalleryExportJob) => void;
  vi.mocked(getGalleryExportJob).mockReset().mockImplementation(() => new Promise(resolve => { finishPoll = resolve; }));
  const onClose = vi.fn();
  const onExportStarted = vi.fn();
  await act(async () => root.render(createElement(GalleryExportWorkspace, {
    key: "with-product", products: [product], currentProduct: product, masterShots: null, onClose, onExportStarted
  })));
  const exportButton = [...container.querySelectorAll("button")].find(button => button.textContent === "Export selected")!;
  expect(exportButton.disabled).toBe(false);
  await act(async () => exportButton.click());
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Continue to WebP")!.click());
  const buildButton = [...container.querySelectorAll("button")].find(button => button.textContent === "Download ZIP")!;
  await act(async () => buildButton.click());
  expect(getGalleryExportJob).toHaveBeenCalledTimes(1);
  expect(onExportStarted).toHaveBeenCalledWith("export_test");
  const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close gallery export"]')!;
  expect(close.disabled).toBe(false);
  await act(async () => close.click());
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(getGalleryExportJob).toHaveBeenCalledTimes(1);
  expect(getGalleryExportReceipts).not.toHaveBeenCalled();
  hidden = true;
  await act(async () => { finishPoll(job); });
  await act(async () => vi.advanceTimersByTimeAsync(4000));
  expect(getGalleryExportJob).toHaveBeenCalledTimes(1);
  hidden = false;
  vi.mocked(getGalleryExportJob).mockRejectedValueOnce(Error("Offline"));
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(getGalleryExportJob).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(getGalleryExportJob).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(800));
  expect(getGalleryExportJob).toHaveBeenCalledTimes(3);
  const signal = vi.mocked(getGalleryExportJob).mock.calls[2][1]!;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});

it("restores an accepted export on reopening without submitting it again", async () => {
  vi.mocked(startGalleryExport).mockClear();
  vi.mocked(getGalleryExportJob).mockReset().mockResolvedValue({ exportId: "export_previous", status: "failed", createdAt: "", updatedAt: "", archiveFilename: null, progress: { completed: 0, total: 1, message: "Export failed" }, error: "Fixture failure", receipt: null });
  await act(async () => root.render(createElement(GalleryExportWorkspace, {
    key: "reopened", products: [], currentProduct: null, masterShots: null, onClose: vi.fn(), initialExportId: "export_previous"
  })));
  expect(getGalleryExportJob).toHaveBeenCalledWith("export_previous", expect.any(AbortSignal));
  expect(startGalleryExport).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Fixture failure");
});
