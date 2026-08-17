/**
 * Verified in Zen 1.21.14b's shipped `browser/omni.ja`:
 *
 * - `tabbrowser/tabbrowser.js` 7023–7057 moves a tab through
 *   `replaceTabWithWindow` and marks the new window synced when `zenForceSync` is true.
 * - `modules/zen/ZenWindowSync.sys.mjs` 227–234 consumes that startup sync flag.
 */

export const popOutSelectedTab = (): void => {
  const selectedTab = gBrowser.selectedTab;
  if (!selectedTab) {
    return;
  }
  gBrowser.replaceTabWithWindow(selectedTab, {}, true);
};
