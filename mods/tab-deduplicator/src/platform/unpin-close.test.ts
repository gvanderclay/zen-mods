import { describe, expect, it, vi } from "vitest";
import { closeBrowserPinnedTab, runPinnedCloseTransaction } from "./unpin-close.ts";

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
  it("confirms, preflights, revalidates, unpins, then closes with unload checks skipped", async () => {
    const target = tab();
    const calls: string[] = [];

    await expect(
      runPinnedCloseTransaction({
        target,
        isEligible: candidate => {
          calls.push("validate");
          return isEligible(candidate);
        },
        confirm: () => {
          calls.push("confirm");
          return true;
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
      "confirm",
      "validate",
      "beforeunload:target",
      "validate",
      "unpin",
      "close:target:true",
    ]);
  });

  it.each([false, null, undefined, -1])(
    "treats a confirmation result of %s as cancellation",
    async confirmation => {
      const beforeUnload = vi.fn(async () => false);
      const unpin = vi.fn(() => true);
      const close = vi.fn();

      await expect(
        runPinnedCloseTransaction({
          target: tab(),
          isEligible,
          confirm: () => confirmation,
          runBeforeUnload: beforeUnload,
          unpin,
          close,
        }),
      ).resolves.toBe("cancelled");
      expect(beforeUnload).not.toHaveBeenCalled();
      expect(unpin).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    },
  );

  it("does nothing when the initial target is not eligible", async () => {
    const target = tab();
    target.pinned = false;
    const confirm = vi.fn(() => true);

    await expect(
      runPinnedCloseTransaction({
        target,
        isEligible,
        confirm,
        runBeforeUnload: async () => false,
        unpin: () => true,
        close: () => {},
      }),
    ).resolves.toBe("ineligible");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("leaves the pin unchanged when beforeunload blocks closing", async () => {
    const target = tab();
    const unpin = vi.fn(() => true);
    const close = vi.fn();

    await expect(
      runPinnedCloseTransaction({
        target,
        isEligible,
        confirm: () => true,
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
        confirm: () => true,
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

  it("revalidates after confirmation in case the context target changed", async () => {
    const target = tab();
    const beforeUnload = vi.fn(async () => false);

    await expect(
      runPinnedCloseTransaction({
        target,
        isEligible,
        confirm: () => {
          target.live = false;
          return true;
        },
        runBeforeUnload: beforeUnload,
        unpin: () => true,
        close: () => {},
      }),
    ).resolves.toBe("ineligible");
    expect(beforeUnload).not.toHaveBeenCalled();
  });

  it("never closes when unpinning does not succeed", async () => {
    const close = vi.fn();

    await expect(
      runPinnedCloseTransaction({
        target: tab(),
        isEligible,
        confirm: () => true,
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

    await expect(closeBrowserPinnedTab(target, () => true, browser)).resolves.toBe(
      "closed",
    );
    expect(runBeforeUnloadForTabs).toHaveBeenCalledWith([target]);
    expect(unpinTab).toHaveBeenCalledWith(target);
    expect(removeTabs).toHaveBeenCalledWith([target], { skipPermitUnload: true });
    expect(unpinTab.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY).toBeLessThan(
      removeTabs.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("reports unsupported without requesting confirmation when a browser API is missing", async () => {
    const target = {
      id: "browser-target",
      pinned: true,
      userContextId: 0,
      lastSeenActive: 0,
      hasAttribute: () => false,
    };
    const confirm = vi.fn(() => true);

    await expect(
      closeBrowserPinnedTab(target, confirm, { tabs: [target] }),
    ).resolves.toBe("unsupported");
    expect(confirm).not.toHaveBeenCalled();
  });
});
