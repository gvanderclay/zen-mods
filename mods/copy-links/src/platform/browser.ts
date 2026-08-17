/**
 * Verified in Zen 1.21.14b's shipped `browser/omni.ja`:
 *
 * - `SharingUtils.sys.mjs` 180–208 returns live `{ url, title }` links in the
 *   browser-owned tab order after applying `BrowserUtils.getShareableURL`.
 * - `downloads/allDownloadsView.js` 631–639 copies multiple selected URLs as one
 *   newline-joined string through `nsIClipboardHelper.copyString`.
 */

import type { ShareableLink } from "../core/links.ts";

const { SharingUtils } = ChromeUtils.importESModule(
  "resource:///modules/SharingUtils.sys.mjs",
);
const clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(
  Ci.nsIClipboardHelper,
);

export const getLinksToShare = (shareMenu: Element): readonly ShareableLink[] =>
  SharingUtils.getLinksToShare(shareMenu);

export const copyPlainText = (text: string): void => {
  clipboardHelper.copyString(text);
};
