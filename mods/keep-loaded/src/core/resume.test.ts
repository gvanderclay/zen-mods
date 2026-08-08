import { describe, expect, it } from "vitest";
import { type NetworkFacts, networkReady, wakeReason } from "./resume.ts";

const facts = (over: Partial<NetworkFacts> = {}): NetworkFacts => ({
  offline: false,
  linkUp: true,
  portalLocked: false,
  ...over,
});

describe("wakeReason", () => {
  it("acts on the OS resume notification", () => {
    expect(wakeReason("wake_notification", "")).toContain("sleep");
  });

  it("acts on a link that came back, and only on that transition", () => {
    expect(wakeReason("network:link-status-changed", "up")).toContain("link");
    // `up`, `down`, `change` and `unknown` are the four values the service sends;
    // services-sync acts on `up` alone for the same reason.
    for (const data of ["down", "change", "unknown", ""]) {
      expect(wakeReason("network:link-status-changed", data)).toBeNull();
    }
  });

  it("acts on leaving offline mode, not on entering it", () => {
    expect(wakeReason("network:offline-status-changed", "online")).toContain("online");
    expect(wakeReason("network:offline-status-changed", "offline")).toBeNull();
  });

  it("ignores a topic it never asked for", () => {
    // The observer is registered per topic, so this is belt and braces — but a
    // sweep triggered by an unrelated notification would be very hard to explain.
    expect(wakeReason("sleep_notification", "")).toBeNull();
    expect(wakeReason("quit-application", "")).toBeNull();
  });
});

describe("networkReady", () => {
  it("is ready when nothing says otherwise", () => {
    expect(networkReady(facts()).ready).toBe(true);
  });

  it("waits while the link is down, naming it", () => {
    const verdict = networkReady(facts({ linkUp: false }));
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toContain("link");
  });

  it("waits while the browser is in offline mode", () => {
    const verdict = networkReady(facts({ offline: true }));
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toContain("offline");
  });

  it("waits behind a captive portal, which would restore a login page", () => {
    const verdict = networkReady(facts({ portalLocked: true }));
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toContain("portal");
  });

  it("goes ahead when the link status is unknown, because unknown is not down", () => {
    // `linkStatusKnown` is false on some setups (VMs, bug 1420802). Treating that as
    // down would mean never re-waking on those machines at all.
    expect(networkReady(facts({ linkUp: null })).ready).toBe(true);
  });
});
