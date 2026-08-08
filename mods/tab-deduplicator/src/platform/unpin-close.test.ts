import { describe, expect, it, vi } from "vitest";
import {
  closeBrowserPinnedTab,
  runContextUnpinClose,
  runPinnedCloseTransaction,
} from "./unpin-close.ts";

interface FakeTab {
  id: string;
  live: boolean;
  pinned: boolean;
  essential: boolean;
}

const tab = (): FakeTab => ({
  id: "target",
  live: true,
  pinned: true,
  essential: false,
});

const isEligible = (target: FakeTab) => target.live && target.pinned && !target.essential;

describe("runPinnedCloseTransaction", () => {
  it("preflights, revalidates, unpins, then closes with unload checks skipped", async () => {
    const target = tab();
    const calls: string[] = [];

    await expect(
      runPinnedCloseTransaction({
        target,
        isEligible: candidate => {
          calls.push("validate");
          return isEligible(candidate);
        },
        runBeforeUnload: async candidates => {
          calls.push(`beforeunload:${candidates[0]?.id}`);
          return false;
        },
        unpin: candidate => {
          calls.push("unpin");
          candidate.pinned = false;
          return true;
        },
        close: (candidate, options) => {
          calls.push(`close:${candidate.id}:${options.skipPermitUnload}`);
        },
      }),
    ).resolves.toBe("closed");
    expect(calls).toEqual([
      "validate",
      "beforeunload:target",
      "validate",
      "unpin",
      "close:target:true",
    ]);
  });

  it("does nothing when the initial target is not eligible", async () => {
    const target = tab();
    target.pinned = false;
    const beforeUnload = vi.fn(async () => false);

    await expect(
      runPinnedCloseTransaction({
        target,
        isEligible,
        runBeforeUnload: beforeUnload,
        unpin: () => true,
        close: () => {},
      }),
    ).resolves.toBe("ineligible");
    expect(beforeUnload).not.toHaveBeenCalled();
  });

  it("leaves the pin unchanged when beforeunload blocks closing", async () => {
    const target = tab();
    const unpin = vi.fn(() => true);
    const close = vi.fn();

    await expect(
      runPinnedCloseTransaction({
        target,
        isEligible,
        runBeforeUnload: async () => true,
        unpin,
        close,
      }),
    ).resolves.toBe("unload-blocked");
    expect(target.pinned).toBe(true);
    expect(unpin).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it.each([
    ["closed", { live: false }],
    ["unpinned", { pinned: false }],
    ["newly essential", { essential: true }],
  ])("aborts when the target becomes %s during preflight", async (_name, change) => {
    const target = tab();
    const unpin = vi.fn(() => true);
    const close = vi.fn();

    await expect(
      runPinnedCloseTransaction({
        target,
        isEligible,
        runBeforeUnload: async () => {
          Object.assign(target, change);
          return false;
        },
        unpin,
        close,
      }),
    ).resolves.toBe("ineligible");
    expect(unpin).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("never closes when unpinning does not succeed", async () => {
    const close = vi.fn();

    await expect(
      runPinnedCloseTransaction({
        target: tab(),
        isEligible,
        runBeforeUnload: async () => false,
        unpin: () => false,
        close,
      }),
    ).resolves.toBe("unpin-failed");
    expect(close).not.toHaveBeenCalled();
  });
});

describe("closeBrowserPinnedTab", () => {
  it("uses Zen's unpin path before Firefox's normal close path", async () => {
    const target = {
      id: "browser-target",
      pinned: true,
      userContextId: 0,
      lastSeenActive: 0,
      hasAttribute: () => false,
    };
    const runBeforeUnloadForTabs = vi.fn(async () => false);
    const unpinTab = vi.fn(() => {
      target.pinned = false;
    });
    const removeTabs = vi.fn();
    const browser = {
      tabs: [target],
      runBeforeUnloadForTabs,
      unpinTab,
      removeTabs,
    };

    await expect(closeBrowserPinnedTab(target, browser)).resolves.toBe("closed");
    expect(runBeforeUnloadForTabs).toHaveBeenCalledWith([target]);
    expect(unpinTab).toHaveBeenCalledWith(target);
    expect(removeTabs).toHaveBeenCalledWith([target], { skipPermitUnload: true });
    expect(unpinTab.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(
      removeTabs.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("reports unsupported when a browser API is missing", async () => {
    const target = {
      id: "browser-target",
      pinned: true,
      userContextId: 0,
      lastSeenActive: 0,
      hasAttribute: () => false,
    };
    await expect(closeBrowserPinnedTab(target, { tabs: [target] })).resolves.toBe(
      "unsupported",
    );
  });
});

describe("runContextUnpinClose", () => {
  it("passes the captured context tab rather than any selected tab", async () => {
    const contextTarget = { id: "context" };
    const selectedTab = { id: "selected" };
    const close = vi.fn(async () => "closed" as const);

    await expect(runContextUnpinClose(contextTarget, close)).resolves.toBe("closed");
    expect(close).toHaveBeenCalledWith(contextTarget);
    expect(close).not.toHaveBeenCalledWith(selectedTab);
  });

  it("does nothing without a captured context tab", async () => {
    const close = vi.fn(async () => "closed" as const);

    await expect(runContextUnpinClose(null, close)).resolves.toBe("ineligible");
    expect(close).not.toHaveBeenCalled();
  });
});
