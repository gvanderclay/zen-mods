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
