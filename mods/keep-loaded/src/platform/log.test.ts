import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ debug: false }));

vi.mock("./prefs.ts", () => ({
  preferences: { snapshot: () => ({ debug: state.debug }) },
}));

import { logLazy } from "./log.ts";

describe("lazy debug logging", () => {
  beforeEach(() => {
    state.debug = false;
  });

  it("does not construct diagnostic detail while debug logging is disabled", () => {
    const detail = vi.fn(() => ["summary", ["row"]] as const);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    logLazy(detail);

    expect(detail).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
    output.mockRestore();
  });

  it("constructs and writes diagnostic detail once when debug logging is enabled", () => {
    state.debug = true;
    const detail = vi.fn(() => ["summary", ["row"]] as const);
    const output = vi.spyOn(console, "log").mockImplementation(() => {});

    logLazy(detail);

    expect(detail).toHaveBeenCalledOnce();
    expect(output).toHaveBeenCalledWith("[keep-loaded]", "summary", ["row"]);
    output.mockRestore();
  });
});
