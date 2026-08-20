/** The wake transaction's tab adapter, and the one unload a recovery owns. */

import type { WakeCandidate, WorkContext } from "./application-protocol.ts";
import type { KeepLoadedController, OperationToken } from "./controller.ts";
import {
  insertBrowser,
  rollbackWakeCandidate,
  wakeCandidateState,
} from "./platform/browser.ts";

export const WAKE_TIMEOUT_MS = 20000;
export const POLL_MS = 100;

interface RecoveryUnloadExpectation {
  readonly tab: BrowserTab;
  readonly token: OperationToken;
}

export type WindowWake = ReturnType<typeof createWindowWake>;

export const createWindowWake = (controller: KeepLoadedController) => {
  /** The one synchronous `TabBrowserDiscarded` a recovery owns; the token scopes it. */
  let expectedRecoveryUnload: RecoveryUnloadExpectation | null = null;

  const withExpectedRecoveryUnload = <T>(
    tab: BrowserTab,
    token: OperationToken,
    action: () => T,
  ): T => {
    const previous = expectedRecoveryUnload;
    const current = Object.freeze({ tab, token });
    expectedRecoveryUnload = current;
    try {
      return action();
    } finally {
      if (expectedRecoveryUnload === current) {
        expectedRecoveryUnload = previous;
      }
    }
  };

  const isExpectedRecoveryUnload = (tab: BrowserTab): boolean => {
    const expected = expectedRecoveryUnload;
    return (
      expected !== null &&
      expected.tab === tab &&
      controller.isCurrentOperation(expected.token)
    );
  };

  // restoreTab's queue refuses pinned tabs while restore_pinned_tabs_on_demand is on.
  const wakeAll = async (
    tabs: BrowserTab[],
    token: OperationToken,
    context: WorkContext,
  ) => {
    if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
      return "canceled" as const;
    }
    const candidates: WakeCandidate[] = tabs.map(tab =>
      Object.freeze({
        key: tab,
        insert: () => insertBrowser(tab),
        rollback: () =>
          withExpectedRecoveryUnload(tab, token, () => rollbackWakeCandidate(tab)),
        state: () => wakeCandidateState(tab),
      }),
    );
    return context.wakeCandidates(candidates, {
      pollMs: POLL_MS,
      retryLimit: 1,
      timeoutMs: WAKE_TIMEOUT_MS,
    });
  };

  return { isExpectedRecoveryUnload, wakeAll, withExpectedRecoveryUnload };
};
