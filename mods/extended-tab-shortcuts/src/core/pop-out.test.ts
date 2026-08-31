import { describe, expect, it } from "vitest";
import { decidePopOut, type PopOutSnapshot, type PopOutTab } from "./pop-out.ts";

const tab = (id: string, overrides: Partial<PopOutTab> = {}): PopOutTab => ({
  essential: false,
  grouped: false,
  id,
  split: false,
  ...overrides,
});

const snapshot = (overrides: Partial<PopOutSnapshot> = {}): PopOutSnapshot => ({
  activeId: "b",
  currentSpaceTabIds: ["a", "b", "c", "d"],
  hasMultiSelection: false,
  privateWindow: false,
  selectedIds: ["b"],
  tabs: [tab("a"), tab("b"), tab("c"), tab("d")],
  ...overrides,
});

describe("decidePopOut", () => {
  it("moves only the active tab when there is no multiselection", () => {
    expect(decidePopOut(snapshot())).toEqual({
      createSourceTab: false,
      kind: "move",
      tabIds: ["b"],
    });
  });

  it("moves the complete ordered selection", () => {
    expect(
      decidePopOut(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["b", "a", "c"],
        }),
      ),
    ).toEqual({
      createSourceTab: false,
      kind: "move",
      tabIds: ["a", "b", "c"],
    });
  });

  it("creates a source tab when every current-space tab will move", () => {
    expect(
      decidePopOut(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["a", "b", "c", "d"],
        }),
      ),
    ).toEqual({
      createSourceTab: true,
      kind: "move",
      tabIds: ["a", "b", "c", "d"],
    });
  });

  it("blocks private windows before moving any tab", () => {
    expect(decidePopOut(snapshot({ privateWindow: true }))).toEqual({
      kind: "blocked",
      reason: "private-window",
    });
  });

  it.each([
    ["essential", { essential: true }],
    ["grouped", { grouped: true }],
    ["split", { split: true }],
  ] as const)("blocks a selection containing an %s tab", (reason, unsupported) => {
    expect(
      decidePopOut(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["a", "b"],
          tabs: [tab("a"), tab("b", unsupported)],
        }),
      ),
    ).toEqual({ kind: "blocked", reason });
  });
});
