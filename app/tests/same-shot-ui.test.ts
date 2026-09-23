// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GeneratePanel } from "../src/components/GeneratePanel";
import { createDefaultProductState, PLACEHOLDER_MASTER_SHOTS } from "../shared/constants";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("allows another active-shot attempt but blocks an unconfirmed submission or empty prompt", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onGeneratePrompt = vi.fn();
  const state = createDefaultProductState("rug", "texture_macro");
  const props: Parameters<typeof GeneratePanel>[0] = {
    product: { id: "rug", name: "Rug", familyId: "rug", sourceProductId: "rug", shape: "area", status: "ready",
      baseImage: "base.png", referenceImages: [], createdAt: "", errors: [],
      counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 0, running: 1 } },
    masterShots: PLACEHOLDER_MASTER_SHOTS, productState: state, backgroundLibrary: null,
    aggregates: { texture_macro: "generating" }, jobs: [], savingState: false, busyAction: null,
    busyActions: new Set(), runningShotIds: new Set(["texture_macro"]), onGeneratePrompt,
    onLoadShot: vi.fn(), onPromptChange: vi.fn(), onSettingsChange: vi.fn(), onReferencesChange: vi.fn(),
    onGenerateMissing: vi.fn(), onRetryFailed: vi.fn(), onCancelPending: vi.fn(), onMasterShotsSave: vi.fn(),
    onBackgroundManifestSave: vi.fn(), onBackgroundLibraryRescan: vi.fn(), onLabelLogoSave: vi.fn(),
    onProductBackgroundChange: vi.fn(), onConstructionChange: vi.fn()
  };
  const button = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Generate Selected")!;
  try {
    await act(async () => root.render(createElement(GeneratePanel, props)));
    expect(button().disabled).toBe(false);
    await act(async () => button().click());
    expect(onGeneratePrompt).toHaveBeenCalledWith("texture_macro");
    await act(async () => root.render(createElement(GeneratePanel, { ...props, busyActions: new Set(["generate"]) })));
    expect(button().disabled).toBe(true);
    await act(async () => root.render(createElement(GeneratePanel, props)));
    expect(button().disabled).toBe(false);
    await act(async () => root.render(createElement(GeneratePanel, { ...props,
      productState: { ...state, promptBox: { ...state.promptBox, value: "" } } })));
    expect(button().disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
