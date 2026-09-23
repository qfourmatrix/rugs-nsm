/** Preference persistence must not block every pointer movement or crash the editor. */
export function schedulePanelWidthSave(key: string, width: number) {
  const timer = window.setTimeout(() => {
    try { window.localStorage.setItem(key, String(width)); } catch { /* Optional layout preference. */ }
  }, 150);
  return () => window.clearTimeout(timer);
}

export function beginPanelDrag(onMove: (event: PointerEvent) => void) {
  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("blur", cleanup);
    document.body.classList.remove("isResizingPanels");
  };
  document.body.classList.add("isResizingPanels");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", cleanup, { once: true });
  window.addEventListener("pointercancel", cleanup, { once: true });
  window.addEventListener("blur", cleanup, { once: true });
  return cleanup;
}
