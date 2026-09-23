// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GenerationRecovery } from "../src/components/GenerationRecovery";
import { checkGenerationRequest } from "../src/api";
vi.mock("../src/api", () => ({ checkGenerationRequest: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("makes damaged recovery explicit, cancelable, and read-only until confirmed", async () => {
  localStorage.clear();
  const name = "rugs:generation-intent:v1:" + encodeURIComponent("/api/products/rug/generate");
  localStorage.setItem(name, "{broken");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    await act(async () => root.render(createElement(GenerationRecovery)));
    expect(container.textContent).toContain("Damaged saved submission");
    const button = Array.from(container.querySelectorAll("button")).find(item => item.textContent === "Clear damaged record after review")!;
    await act(async () => button.click());
    expect(localStorage.getItem(name)).toBe("{broken");
    confirmation.mockReturnValue(true);
    await act(async () => button.click());
    expect(localStorage.getItem(name)).toBeNull();
    expect(container.textContent).toContain("No job was submitted or canceled");
    expect(checkGenerationRequest).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); container.remove(); confirmation.mockRestore(); localStorage.clear();
  }
});
