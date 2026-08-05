/**
 * Defaults shared by the runtime fallbacks in `platform/prefs.ts` and the rows
 * Sine renders from `preferences.json`.
 *
 * They have to agree. Sine's `applyString` writes a string pref's `defaultValue`
 * into the profile the first time the settings dialog renders, so a drifting
 * default changes behaviour just by opening settings — see D010.
 */

export const DEFAULT_MATCH = "mail.google.com,calendar.google.com,slack.com";

/** Must stay `true`: Sine's checkbox only ever seeds a *checked* box. */
export const DEFAULT_DEBUG = true;

/** Same constraint. The mod does nothing useful with this off — see D012. */
export const DEFAULT_LAZY_PINNED = true;

/**
 * Both crash-budget settings are strings because Sine has no number row, so they are
 * text fields the mod parses itself (`parseAttempts`, `parseWindowMs`). Each must
 * parse cleanly, since those parses fall back to it.
 */
export const DEFAULT_CRASH_ATTEMPTS = "3";

/** Minutes. Must parse to a *positive* number — a window of zero disables the budget. */
export const DEFAULT_CRASH_WINDOW = "60";
