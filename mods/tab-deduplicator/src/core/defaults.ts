/** Shared by Sine's preference row and the privileged runtime fallback. */
export const PREF_INCLUDE_PINNED = "zen.tab-deduplicator.include-pinned";

/**
 * Sine does not seed a checkbox whose default is false. Keeping the same explicit
 * fallback in the runtime makes an absent preference mean off without profile writes.
 */
export const DEFAULT_INCLUDE_PINNED = false;
