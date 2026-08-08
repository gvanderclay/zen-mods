export type PinnedCloseTransactionResult =
  | "closed"
  | "ineligible"
  | "cancelled"
  | "unload-blocked"
  | "unpin-failed";

interface PinnedCloseTransaction<Target> {
  target: Target;
  isEligible(target: Target): boolean;
  confirm(target: Target): unknown | Promise<unknown>;
  runBeforeUnload(targets: [Target]): Promise<boolean>;
  unpin(target: Target): boolean;
  close(target: Target, options: { skipPermitUnload: true }): void;
}

export const runPinnedCloseTransaction = async <Target>({
  target,
  isEligible,
  confirm,
  runBeforeUnload,
  unpin,
  close,
}: PinnedCloseTransaction<Target>): Promise<PinnedCloseTransactionResult> => {
  if (!isEligible(target)) {
    return "ineligible";
  }
  if ((await confirm(target)) !== true) {
    return "cancelled";
  }
  if (!isEligible(target)) {
    return "ineligible";
  }
  if (await runBeforeUnload([target])) {
    return "unload-blocked";
  }
  if (!isEligible(target)) {
    return "ineligible";
  }
  if (!unpin(target)) {
    return "unpin-failed";
  }
  close(target, { skipPermitUnload: true });
  return "closed";
};

type BrowserPinnedCloseResult = PinnedCloseTransactionResult | "unsupported";

/**
 * Verified in Zen's shipped `tabbrowser.js`:
 *
 * - Lines 1217–1243 route unpinning through Zen's folder state before clearing the
 *   pinned marker.
 * - Lines 5572–5615 define `runBeforeUnloadForTabs`; `true` means the user blocked
 *   closing.
 * - Lines 5657–5693 require `skipPermitUnload` only after that preflight, while the
 *   remaining `removeTabs` path retains SessionStore and group handling.
 */
export const closeBrowserPinnedTab = async (
  target: BrowserTab,
  confirm: (target: BrowserTab) => unknown | Promise<unknown>,
  browser: TabBrowser = gBrowser,
): Promise<BrowserPinnedCloseResult> => {
  const runBeforeUnload = browser.runBeforeUnloadForTabs;
  const unpin = browser.unpinTab;
  const close = browser.removeTabs;
  if (!runBeforeUnload || !unpin || !close) {
    return "unsupported";
  }

  const isEligible = (tab: BrowserTab) =>
    browser.tabs.includes(tab) &&
    tab.pinned &&
    tab.closing !== true &&
    !tab.hasAttribute("zen-essential");

  return runPinnedCloseTransaction({
    target,
    isEligible,
    confirm,
    runBeforeUnload: tabs => runBeforeUnload.call(browser, tabs),
    unpin: tab => {
      unpin.call(browser, tab);
      return browser.tabs.includes(tab) && !tab.pinned;
    },
    close: (tab, options) => close.call(browser, [tab], options),
  });
};
