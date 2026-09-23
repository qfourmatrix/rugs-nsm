// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BackgroundLibraryPanel } from "../src/components/GeneratePanel";
import type { BackgroundLibraryState, ProductSummary } from "../shared/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("browses every background with at most48 mounted cards and selects from the final page", async () => {
  const library: BackgroundLibraryState = { manifestPath: null, manifestMtimeMs: null, manifestSha256: null, scannedAt: null,
    labelLogoPath: null, labelLogoExists: false, errors: [], backgrounds: Array.from({ length: 145 }, (_, i) => ({
      id: `room-${i}`, title: `Room ${i}`, type: "interior_living", runnerArchetype: null, runnerShotCompatibility: [],
      previewImagePath: "preview.jpg", promptPath: "prompt.txt", fingerprint: `${i}`, firstSeenAt: "", lastSeenAt: "", usedAt: null, useCount: 0, status: "new"
    })) };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const onBackgroundChange = vi.fn();
  const product: ProductSummary = { id: "rug", name: "Rug", familyId: "rug", sourceProductId: "rug", shape: "area", status: "ready", baseImage: "base.png", referenceImages: [], createdAt: "", errors: [], counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 0, running: 0 } };
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.getAttribute("aria-label") === text || element.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(createElement(BackgroundLibraryPanel, { product, selectedShot: null, library, selectedBackground: null,
      selectedBackgroundId: null, disabled: false, onManifestSave: vi.fn(), onRescan: vi.fn(), onLabelLogoSave: vi.fn(), onBackgroundChange })));
    await act(async () => button("Choose Background").click());
    const seen = new Set<string>();
    for (let page = 0; page < 4; page++) {
      const cards = container.querySelectorAll<HTMLButtonElement>(".backgroundCard");
      expect(cards.length).toBe(page === 3 ? 1 : 48);
      cards.forEach(card => seen.add(card.querySelector("strong")!.textContent!));
      if (page < 3) await act(async () => button("Next backgrounds").click());
    }
    expect(seen.size).toBe(145);
    expect(button("Next backgrounds").disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>(".backgroundCard")!.click());
    expect(onBackgroundChange).toHaveBeenCalledWith("room-144");
    expect(container.querySelectorAll(".backgroundCard")).toHaveLength(0);
    await act(async () => button("Choose Background").click());
    expect(container.querySelectorAll(".backgroundCard")).toHaveLength(48);
    expect(button("Previous backgrounds").disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
