import { describe, expect, it } from "vitest";
import { decideFolderPickerKey } from "./folder-picker.ts";

const key = (
  value: string,
  overrides: Partial<Parameters<typeof decideFolderPickerKey>[0]> = {},
) =>
  decideFolderPickerKey({
    altKey: false,
    ctrlKey: false,
    destinations: [
      { id: "alpha", shortcut: "1" },
      { id: "beta", shortcut: "2" },
      { id: "overflow", shortcut: null },
    ],
    key: value,
    metaKey: false,
    view: "destinations",
    ...overrides,
  });

describe("decideFolderPickerKey", () => {
  it("maps visible destination numbers immediately", () => {
    expect(key("1")).toEqual({ folderId: "alpha", kind: "move" });
    expect(key("2")).toEqual({ folderId: "beta", kind: "move" });
    expect(key("3")).toEqual({ kind: "none" });
  });

  it("supports Vim and arrow navigation plus new-folder and close actions", () => {
    expect(key("j")).toEqual({ direction: 1, kind: "navigate" });
    expect(key("ArrowDown")).toEqual({ direction: 1, kind: "navigate" });
    expect(key("K")).toEqual({ direction: -1, kind: "navigate" });
    expect(key("ArrowUp")).toEqual({ direction: -1, kind: "navigate" });
    expect(key("n")).toEqual({ kind: "new-folder" });
    expect(key("Enter")).toEqual({ kind: "activate" });
    expect(key("Escape")).toEqual({ kind: "close" });
  });

  it("leaves digits and letters alone in the naming view", () => {
    expect(key("2", { view: "new-folder" })).toEqual({ kind: "none" });
    expect(key("n", { view: "new-folder" })).toEqual({ kind: "none" });
    expect(key("Enter", { view: "new-folder" })).toEqual({ kind: "create" });
    expect(key("Backspace", { newFolderName: "", view: "new-folder" })).toEqual({
      kind: "go-back",
    });
    expect(key("Backspace", { newFolderName: "2", view: "new-folder" })).toEqual({
      kind: "none",
    });
    expect(key("Escape", { view: "new-folder" })).toEqual({ kind: "close" });
  });

  it("does not capture browser shortcuts", () => {
    expect(key("1", { metaKey: true })).toEqual({ kind: "none" });
    expect(key("j", { ctrlKey: true })).toEqual({ kind: "none" });
  });
});
