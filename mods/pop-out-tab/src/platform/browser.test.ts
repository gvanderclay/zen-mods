import { afterEach, describe, expect, it, vi } from "vitest";
import { popOutSelectedTab } from "./browser.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("popOutSelectedTab", () => {
  it("moves the active tab through Zen's forced-synced native path", () => {
    const selectedTab = { id: "selected" };
    const replaceTabWithWindow = vi.fn();
    vi.stubGlobal("gBrowser", { selectedTab, replaceTabWithWindow });

    popOutSelectedTab();

    expect(replaceTabWithWindow).toHaveBeenCalledWith(selectedTab, {}, true);
  });

  it("does nothing when no tab is selected", () => {
    const replaceTabWithWindow = vi.fn();
    vi.stubGlobal("gBrowser", { selectedTab: null, replaceTabWithWindow });

    popOutSelectedTab();

    expect(replaceTabWithWindow).not.toHaveBeenCalled();
  });
});
