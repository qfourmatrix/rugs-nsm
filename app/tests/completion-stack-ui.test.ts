// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CompletionStack } from "../src/components/CompletionStack";
import { getCompletionPreview } from "../src/api";
import type { JobRecord } from "../shared/types";
vi.mock("../src/api", async original => ({ ...await original<typeof import("../src/api")>(), getCompletionPreview: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("caps thumbnails, expands without navigating, opens exact shot and never replays dismissed jobs", async () => {
  vi.useFakeTimers();
  vi.mocked(getCompletionPreview).mockResolvedValue({ file: "small.webp" });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); const onOpen = vi.fn();
  const jobs: JobRecord[] = Array.from({ length: 9 }, (_, i) => ({ jobId: String(i), runId: "run", productId: "other--runner", shotId: "wide_room_hero", status: "succeeded", assetId: String(i), createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() + 1000).toISOString(), message: "Done" }));
  const render = (list: JobRecord[]) => act(async () => root.render(createElement(CompletionStack, { jobs: list, currentProductId: "current", onOpen })));
  try {
    await render([]); await render(jobs);
    expect(host.querySelectorAll("img")).toHaveLength(6);
    expect(getCompletionPreview).toHaveBeenCalledTimes(6);
    await act(async () => (host.querySelector("button:not(:disabled)") as HTMLButtonElement).click());
    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".isExpanded")).not.toBeNull();
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    expect(onOpen.mock.calls[0][0].jobId).toBe("3");
    await act(async () => vi.advanceTimersByTime(200));
    expect(host.querySelector(".completionStack")).toBeNull();
    await render([...jobs]);
    expect(host.querySelector(".completionStack")).toBeNull();
    expect(getCompletionPreview).toHaveBeenCalledTimes(6);
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); }
});
