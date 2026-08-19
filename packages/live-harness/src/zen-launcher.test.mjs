import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createZenArguments,
  installShutdownSignals,
  LIFECYCLE_FIXTURE_PATHS,
} from "./zen-launcher.mjs";

describe("live Zen staged mod boundary", () => {
  it("exposes the exact synthetic lifecycle fixture files", async () => {
    expect(Object.keys(LIFECYCLE_FIXTURE_PATHS)).toEqual(["carrier", "window"]);
    await expect(
      Promise.all(Object.values(LIFECYCLE_FIXTURE_PATHS).map(path => access(path))),
    ).resolves.toEqual([undefined, undefined]);
  });
});

describe("live Zen process ownership", () => {
  it("builds exact headless and headed argument lists", () => {
    expect(createZenArguments({ headless: true, profile: "/tmp/profile" })).toEqual([
      "--headless",
      "--no-remote",
      "--marionette",
      "--remote-allow-system-access",
      "--profile",
      "/tmp/profile",
      "about:blank",
    ]);
    expect(createZenArguments({ headless: false, profile: "/tmp/profile" })).toEqual([
      "-foreground",
      "--no-remote",
      "--marionette",
      "--remote-allow-system-access",
      "--profile",
      "/tmp/profile",
      "about:blank",
    ]);
  });

  it("keeps signal handlers installed until one idempotent shutdown finishes", async () => {
    const emitter = new EventEmitter();
    let finishShutdown;
    const shutdown = new Promise(resolve => {
      finishShutdown = resolve;
    });
    let shutdownCalls = 0;
    const exits = [];
    const remove = installShutdownSignals({
      emitter,
      exit: code => exits.push(code),
      label: "test probe",
      shutdown: () => {
        shutdownCalls += 1;
        return shutdown;
      },
    });

    emitter.emit("SIGINT");
    emitter.emit("SIGTERM");
    expect(shutdownCalls).toBe(1);
    expect(exits).toEqual([]);
    finishShutdown();
    await Promise.resolve();
    await Promise.resolve();
    expect(exits).toEqual([130]);

    remove();
    expect(emitter.listenerCount("SIGINT")).toBe(0);
    expect(emitter.listenerCount("SIGTERM")).toBe(0);
  });
});
