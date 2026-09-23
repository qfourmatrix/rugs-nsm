// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { defaultProductState } from "../server/stateStore";
import { clearSavedLocalDraft, findLocalDraft, writeLocalDraft } from "../src/local-drafts";

describe("local recovery drafts", () => {
  beforeEach(() => localStorage.clear());
  it("separates products and does not delete newer edits after an older save", () => {
    const initial = defaultProductState("A");
    const newer = { ...initial, promptBox: { ...initial.promptBox, value: "new edit" } };
    writeLocalDraft(localStorage, "tab", initial);
    writeLocalDraft(localStorage, "tab", newer);
    clearSavedLocalDraft(localStorage, "tab", initial);
    expect(findLocalDraft(localStorage, "A")?.state.promptBox.value).toBe("new edit");
    expect(findLocalDraft(localStorage, "B")).toBeNull();
    clearSavedLocalDraft(localStorage, "tab", newer);
    expect(findLocalDraft(localStorage, "A")).toBeNull();
  });
  it("retains another tab's recovery copy and ignores corrupt drafts", () => {
    const state = defaultProductState("A");
    writeLocalDraft(localStorage, "other", state);
    writeLocalDraft(localStorage, "mine", state);
    clearSavedLocalDraft(localStorage, "mine", state);
    localStorage.setItem("rugs:unsaved-draft:v1:A:broken", "{oops");
    localStorage.setItem("rugs:unsaved-draft:v1:A:invalid", JSON.stringify({ savedAt: "2099-01-01", state: { productId: "A", settings: {} } }));
    expect(findLocalDraft(localStorage, "A")?.key).toContain(":other");
  });
});
