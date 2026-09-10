// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttemptCard } from "../src/components/AttemptCard";
import { FamilyShapeStatus } from "../src/components/FamilyShapeStatus";
import { LeftPanel, isBulkAcceptEligible } from "../src/components/LeftPanel";
import { RightPanel } from "../src/components/RightPanel";
import { ProductTabs } from "../src/components/ProductTabs";
import type { LocatedAsset } from "../src/types";
import type { ProductSummary } from "../shared/types";
vi.mock("../src/components/GeneratePanel", () => ({ GeneratePanel: () => null }));
vi.mock("../src/components/ComparePanel", () => ({ ComparePanel: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); });
async function render(element: ReturnType<typeof createElement>) {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(element)); return container;
}
function asset(overrides: Partial<LocatedAsset> = {}): LocatedAsset {
  return { assetId: "a", productId: "rug", shotId: "hero", shotName: "Hero", attempt: 1,
    status: "done", location: "generated", createdAt: "2026-01-01T00:00:00Z", inputs: {},
    output: { file: "hero.png" }, ...overrides } as LocatedAsset;
}
function product(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return { id: "rug", name: "Rug", familyId: "rug", sourceProductId: "rug", shape: "area", status: "ready",
    baseImage: "base.png", referenceImages: [], createdAt: "2026-01-01T00:00:00Z", errors: [],
    counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 0, running: 0 }, ...overrides };
}

describe("studio gallery review", () => {
  it("keeps tab status shapes in their own trailing column, outside the name and status", async () => {
    const dom = await render(createElement(ProductTabs, { products: [product()], selectedProductId: null,
      search: "", loading: false, onSearchChange: vi.fn(), onSelectProduct: vi.fn(), onRescan: vi.fn(),
      onCreateProduct: vi.fn(), onOpenGalleryExport: vi.fn() }));
    const card = dom.querySelector(".productRailTab")!;
    expect(card.querySelector(".productRailCopy .familyShapeStatus")).toBeNull();
    expect(card.lastElementChild?.className).toBe("familyShapeStatus");
    expect(card.querySelectorAll(".familyShapeGlyph")).toHaveLength(3);
  });
  it("quick Accept is a permanent sibling button and does not open review", async () => {
    const onAccept = vi.fn(); const onSelect = vi.fn();
    const dom = await render(createElement(AttemptCard, { asset: asset(), productId: "rug", selected: false,
      actionDisabled: false, retryDisabled: false, onAccept, onSelect, onReject: vi.fn(), onRetry: vi.fn() }));
    const accept = dom.querySelector<HTMLButtonElement>(".attemptQuickAccept")!;
    expect(accept.closest(".attemptReviewSurface")).toBeNull();
    expect(dom.querySelector(".attemptActions .attemptQuickAccept")).toBeNull();
    await act(async () => accept.click());
    expect(onAccept).toHaveBeenCalledWith("a"); expect(onSelect).not.toHaveBeenCalled();
  });
  it("shows accepted confirmation without an active accept control", async () => {
    const dom = await render(createElement(AttemptCard, { asset: asset({ status: "accepted" }), productId: "rug", selected: false,
      actionDisabled: false, retryDisabled: false, onAccept: vi.fn(), onSelect: vi.fn(), onReject: vi.fn(), onRetry: vi.fn() }));
    expect(dom.querySelector(".attemptQuickAccept")?.textContent).toContain("Accepted");
    expect(dom.querySelector("button.attemptQuickAccept")).toBeNull();
  });
  it("bulk acceptance excludes failed, accepted, trash, missing outputs and utility outputs", () => {
    expect(isBulkAcceptEligible(asset())).toBe(true);
    for (const entry of [asset({ status: "failed" }), asset({ status: "accepted" }), asset({ location: "trash" }),
      asset({ output: null }), ...["refine_base", "shape_runner_base", "shape_round_base"].map((shotId) => asset({ shotId })),
      asset({ inputs: { shapeVariant: {} } } as unknown as Partial<LocatedAsset>)]) expect(isBulkAcceptEligible(entry)).toBe(false);
  });
  it("renders exact fixed shape order with independent ready/not-ready/missing status", async () => {
    const dom = await render(createElement(FamilyShapeStatus, { products: [product({ exportReady: true }), product({ id: "rug--runner", shape: "runner", exportReady: false })] }));
    expect([...dom.querySelectorAll(".familyShapeGlyph")].map((node) => node.className)).toEqual([
      "familyShapeGlyph shape-area export-ready", "familyShapeGlyph shape-runner export-not-ready", "familyShapeGlyph shape-round export-missing"
    ]);
    expect(dom.querySelector('[aria-label="Runner: not ready for export"]')).not.toBeNull();
    expect(dom.querySelectorAll("svg")).toHaveLength(0);
  });
  it("bulk acceptance snapshots all eligible current-shape shots, including below the fold", async () => {
    const entries = Array.from({ length: 82 }, (_, index) => asset({ assetId: `a-${index}` }));
    const onAcceptAllDone = vi.fn();
    const dom = await render(createElement(LeftPanel, { product: product(), generated: { active: entries, trash: [], aggregates: {} },
      jobs: [], assets: [...entries, asset({ productId: "other-shape", assetId: "other" })], selectedAssetId: null,
      showTrash: false, actionDisabled: false, runningShotIds: new Set<string>(), onAcceptAllDone,
      onShowTrashChange: vi.fn(), onSelectAsset: vi.fn(), onAccept: vi.fn(), onReject: vi.fn(), onRetry: vi.fn(), onCancelJob: vi.fn() }));
    const button = dom.querySelector<HTMLButtonElement>(".acceptAllDone")!;
    expect(button.textContent).toContain("82");
    expect(button.title).toBe("Accept finished area shots only. Other shapes are unchanged.");
    await act(async () => button.click());
    expect(onAcceptAllDone).toHaveBeenCalledWith(entries.map((entry) => entry.assetId));
  });
  it("readiness controls mark a base-only shape and show the next shape independently", async () => {
    const onExportReadyChange = vi.fn();
    const props = { mode: "generate", product: product(), generated: { active: [], trash: [], aggregates: {} }, onExportReadyChange, onModeChange: vi.fn() } as unknown as Parameters<typeof RightPanel>[0];
    const dom = await render(createElement(RightPanel, props));
    expect(dom.querySelectorAll(".exportReadinessSegments > button")).toHaveLength(2);
    const ready = () => [...dom.querySelectorAll<HTMLButtonElement>(".exportReadinessControl button")].find((button) => button.textContent === "Ready")!;
    expect(ready().disabled).toBe(false);
    await act(async () => ready().click()); expect(onExportReadyChange).toHaveBeenCalledWith(true);
    await act(async () => root?.render(createElement(RightPanel, { ...props, product: product({ exportReady: true }) })));
    expect(ready().getAttribute("aria-pressed")).toBe("true");
    await act(async () => root?.render(createElement(RightPanel, { ...props, product: product({ id: "rug--runner", shape: "runner", exportReady: false }) })));
    expect(ready().getAttribute("aria-pressed")).toBe("false");
    await act(async () => root?.render(createElement(RightPanel, { ...props, product: product({ status: "missing_base", baseImage: null }) })));
    expect(ready().disabled).toBe(true);
    await act(async () => root?.render(createElement(RightPanel, { ...props, busyAction: "export-readiness" })));
    expect(dom.querySelector(".exportReadinessControl")?.getAttribute("aria-busy")).toBe("true");
    expect([...dom.querySelectorAll<HTMLButtonElement>(".exportReadinessSegments button")].every((button) => button.disabled)).toBe(true);
  });
});
