/**
 * What the panel's action button should say and whether it should be clickable. Pure:
 * takes a count and a lock, decides nothing about how to wake anything.
 *
 * The label carries the count rather than reading "Wake tabs", so the button doubles as
 * one more line of the readout: a panel where nothing is asleep says so instead of
 * offering a click that would achieve nothing.
 */

export interface WakeButtonFacts {
  /** Kept tabs, asleep or not. */
  kept: number;
  /** Of those, the ones that are unloaded shells right now. */
  sleeping: number;
  /** A sweep or a crash recovery already holds the wake lock. */
  busy: boolean;
}

export interface ButtonState {
  label: string;
  disabled: boolean;
}

export function wakeButtonState(facts: WakeButtonFacts): ButtonState {
  // The lock outranks the count: the count came from a snapshot the running sweep is
  // busy invalidating, and a second wake would fight it over the on-demand pref.
  if (facts.busy) {
    return { label: "Waking…", disabled: true };
  }
  // An empty allowlist is not the same as a healthy one: "all kept tabs are awake" would
  // be true of nothing at all, which reads as reassurance the mod has not earned.
  if (!facts.kept) {
    return { label: "Nothing to wake", disabled: true };
  }
  if (!facts.sleeping) {
    return { label: "All kept tabs are awake", disabled: true };
  }
  const tabs = facts.sleeping === 1 ? "tab" : "tabs";
  return { label: `Wake ${facts.sleeping} sleeping ${tabs}`, disabled: false };
}
