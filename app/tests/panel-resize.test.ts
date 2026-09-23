// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { beginPanelDrag, schedulePanelWidthSave } from "../src/panel-resize";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it.each(["pointerup", "pointercancel", "blur"])("cleans drag listeners on %s", event => {
  const move = vi.fn();
  const cleanup = beginPanelDrag(move);
  window.dispatchEvent(new Event("pointermove"));
  expect(move).toHaveBeenCalledTimes(1);
  expect(document.body.classList.contains("isResizingPanels")).toBe(true);
  window.dispatchEvent(new Event(event));
  window.dispatchEvent(new Event("pointermove"));
  expect(move).toHaveBeenCalledTimes(1);
  expect(document.body.classList.contains("isResizingPanels")).toBe(false);
  cleanup();
});
it("supports explicit unmount cleanup and cancels superseded preference writes", () => {
  vi.useFakeTimers();
  const move = vi.fn(); const cleanup = beginPanelDrag(move); cleanup();
  window.dispatchEvent(new Event("pointermove")); expect(move).not.toHaveBeenCalled();
  const save = vi.spyOn(Storage.prototype, "setItem");
  schedulePanelWidthSave("panel-test", 300)();
  const cancel = schedulePanelWidthSave("panel-test", 420);
  expect(save).not.toHaveBeenCalled();
  vi.advanceTimersByTime(150);
  expect(save).toHaveBeenCalledExactlyOnceWith("panel-test", "420");
  cancel();
  save.mockImplementation(() => { throw Error("Storage unavailable"); });
  schedulePanelWidthSave("panel-test", 500);
  expect(() => vi.advanceTimersByTime(150)).not.toThrow();
});
