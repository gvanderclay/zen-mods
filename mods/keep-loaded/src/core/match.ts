/**
 * Allowlist matching. Pure — no browser, no prefs, no globals.
 */

/**
 * Parses the `zen.keep-loaded.match` pref into matchers.
 *
 * Entries are trimmed, lowercased, and blanks dropped, so a trailing comma or a
 * pref edited across multiple lines still yields a usable list.
 */
export function parseMatchList(raw: string): string[] {
  return raw
    .split(",")
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when `url` contains any matcher as a substring.
 *
 * Matchers are expected to come from {@link parseMatchList}, i.e. already
 * lowercased. An empty url never matches: a lazy tab with no recorded url must
 * not be woken by accident.
 */
export function matchesAllowlist(url: string, matchers: readonly string[]): boolean {
  if (!url) {
    return false;
  }
  const haystack = url.toLowerCase();
  return matchers.some(matcher => haystack.includes(matcher));
}
