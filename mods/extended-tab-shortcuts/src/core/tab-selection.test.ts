import { describe, expect, it } from "vitest";
import { extendTabSelection, type TabSelectionSession } from "./tab-selection.ts";

const step = (
  selectedIds: readonly string[],
  session: TabSelectionSession | null,
  direction: -1 | 1,
  visibleIds = ["a", "b", "c", "d"],
) =>
  extendTabSelection(
    {
      activeId: "b",
      selectedIds,
      visibleIds,
    },
    session,
    direction,
  );

describe("extendTabSelection", () => {
  it("grows from the active-tab anchor in either direction", () => {
    expect(step(["b"], null, 1)).toEqual({
      selectionIds: ["b", "c"],
      session: { anchorId: "b", headId: "c" },
    });
    expect(step(["b"], null, -1)).toEqual({
      selectionIds: ["a", "b"],
      session: { anchorId: "b", headId: "a" },
    });
  });

  it("shrinks through the anchor before growing on the other side", () => {
    const first = step(["b"], null, 1);
    const second = step(first.selectionIds ?? [], first.session, 1);
    const third = step(second.selectionIds ?? [], second.session, -1);
    const fourth = step(third.selectionIds ?? [], third.session, -1);
    const fifth = step(fourth.selectionIds ?? [], fourth.session, -1);

    expect(second).toEqual({
      selectionIds: ["b", "c", "d"],
      session: { anchorId: "b", headId: "d" },
    });
    expect(third.selectionIds).toEqual(["b", "c"]);
    expect(fourth).toEqual({
      selectionIds: ["b"],
      session: { anchorId: "b", headId: "b" },
    });
    expect(fifth).toEqual({
      selectionIds: ["a", "b"],
      session: { anchorId: "b", headId: "a" },
    });
  });

  it("uses only visible tabs and does not wrap at either boundary", () => {
    const skipped = step(["b"], null, 1, ["a", "b", "d"]);
    expect(skipped.selectionIds).toEqual(["b", "d"]);

    expect(
      extendTabSelection(
        { activeId: "a", selectedIds: ["a"], visibleIds: ["a", "b"] },
        null,
        -1,
      ),
    ).toEqual({ selectionIds: null, session: null });
    expect(
      extendTabSelection(
        { activeId: "b", selectedIds: ["b"], visibleIds: ["a", "b"] },
        null,
        1,
      ),
    ).toEqual({ selectionIds: null, session: null });
  });

  it("adopts a contiguous mouse selection and extends its directional edge", () => {
    const visibleIds = ["a", "b", "c", "d", "e"];
    const adopted = step(["a", "b", "c"], null, 1, visibleIds);

    expect(adopted).toEqual({
      selectionIds: ["a", "b", "c", "d"],
      session: { anchorId: "a", headId: "d" },
    });
    expect(step(adopted.selectionIds ?? [], adopted.session, -1, visibleIds)).toEqual({
      selectionIds: ["a", "b", "c"],
      session: { anchorId: "a", headId: "c" },
    });
  });

  it("restarts from the active tab after a non-contiguous mouse selection", () => {
    const session = { anchorId: "b", headId: "c" };

    expect(step(["a", "b", "d"], session, 1)).toEqual({
      selectionIds: ["b", "c"],
      session: { anchorId: "b", headId: "c" },
    });
  });
});
