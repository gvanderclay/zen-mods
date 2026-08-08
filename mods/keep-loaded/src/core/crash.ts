/**
 * Reading a crashed kept tab. Reports; recovers nothing — see D017.
 *
 * The two crash events are not the same failure. `oop-browser-crashed` is a
 * content process that died and can be brought back. `oop-browser-buildid-mismatch`
 * is Zen having been updated on disk while running: a new-build child aborts
 * against the old-build parent, so every retry mismatches identically. Firefox
 * treats it separately too — `willShowCrashedTab` routes it to a restart-required
 * page rather than the crash page (`ContentCrashHandlers.sys.mjs` 507-511).
 */

export type CrashKind = "crashed" | "restart-required";

/** What the tab looked like when the crash was noticed. */
export interface CrashFacts {
  url: string;
  kind: CrashKind;
  /** Carrying `pending`, i.e. SessionStore has it queued but unrestored. */
  pending: boolean;
  /** `browser.isRemoteBrowser`. False right after a crash, which blocks a discard. */
  remote: boolean;
  connected: boolean;
  /**
   * The `crashed` attribute, set only by the two methods that display a crash page
   * (`ContentCrashHandlers.sys.mjs` 530, 554). A background crash should leave it
   * unset, so seeing it means the crash was not handled the way we assume.
   */
  crashedPage: boolean;
}

export interface CrashDiagnosis {
  message: string;
  lines: string[];
  /** False only when no amount of re-waking could work. */
  recoverable: boolean;
}

const MISMATCH =
  "content process aborted on a build-id mismatch — Zen was updated in place, so restart Zen to bring this tab back";

export function crashDiagnosis(facts: CrashFacts): CrashDiagnosis {
  const restartRequired = facts.kind === "restart-required";
  const subject = facts.url || "a kept tab";

  const state = [
    facts.pending ? "pending" : "not pending",
    facts.remote ? "remote" : "non-remote",
    facts.connected ? "browser connected" : "browser detached",
  ].join(", ");

  return {
    message: `${subject}: ${restartRequired ? MISMATCH : "content process crashed"}`,
    recoverable: !restartRequired,
    lines: [
      `state: ${state}`,
      facts.crashedPage
        ? "crash page: shown, so this was not handled as a background crash"
        : "crash page: not shown",
      `recovery: ${recoveryNote(restartRequired, facts.remote)}`,
    ],
  };
}

/**
 * `_mayDiscardBrowser` rejects a non-remote browser outright (`tabbrowser.js`
 * 3155), and the crash path deliberately makes the browser non-remote before
 * reviving it — so the obvious "discard back to lazy, then wake as at startup"
 * route is unavailable until something flips remoteness back.
 */
const recoveryNote = (restartRequired: boolean, remote: boolean) => {
  if (restartRequired) {
    return "not possible until Zen restarts";
  }
  return remote
    ? "discard is available"
    : "discard is blocked by _mayDiscardBrowser while non-remote, so it needs a remoteness flip first";
};
