export interface PendingAction {
  key: string;
  label: string;
  productId: string | null;
  shotIds: readonly string[];
}

const galleryActions = new Set(["accept", "accept-all", "reject", "export-readiness", "validate-refine"]);
const libraryActions = new Set(["background-library", "rescan-backgrounds", "label-logo"]);
const globalActions = new Set(["save-master-shots", "save-refine-prompt", "save-sos-palette", "create-product"]);

/** Synchronous admission prevents same-render double clicks without a global UI lock. */
export class ActionGate {
  private readonly pending = new Map<string, PendingAction>();

  begin(label: string, productId: string | null, shotIds: readonly string[] = [], resource = ""): PendingAction | null {
    const scope = libraryActions.has(label) || globalActions.has(label) ? "global" : productId ?? "none";
    const group = galleryActions.has(label) ? "gallery" : libraryActions.has(label) ? "library" : label;
    const key = JSON.stringify([scope, group, shotIds, resource]);
    if (this.pending.has(key)) return null;
    if (shotIds.length && this.snapshot().some(action => action.productId === productId && action.shotIds.some(id => shotIds.includes(id) || id === "*" || shotIds.includes("*")))) return null;
    const action = { key, label, productId, shotIds: [...shotIds] };
    this.pending.set(key, action);
    return action;
  }

  finish(action: PendingAction) {
    if (this.pending.get(action.key) === action) this.pending.delete(action.key);
  }

  snapshot(): PendingAction[] { return [...this.pending.values()]; }
}
