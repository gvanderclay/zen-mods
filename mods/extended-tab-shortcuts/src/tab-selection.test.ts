import { describe, expect, it, vi } from "vitest";
import {
  createTabSelectionController,
  type TabSelectionPort,
  type TabSelectionSnapshot,
} from "./tab-selection.ts";

const createPort = () => {
  let snapshot: TabSelectionSnapshot = {
    activeId: "b",
    hasMultiSelection: false,
    selectedIds: ["b"],
    visibleIds: ["a", "b", "c", "d"],
  };
  const selectionListeners = new Set<() => void>();
  const activeListeners = new Set<() => void>();
  const revealTab = vi.fn();
  const port: TabSelectionPort = {
    read: vi.fn(() => snapshot),
    applySelection: vi.fn(selectionIds => {
      snapshot = {
        ...snapshot,
        hasMultiSelection: selectionIds.length > 1,
        selectedIds: selectionIds,
      };
      for (const listener of selectionListeners) listener();
    }),
    clearSelection: vi.fn(() => {
      snapshot = {
        ...snapshot,
        hasMultiSelection: false,
        selectedIds: [snapshot.activeId ?? ""],
      };
      for (const listener of selectionListeners) listener();
    }),
    revealTab,
    onActiveChange(listener) {
      activeListeners.add(listener);
      return () => activeListeners.delete(listener);
    },
    onSelectionChange(listener) {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
  };
  return {
    activeListeners,
    port,
    read: () => snapshot,
    revealTab,
    selectionListeners,
    setSnapshot(value: TabSelectionSnapshot) {
      snapshot = value;
    },
  };
};

describe("tab selection controller", () => {
  it("reveals each new range edge after changing the selection", () => {
    const { port, revealTab } = createPort();
    const controller = createTabSelectionController(port);

    controller.next();
    controller.next();
    controller.next();
    controller.previous();
    controller.previous();

    expect(revealTab).toHaveBeenNthCalledWith(1, "c");
    expect(revealTab).toHaveBeenNthCalledWith(2, "d");
    expect(revealTab).toHaveBeenNthCalledWith(3, "c");
    expect(revealTab).toHaveBeenNthCalledWith(4, "b");
    expect(revealTab).toHaveBeenCalledTimes(4);
  });

  it("keeps its session across owned selection events", () => {
    const { port, read } = createPort();
    const controller = createTabSelectionController(port);

    controller.next();
    controller.next();
    controller.previous();
    controller.previous();
    controller.previous();

    expect(read().selectedIds).toEqual(["a", "b"]);
    expect(port.applySelection).toHaveBeenNthCalledWith(1, ["b", "c"]);
    expect(port.applySelection).toHaveBeenNthCalledWith(2, ["b", "c", "d"]);
    expect(port.applySelection).toHaveBeenNthCalledWith(3, ["b", "c"]);
    expect(port.applySelection).toHaveBeenNthCalledWith(4, ["b"]);
    expect(port.applySelection).toHaveBeenNthCalledWith(5, ["a", "b"]);
  });

  it("restarts at the active tab after an external multiselection", () => {
    const { port, selectionListeners, setSnapshot } = createPort();
    const controller = createTabSelectionController(port);
    controller.next();
    setSnapshot({
      activeId: "b",
      hasMultiSelection: true,
      selectedIds: ["a", "b", "d"],
      visibleIds: ["a", "b", "c", "d"],
    });
    for (const listener of selectionListeners) listener();

    controller.next();

    expect(port.applySelection).toHaveBeenLastCalledWith(["b", "c"]);
  });

  it("continues a contiguous external multiselection", () => {
    const { port, selectionListeners, setSnapshot } = createPort();
    const controller = createTabSelectionController(port);
    setSnapshot({
      activeId: "b",
      hasMultiSelection: true,
      selectedIds: ["a", "b", "c"],
      visibleIds: ["a", "b", "c", "d"],
    });
    for (const listener of selectionListeners) listener();

    controller.next();

    expect(port.applySelection).toHaveBeenLastCalledWith(["a", "b", "c", "d"]);
  });

  it("clears selection and makes disposed commands inert", () => {
    const { activeListeners, port, selectionListeners } = createPort();
    const controller = createTabSelectionController(port);
    controller.next();

    controller.clear();
    expect(port.clearSelection).toHaveBeenCalledOnce();

    controller.dispose();
    expect(activeListeners).toHaveLength(0);
    expect(selectionListeners).toHaveLength(0);
    controller.next();
    expect(port.applySelection).toHaveBeenCalledOnce();
  });
});
