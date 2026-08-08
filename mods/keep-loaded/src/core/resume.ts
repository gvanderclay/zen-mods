/**
 * Whether a system notification is worth re-sweeping for, and whether the network
 * is in a state where waking a tab would load the page rather than an error. Pure:
 * the readings come from `platform/system.ts` — see D019.
 */

/** The topics `platform/system.ts` observes. Each is handled by `wakeReason`. */
export const WAKE_TOPICS = [
  "wake_notification",
  "network:link-status-changed",
  "network:offline-status-changed",
] as const;

/**
 * Why this notification deserves a sweep, or null to ignore it. Only transitions
 * *towards* working are acted on: the mod has nothing useful to do when a machine
 * goes to sleep or a link drops, and a sweep then would wake tabs into error pages.
 */
export function wakeReason(topic: string, data: string): string | null {
  switch (topic) {
    case "wake_notification":
      return "woke from sleep";
    // Four possible values — `up`, `down`, `change`, `unknown`. services-sync acts
    // on `up` alone (policies.sys.mjs 318), and for the same reason: the others say
    // something happened, not that there is a network.
    case "network:link-status-changed":
      return data === "up" ? "network link came back" : null;
    case "network:offline-status-changed":
      return data === "online" ? "back online" : null;
    default:
      return null;
  }
}

/** What the network looks like, read from the three services Firefox itself consults. */
export interface NetworkFacts {
  /** `Services.io.offline` — offline mode, which is usually the user's own doing. */
  offline: boolean;
  /** `null` when `linkStatusKnown` is false, which is not the same as down. */
  linkUp: boolean | null;
  /** Connected to something that intercepts every request until you log in. */
  portalLocked: boolean;
}

export interface NetworkVerdict {
  ready: boolean;
  reason: string;
}

/**
 * Mirrors `IPPNetworkUtils.isOffline` — offline mode, a locked captive portal, or a
 * link that is known to be down. A resume fires before Wi-Fi has associated, so
 * without this the sweep would restore kept tabs into network error pages; skipping
 * costs nothing, because the link coming up is itself one of the trigger topics.
 */
export function networkReady(facts: NetworkFacts): NetworkVerdict {
  if (facts.offline) {
    return { ready: false, reason: "the browser is in offline mode" };
  }
  if (facts.portalLocked) {
    return { ready: false, reason: "a captive portal is holding the connection" };
  }
  if (facts.linkUp === false) {
    return { ready: false, reason: "the network link is down" };
  }
  return { ready: true, reason: "the network looks usable" };
}
