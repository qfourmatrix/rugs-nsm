// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ComparePanel } from "../src/components/ComparePanel";
import { getGeneratedAsset } from "../src/api";
import { makeAssetRecord } from "./test-utils";
import type { ProductSummary } from "../shared/types";
import type { LocatedAsset } from "../src/types";
vi.mock("../src/api", async original => ({ ...await original<typeof import("../src/api")>(), getGeneratedAsset: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("loads only inspected details, aborts stale reads and keeps errors retryable", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const first = { ...makeAssetRecord(), location: "generated" as const, detailsOmitted: true as const, prompt: "" };
  const second = { ...first, assetId: "second" };
  const product = { id: first.productId, name: "Rug", baseImage: "base.png" } as ProductSummary;
  let resolveFirst!: (value: Awaited<ReturnType<typeof getGeneratedAsset>>) => void;
  vi.mocked(getGeneratedAsset).mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockRejectedValueOnce(Error("Offline"))
    .mockResolvedValueOnce({ asset: { ...makeAssetRecord(), assetId: "second", prompt: "Exact stored prompt" }, location: "generated" });
  const render = (asset: LocatedAsset) => act(async () => root.render(createElement(ComparePanel, { product, selectedAsset: asset, assets: [first, second], actionDisabled: false, retryDisabled: false,
    onBackToGenerate: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn(), onAccept: vi.fn(), onReject: vi.fn(), onRetry: vi.fn() })));
  try {
    await render(first);
    expect(container.textContent).toContain("Loading full details");
    expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
    const firstSignal = vi.mocked(getGeneratedAsset).mock.calls[0][2]!;
    await render(second);
    expect(firstSignal.aborted).toBe(true);
    expect(container.textContent).toContain("Offline");
    await act(async () => resolveFirst({ asset: { ...makeAssetRecord(), prompt: "Stale old prompt" }, location: "generated" }));
    expect(container.textContent).not.toContain("Stale old prompt");
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Retry details")!.click());
    expect(container.textContent).toContain("Exact stored prompt");
    expect(getGeneratedAsset).toHaveBeenCalledTimes(3);
    vi.mocked(getGeneratedAsset).mockResolvedValueOnce({ asset: { ...makeAssetRecord(), assetId: "second", prompt: "Externally updated prompt" }, location: "generated" });
    await render({ ...second, detailsRevision: "new-metadata-revision" });
    expect(getGeneratedAsset).toHaveBeenCalledTimes(4);
    expect(container.textContent).toContain("Externally updated prompt");
    expect(container.textContent).not.toContain("Exact stored prompt");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
