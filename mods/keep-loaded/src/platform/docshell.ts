/** Docshell activity, for a tab this mod activated itself. */

/** Read `linkedPanel` first: touching `linkedBrowser` on a lazy tab instantiates it. */
export type DocShellState = "active" | "gone" | "inactive" | "unknown";

/** A cleanup-safe read that distinguishes terminal absence from an unreadable browser. */
export const docShellState = (tab: BrowserTab): DocShellState => {
  try {
    if (!tab.isConnected || !tab.linkedPanel) {
      return "gone";
    }
    const browser = tab.linkedBrowser;
    if (!browser || !("docShellIsActive" in browser)) {
      return "unknown";
    }
    return browser.docShellIsActive === true ? "active" : "inactive";
  } catch {
    // Unreadable but connected: "inactive" would erase the only ownership record.
    return "unknown";
  }
};

export const isDocShellActive = (tab: BrowserTab): boolean =>
  docShellState(tab) === "active";

/** tabbrowser.js 8307: change docshell activity only for mod-activated tabs (D026). */
export const setDocShellActive = (tab: BrowserTab, active: boolean): boolean => {
  const browser = tab.linkedPanel ? tab.linkedBrowser : null;
  if (!browser || !("docShellIsActive" in browser)) {
    return false;
  }
  try {
    const target = active ? "active" : "inactive";
    if (docShellState(tab) === target) {
      return true;
    }
    browser.docShellIsActive = active;
    return docShellState(tab) === target;
  } catch (error) {
    console.error("[keep-loaded] could not change a tab's docshell activity", error);
    return false;
  }
};
