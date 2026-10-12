/**
 * Firefox 157 (Zen 1.23.2b) `moz-src/browser/components/tabbrowser/Tabbrowser.sys.mjs`
 * 5917–5932 made the duplicate bulk-close helper a true `#removeDuplicateTabs` private
 * method. Its body only calls public members, replayed here: `warnAboutClosingTabs`
 * (5442, bulk-close warning), `removeTabs` (SessionStore and group handling), then
 * the window's `ConfirmationHint` with Firefox's own duplicate-closed string.
 */

export const duplicateCloseSupported = () =>
  typeof gBrowser.warnAboutClosingTabs === "function" &&
  typeof gBrowser.removeTabs === "function" &&
  typeof gBrowser.closingTabsEnum?.DUPLICATES === "number";

export const removeDuplicateTabs = (
  confirmationAnchor: unknown,
  tabs: BrowserTab[],
  closingTabsType: number,
) => {
  if (!tabs.length || !gBrowser.warnAboutClosingTabs?.(tabs.length, closingTabsType)) {
    return;
  }
  gBrowser.removeTabs?.(tabs);
  window.ConfirmationHint?.show(
    confirmationAnchor,
    "confirmation-hint-duplicate-tabs-closed",
    { l10nArgs: { tabCount: tabs.length } },
  );
};
