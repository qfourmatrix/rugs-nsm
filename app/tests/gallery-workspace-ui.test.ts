import { DEFAULT_PREPARATION } from "../shared/export-preparation";
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryExportWorkspace } from "../src/components/GalleryExportWorkspace";
import type { AssetRecord, GalleryExportJob, GalleryPreflight, GallerySelection, ProductSummary } from "../shared/types";
import * as api from "../src/api";

vi.mock("../src/api", () => ({
  ApiError: class ApiError extends Error {},
  getCutoutBatch: vi.fn(), startCutoutBatch: vi.fn(), controlCutoutBatch: vi.fn(),
  getPhotoroomStatus: vi.fn(), getMainCutouts: vi.fn(), previewGalleryExport: vi.fn(), imageUrl: vi.fn(() => "/base.png"),
  getGalleryExportReceipts: vi.fn(), getGallerySelection: vi.fn(), getGenerated: vi.fn(),
  thumbnailUrl: vi.fn(() => "/thumb.png"), updateGallerySelection: vi.fn(), updateGalleryReadiness: vi.fn(), preflightGalleryExport: vi.fn(),
  startGalleryExport: vi.fn(), getGalleryExportJob: vi.fn(), galleryExportDownloadUrl: vi.fn()
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
function product(id: string, familyId: string, shape: ProductSummary["shape"], exportReady = false): ProductSummary {
  return { id, familyId, shape, exportReady, galleryRevision: 0, name: familyId, sourceProductId: familyId,
    createdAt: "2026-01-01T00:00:00Z", status: "ready", baseImage: "base.png", referenceImages: [], errors: [],
    counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 0, running: 0 } };
}
const products = [product("rug-a", "rug-a", "area", true), product("rug-a--runner", "rug-a", "runner"), product("rug-b", "rug-b", "area", true)];
function gallery(productId: string, assetIds: string[] = []): GallerySelection {
  return { version: 2, productId, revision: 0, exportReady: products.find((item) => item.id === productId)?.exportReady ?? false,
    readyAt: null, reviewedContent: null, assetIds, initializedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}
function button(label: string) { return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
function inclusion(shape: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="Include ${shape} in export"]`)!; }
function action(text: string) { return [...container.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent?.trim() === text)!; }
function preflight(): GalleryPreflight { return { version: 1, checkedAt: "2026-01-01T00:00:00Z", productIds: ["rug-a"], readyCount: 1, skippedCount: 0, shapes: [{ productId: "rug-a", familyId: "rug-a", shape: "area", status: "ready", itemCount: 1, issues: [], contentFingerprint: "fingerprint-main" }] }; }
async function render() { await act(async () => root.render(createElement(GalleryExportWorkspace, { products, currentProduct: products[0], masterShots: null, onClose: vi.fn() }))); }
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(api.getCutoutBatch).mockResolvedValue(null);
  vi.mocked(api.getPhotoroomStatus).mockResolvedValue({ configured: false });
  vi.mocked(api.getMainCutouts).mockResolvedValue([]);
  vi.mocked(api.getGalleryExportReceipts).mockResolvedValue({ receipts: [], nextCursor: null });
  vi.mocked(api.getGallerySelection).mockImplementation(async (id) => gallery(id));
  vi.mocked(api.getGenerated).mockResolvedValue({ active: [], trash: [], aggregates: {} });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("family-first gallery workspace", () => {
  it("shows all shapes together and permits the current base-only shape", async () => {
    await render();
    expect(container.querySelector('[aria-label="area gallery"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="runner gallery"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="round gallery"]')?.textContent).toContain("missing");
    expect(inclusion("area").checked).toBe(true);
    expect(inclusion("runner").checked).toBe(false);
    expect(container.textContent).toContain("Base-only gallery");
    expect(container.textContent).not.toContain("Add at least one accepted");
  });
  it("browses independently from checkbox selection and defaults a family to ready shapes", async () => {
    await render();
    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label^="Export rug-a:"]')!;
    expect(checkbox.indeterminate).toBe(true);
    await act(async () => button("Review rug-b galleries").click());
    expect(container.querySelector(".galleryCurationHeader h3")?.textContent).toBe("rug-b");
    expect(inclusion("area").checked).toBe(false);
    const bCheck = container.querySelector<HTMLInputElement>('input[aria-label^="Export rug-b:"]')!;
    await act(async () => bCheck.click());
    expect(inclusion("area").checked).toBe(true);
    await act(async () => button("Review rug-a galleries").click());
    expect(inclusion("area").checked).toBe(true);
    expect(inclusion("runner").checked).toBe(false);
    await act(async () => inclusion("runner").click());
    expect(container.textContent).toContain("Included, but not marked ready");
  });
  it("saves ordering by exact product and revision, and keeps the main locked", async () => {
    const assets = ["a", "b"].map((assetId) => ({ assetId, productId: "rug-a", shotId: assetId, shotName: `Shot ${assetId}`, attempt: 1, status: "accepted", createdAt: "2026-01-01", inputs: {}, output: { file: `${assetId}.png` } } as AssetRecord));
    vi.mocked(api.getGallerySelection).mockImplementation(async (id) => gallery(id, id === "rug-a" ? ["a", "b"] : []));
    vi.mocked(api.getGenerated).mockImplementation(async (id) => ({ active: id === "rug-a" ? assets : [], trash: [], aggregates: {} }));
    vi.mocked(api.updateGallerySelection).mockImplementation(async (id, assetIds) => ({ ...gallery(id, assetIds), revision: 1, exportReady: false }));
    await render();
    await act(async () => button("Move Shot b earlier").click());
    expect(api.updateGallerySelection).toHaveBeenCalledWith("rug-a", ["b", "a"], 0);
    expect(container.querySelector(".isMain button")).toBeNull();
    expect(inclusion("area").checked).toBe(false);
    expect(container.querySelector(".galleryFamilyNotice")?.textContent).toContain("changed");
  });
  it("opens preparation before checking and building with source fingerprints, and can retry failures", async () => {
    vi.mocked(api.preflightGalleryExport).mockResolvedValue(preflight());
    vi.mocked(api.startGalleryExport).mockRejectedValue(new Error("Fixture build interrupted"));
    await render();
    expect(action("Run preflight")).toBeUndefined();
    expect(action("Build ZIP")).toBeUndefined();
    await act(async () => action("Export selected").click());
    expect(api.preflightGalleryExport).not.toHaveBeenCalled();
    await act(async () => action("Continue to WebP").click());
    await act(async () => action("Download ZIP").click());
    expect(api.preflightGalleryExport).toHaveBeenCalledWith(["rug-a"], DEFAULT_PREPARATION);
    expect(api.startGalleryExport).toHaveBeenCalledWith(["rug-a"], { "rug-a": "fingerprint-main" }, DEFAULT_PREPARATION);
    expect(container.textContent).toContain("Fixture build interrupted");
    await act(async () => inclusion("runner").click());
    expect(action("Export selected").disabled).toBe(false);
    expect(container.querySelector(".galleryCheckIssues")).toBeNull();
  });
  it("does not silently include the current yellow shape on entry", async () => {
    await act(async () => root.render(createElement(GalleryExportWorkspace, { products: [products[1]], currentProduct: products[1], masterShots: null, onClose: vi.fn() })));
    expect(inclusion("runner").checked).toBe(false);
    expect(action("Export selected").disabled).toBe(true);
    const check = container.querySelector<HTMLInputElement>('input[aria-label^="Export rug-a:"]')!;
    await act(async () => check.click());
    expect(container.querySelector(".galleryFamilyNotice")?.textContent).toContain("No ready shapes");
    await act(async () => inclusion("runner").click());
    expect(action("Export selected").disabled).toBe(false);
  });
  it("pauses on blocked shapes and builds only after the user confirms valid-shape export", async () => {
    const checked = preflight();
    checked.productIds.push("rug-a--runner");
    checked.skippedCount = 1;
    checked.shapes.push({ productId: "rug-a--runner", familyId: "rug-a", shape: "runner", status: "skipped", itemCount: 1, contentFingerprint: "bad-main", issues: [{ code: "NON_SQUARE_IMAGE", severity: "blocker", productId: "rug-a--runner", familyId: "rug-a", shape: "runner", message: "Main image is not square." }] });
    vi.mocked(api.preflightGalleryExport).mockResolvedValue(checked);
    vi.mocked(api.startGalleryExport).mockRejectedValue(new Error("Fixture stop"));
    await render();
    await act(async () => inclusion("runner").click());
    await act(async () => action("Export selected").click());
    expect(api.preflightGalleryExport).not.toHaveBeenCalled();
    await act(async () => action("Continue to WebP").click());
    await act(async () => action("Download ZIP").click());
    expect(api.startGalleryExport).not.toHaveBeenCalled();
    expect(container.querySelector(".galleryCheckIssues")?.textContent).toContain("Main image is not square.");
    await act(async () => action("Go fix it").click());
    expect(document.activeElement?.id).toBe("gallery-shape-rug-a--runner");
    await act(async () => action("Export 1 valid shape").click());
    expect(api.startGalleryExport).toHaveBeenCalledWith(checked.productIds, { "rug-a": "fingerprint-main", "rug-a--runner": "bad-main" }, DEFAULT_PREPARATION);
  });
  it("keeps all-blocked selections editable and invalidates the error summary when selection changes", async () => {
    const checked = preflight();
    checked.readyCount = 0; checked.skippedCount = 1; checked.shapes[0].status = "skipped";
    vi.mocked(api.preflightGalleryExport).mockResolvedValue(checked);
    await render();
    await act(async () => action("Export selected").click());
    expect(api.preflightGalleryExport).not.toHaveBeenCalled();
    await act(async () => action("Continue to WebP").click());
    await act(async () => action("Download ZIP").click());
    expect(container.textContent).toContain("No selected shapes passed");
    expect(api.startGalleryExport).not.toHaveBeenCalled();
    await act(async () => inclusion("area").click());
    expect(container.querySelector(".galleryCheckIssues")).toBeNull();
  });
  it("automatically starts a finished ZIP download once, with a manual fallback", async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const job: GalleryExportJob = { exportId: "export_fixture", status: "ready", createdAt: "2026-01-01", updatedAt: "2026-01-01", archiveFilename: "fixture.zip", progress: { completed: 2, total: 2, message: "Ready" }, error: null, receipt: null };
    vi.mocked(api.preflightGalleryExport).mockResolvedValue(preflight());
    vi.mocked(api.startGalleryExport).mockResolvedValue(job);
    vi.mocked(api.getGalleryExportJob).mockResolvedValue(job);
    vi.mocked(api.galleryExportDownloadUrl).mockReturnValue("/download/fixture");
    await render();
    await act(async () => action("Export selected").click());
    expect(api.preflightGalleryExport).not.toHaveBeenCalled();
    await act(async () => action("Continue to WebP").click());
    await act(async () => action("Download ZIP").click());
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(action("Download ZIP")).toBeDefined();
    await act(async () => action("Recent exports").click());
    expect(anchorClick).toHaveBeenCalledTimes(1);
    anchorClick.mockRestore();
  });
  it("blocks duplicate clicks while checking and builds exactly once", async () => {
    let finish!: (value: GalleryPreflight) => void;
    vi.mocked(api.preflightGalleryExport).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    vi.mocked(api.startGalleryExport).mockRejectedValue(new Error("Fixture stop"));
    await render();
    await act(async () => action("Export selected").click());
    await act(async () => action("Continue to WebP").click());
    await act(async () => { action("Download ZIP").click(); action("Download ZIP").click(); });
    expect(api.preflightGalleryExport).toHaveBeenCalledTimes(1);
    expect(action("Checking images…").disabled).toBe(true);
    await act(async () => finish(preflight()));
    expect(api.startGalleryExport).toHaveBeenCalledTimes(1);
  });
  it("lets a shape be marked ready inside export and keeps approval separate from selection", async () => {
    vi.mocked(api.updateGalleryReadiness).mockImplementation(async () => {
      const ready = { ...gallery("rug-a--runner"), exportReady: true, revision: 1 };
      vi.mocked(api.getGallerySelection).mockImplementation(async (id) => id === ready.productId ? ready : gallery(id));
      return ready;
    });
    await render();
    await act(async () => button("Mark runner ready").click());
    expect(api.updateGalleryReadiness).toHaveBeenCalledWith("rug-a--runner", true, 0);
    expect(inclusion("runner").checked).toBe(false);
    expect(button("Mark runner not ready")).not.toBeNull();
  });
  it("counts selected galleries outside the open family without moving the preview", async () => {
    vi.mocked(api.getGallerySelection).mockImplementation(async (id) => gallery(id, id === "rug-b" ? ["a", "b"] : []));
    await render();
    await act(async () => container.querySelector<HTMLInputElement>('input[aria-label^="Export rug-b:"]')!.click());
    expect(container.querySelector(".galleryCurationHeader h3")?.textContent).toBe("rug-a");
    expect(container.querySelector(".galleryBatchSummary")?.textContent).toContain("2 rugs · 2 shape galleries · 4 images");
  });
  it("stops when automatic checks discover a newer gallery revision", async () => {
    const checked = preflight(); checked.shapes[0].galleryRevision = 1; checked.shapes[0].exportReady = false;
    vi.mocked(api.preflightGalleryExport).mockImplementation(async () => {
      vi.mocked(api.getGallerySelection).mockImplementation(async (id) => ({ ...gallery(id), revision: 1, exportReady: false }));
      return checked;
    });
    await render();
    await act(async () => action("Export selected").click());
    expect(api.preflightGalleryExport).not.toHaveBeenCalled();
    await act(async () => action("Continue to WebP").click());
    await act(async () => action("Download ZIP").click());
    expect(api.startGalleryExport).not.toHaveBeenCalled();
    expect(container.textContent).toContain("changed since you reviewed it");
    expect(inclusion("area").checked).toBe(false);
  });
  it("requires an explicit download if an additional shape is skipped during the build", async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const job: GalleryExportJob = { exportId: "export_changed", status: "ready", createdAt: "2026-01-01", updatedAt: "2026-01-01", archiveFilename: "fixture.zip", progress: { completed: 2, total: 2, message: "Ready" }, error: null,
      receipt: { version: 1, exportId: "export_changed", archiveFilename: "fixture.zip", createdAt: "2026-01-01", completedAt: "2026-01-01", downloadedAt: null,
        requestedProductIds: ["rug-a", "rug-b"], includedShapes: 1, skippedShapes: 1, archiveBytes: 100, archiveSha256: "fixture",
        encoder: { format: "webp", preset: "photo", quality: 90, effort: 6, smartSubsample: true, colourSpace: "srgb", maximumDimension: 4096, maximumBytes: 20971520, withoutEnlargement: true, metadata: "stripped" },
        shapes: [{ productId: "rug-a", familyId: "rug-a", shape: "area", status: "skipped", issues: [], images: [] }] } };
    vi.mocked(api.preflightGalleryExport).mockResolvedValue(preflight());
    vi.mocked(api.startGalleryExport).mockResolvedValue(job);
    vi.mocked(api.getGalleryExportJob).mockResolvedValue(job);
    await render();
    await act(async () => action("Export selected").click());
    expect(api.preflightGalleryExport).not.toHaveBeenCalled();
    await act(async () => action("Continue to WebP").click());
    await act(async () => action("Download ZIP").click());
    expect(anchorClick).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Files changed during export");
    await act(async () => action("Download valid shapes").click());
    expect(anchorClick).toHaveBeenCalledTimes(1);
    anchorClick.mockRestore();
  });
  it("reports stale order failures without discarding the saved gallery", async () => {
    const assets = ["a", "b"].map((assetId) => ({ assetId, productId: "rug-a", shotId: assetId, shotName: `Shot ${assetId}`, attempt: 1, status: "accepted", createdAt: "2026-01-01", inputs: {}, output: { file: `${assetId}.png` } } as AssetRecord));
    vi.mocked(api.getGallerySelection).mockImplementation(async (id) => gallery(id, id === "rug-a" ? ["a", "b"] : []));
    vi.mocked(api.getGenerated).mockImplementation(async (id) => ({ active: id === "rug-a" ? assets : [], trash: [], aggregates: {} }));
    vi.mocked(api.updateGallerySelection).mockRejectedValue(new Error("Gallery changed in another window"));
    await render();
    await act(async () => button("Move Shot b earlier").click());
    expect(container.textContent).toContain("Gallery changed in another window");
    const labels = [...container.querySelectorAll('[aria-label="area gallery"] .galleryOrderCopy strong')].map((node) => node.textContent);
    expect(labels).toEqual(["Main image", "Shot a", "Shot b"]);
  });
});
