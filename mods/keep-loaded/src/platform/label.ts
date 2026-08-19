/** The tab strip label, and the page-title event that drives it. */

const TITLE_EVENT = "pagetitlechanged";

/** What the page calls itself, or `""` when there is no browser to ask (D028). */
export const pageTitle = (tab: BrowserTab): string => {
  if (!tab.linkedPanel) {
    return "";
  }
  try {
    return tab.linkedBrowser?.contentTitle ?? "";
  } catch {
    return "";
  }
};

/** What the tab strip is showing right now. */
export const tabLabel = (tab: BrowserTab): string => tab.getAttribute("label") ?? "";

/** `_setTabLabel`'s own test (`tabbrowser.js` 2426); an empty static label is not a rename. */
export const isRenamed = (tab: BrowserTab): boolean =>
  typeof tab.zenStaticLabel === "string" && tab.zenStaticLabel !== "";

/** Whether Zen is already letting this tab write its own label (D028). */
export const isLabelManaged = (tab: BrowserTab): boolean =>
  tab._zenContentsVisible === true;

/** tabbrowser.js 2459, ZenUIManager 1617, and SessionStore 5208 justify this flag. */
export const writeLabelFromPage = (tab: BrowserTab): boolean => {
  if (typeof window.gBrowser.setTabTitle !== "function") {
    return false;
  }
  tab._zenChangeLabelFlag = true;
  try {
    return window.gBrowser.setTabTitle(tab) === true;
  } catch (error) {
    console.error("[keep-loaded] could not update a tab's title", error);
    return false;
  } finally {
    delete tab._zenChangeLabelFlag;
  }
};

/** tabbrowser.js 8980 and event forwarding at 548 place this listener after Zen (D006). */
export const observeTitleChanges = (onChanged: (tab: BrowserTab) => void) => {
  const handler = (event: { target?: object }) => {
    const browser = event.target;
    if (!browser) {
      return;
    }
    const tab = window.gBrowser.getTabForBrowser(browser);
    if (tab) {
      onChanged(tab);
    }
  };
  window.gBrowser.addEventListener(TITLE_EVENT, handler);
  return () => window.gBrowser.removeEventListener(TITLE_EVENT, handler);
};
