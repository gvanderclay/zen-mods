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

/**
 * Seconds between runs of a kept tab's page, so its title keeps up while the tab is
 * unselected (D027). Off by default, because a run costs real painting — and a string
 * rather than a checkbox for exactly that reason: `applyCheckbox` writes a row's default
 * only when it is truthy, so a checkbox defaulting to `false` is never seeded and the
 * two defaults would silently disagree (D010). `0` is the documented off switch, the
 * same shape `DEFAULT_CRASH_ATTEMPTS` uses.
 */
export const DEFAULT_FRESHEN_SECONDS = "0";

/** Seconds one run lasts. Must parse to a *positive* number, or nothing runs at all. */
export const DEFAULT_FRESHEN_HOLD_SECONDS = "5";
