/**
 * Reconciles this mod's own "load pinned tabs lazily" setting with the global
 * Firefox pref that actually does it. Pure — the write happens in `platform`.
 *
 * The mod is useless without lazy pinned tabs, so it owns that pref rather than
 * asking the user to set it in a profile file. Owning a global pref means never
 * writing it needlessly and always saying so — see D012.
 */

export interface LazyPinnedPlan {
  /** The value to write, or `null` to leave the pref untouched. */
  set: boolean | null;
  /** Empty exactly when nothing is written. */
  message: string;
}

/**
 * @param intent what the mod's own setting asks for
 * @param current what the global pref holds right now
 */
export function planLazyPinned(intent: boolean, current: boolean): LazyPinnedPlan {
  if (intent === current) {
    return { set: null, message: "" };
  }
  // Zen reads the pref while restoring the session, so the write lands now but is
  // consumed at the next launch. Say that rather than imply an instant effect.
  return {
    set: intent,
    message: intent
      ? "pinned tabs will load lazily from the next start"
      : "setting is off — pinned tabs will load eagerly from the next start",
  };
}
