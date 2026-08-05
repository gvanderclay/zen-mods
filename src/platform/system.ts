/**
 * System notifications, and the network readings the resume policy is judged on.
 * Privileged: touches `Services.obs`, `Services.io` and two XPCOM services.
 */

import type { NetworkFacts } from "../core/resume.ts";

/**
 * Returns the disposer. Sine re-imports this module on every reload, so an observer
 * left behind would sweep twice per resume — and keep sweeping after the mod is
 * gone, since `Services.obs` outlives the window (D006).
 */
export const observeTopic = (topic: string, onNotify: (data: string) => void) => {
  const observer: XpcomObserver = { observe: (_subject, _topic, data) => onNotify(data) };
  Services.obs.addObserver(observer, topic);
  return () => Services.obs.removeObserver(observer, topic);
};

const getService = <T>(contract: string, iface: unknown): T | null => {
  try {
    return Cc[contract]?.getService<T>(iface) ?? null;
  } catch {
    return null;
  }
};

const LINK = "@mozilla.org/network/network-link-service;1";
const PORTAL = "@mozilla.org/network/captive-portal-service;1";

/**
 * The three readings `IPPNetworkUtils.isOffline` consults. Every failure resolves to
 * "no objection" rather than to offline: these readings can only ever hold a sweep
 * back, so a service that has gone away must not be able to stop recovery for good.
 */
export const networkFacts = (): NetworkFacts => {
  const facts: NetworkFacts = { offline: false, linkUp: null, portalLocked: false };
  try {
    facts.offline = Services.io.offline;
    const link = getService<NetworkLinkService>(LINK, Ci.nsINetworkLinkService);
    // Unknown is not down (`ext-networkStatus.js` 33): on the setups where the
    // service cannot tell, claiming down would block every re-wake there is.
    facts.linkUp = link?.linkStatusKnown ? link.isLinkUp : null;
    const portal = getService<CaptivePortalService>(PORTAL, Ci.nsICaptivePortalService);
    facts.portalLocked = portal ? portal.state === portal.LOCKED_PORTAL : false;
  } catch (error) {
    // Ungated: a reading this mod acts on going missing is worth seeing, and the
    // fallback is deliberately permissive, so the failure is otherwise invisible.
    console.error("[keep-loaded] could not read the network state", error);
  }
  return facts;
};
