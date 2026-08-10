import { afterEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_COORDINATOR_PROTOCOL } from "../application-coordinator.ts";

const moduleFacade = (protocol: number) => ({
  applicationId: "application-test",
  protocol,
  register: vi.fn(),
  snapshot: vi.fn(),
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("application owner import", () => {
  it("accepts the stable system-module URI only when its protocol matches", async () => {
    const importESModule = vi
      .fn()
      .mockReturnValue(moduleFacade(APPLICATION_COORDINATOR_PROTOCOL));
    vi.stubGlobal("ChromeUtils", { importESModule });

    const application = await import("./application.ts");

    expect(importESModule).toHaveBeenCalledWith(
      "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs",
    );
    expect(application.applicationId).toBe("application-test");
  });

  it("fails closed when Zen still caches an incompatible owner", async () => {
    vi.stubGlobal("ChromeUtils", {
      importESModule: vi.fn().mockReturnValue(moduleFacade(0)),
    });

    await expect(import("./application.ts")).rejects.toThrow(
      `application owner protocol 0 is cached; protocol ${APPLICATION_COORDINATOR_PROTOCOL} requires restarting Zen`,
    );
  });
});
