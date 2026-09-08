/**
 * Verified in Zen 1.22b's shipped `omni.ja` and `browser/omni.ja`:
 *
 * - `moz-src/browser/components/sharing/SharingUtils.sys.mjs` 204–223 returns live
 *   `{ url, title }` links in the browser-owned tab order after applying
 *   `BrowserUtils.getShareableURL`. Firefox imports it through
 *   `moz-src:///browser/components/sharing/SharingUtils.sys.mjs`; the former
 *   `resource:///modules/SharingUtils.sys.mjs` path no longer exists.
 * - `downloads/allDownloadsView.js` copies multiple selected URLs as one
 *   newline-joined string through `nsIClipboardHelper.copyString`.
 */

import type { ShareableLink } from "../core/links.ts";

const { SharingUtils } = ChromeUtils.importESModule(
  "moz-src:///browser/components/sharing/SharingUtils.sys.mjs",
);
const clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(
  Ci.nsIClipboardHelper,
);

export const getLinksToShare = (shareMenu: Element): readonly ShareableLink[] =>
  SharingUtils.getLinksToShare(shareMenu);

export const copyPlainText = (text: string): void => {
  clipboardHelper.copyString(text);
};
