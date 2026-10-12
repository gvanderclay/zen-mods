import { afterEach, describe, expect, it, vi } from "vitest";
import { duplicateCloseSupported, removeDuplicateTabs } from "./native-close.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubBrowser = (warnResult: boolean) => {
  const browser = {
    warnAboutClosingTabs: vi.fn(() => warnResult),
    removeTabs: vi.fn(),
    closingTabsEnum: { DUPLICATES: 6 },
  };
  const show = vi.fn();
  vi.stubGlobal("gBrowser", browser);
  vi.stubGlobal("window", { ConfirmationHint: { show } });
  return { browser, show };
};

describe("native duplicate close", () => {
  it("is supported only through Firefox's public close members", () => {
    stubBrowser(true);
    expect(duplicateCloseSupported()).toBe(true);
    vi.stubGlobal("gBrowser", {
      removeTabs: vi.fn(),
      closingTabsEnum: { DUPLICATES: 6 },
    });
    expect(duplicateCloseSupported()).toBe(false);
  });

  it("warns, closes, then confirms with Firefox's duplicate string", () => {
    const { browser, show } = stubBrowser(true);
    const tabs = [{}, {}] as BrowserTab[];
    const anchor = {};
    removeDuplicateTabs(anchor, tabs, 6);
    expect(browser.warnAboutClosingTabs).toHaveBeenCalledWith(2, 6);
    expect(browser.removeTabs).toHaveBeenCalledWith(tabs);
    expect(show).toHaveBeenCalledWith(anchor, "confirmation-hint-duplicate-tabs-closed", {
      l10nArgs: { tabCount: 2 },
    });
  });

  it("closes nothing when the warning is cancelled or there are no tabs", () => {
    const { browser, show } = stubBrowser(false);
    removeDuplicateTabs({}, [{}] as BrowserTab[], 6);
    removeDuplicateTabs({}, [], 6);
    expect(browser.warnAboutClosingTabs).toHaveBeenCalledOnce();
    expect(browser.removeTabs).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });
});
