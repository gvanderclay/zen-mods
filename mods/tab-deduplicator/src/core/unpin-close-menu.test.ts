import { describe, expect, it } from "vitest";
import { unpinCloseMenuState } from "./unpin-close-menu.ts";

const facts = (overrides: Partial<Parameters<typeof unpinCloseMenuState>[0]> = {}) => ({
  supported: true,
  hasContextTab: true,
  live: true,
  pinned: true,
  essential: false,
  multiselected: false,
  ...overrides,
});

describe("unpinCloseMenuState", () => {
  it("shows the action only for one live pinned non-essential context tab", () => {
    expect(unpinCloseMenuState(facts())).toEqual({
      label: "Unpin and close pinned tab…",
      hidden: false,
      disabled: false,
    });
  });

  it.each([
    ["unsupported", { supported: false }],
    ["missing context", { hasContextTab: false }],
    ["stale context", { live: false }],
    ["ordinary tab", { pinned: false }],
    ["essential", { essential: true }],
    ["multiselection", { multiselected: true }],
  ])("hides the action for %s", (_name, overrides) => {
    expect(unpinCloseMenuState(facts(overrides))).toEqual({
      label: "Unpin and close pinned tab…",
      hidden: true,
      disabled: true,
    });
  });
});
