# Copy Links

A manual [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that adds **Copy Link** or **Copy N Links**
directly to the tab context menu.

## Behavior

Right-click one tab or a multiselection and choose **Copy Link(s)**. The mod uses
Firefox's current Share context, so it preserves selected-tab order and excludes URLs
Firefox does not consider shareable. It writes only the URLs as plain text, one per
line, without the HTML and Firefox-specific URL formats used by the built-in Share
command.

The browser-owned **Share** submenu remains unchanged. Sidebar Context Menu Customizer
discovers this action like any other mod-added menu item; there is no Copy Link-specific
promotion setting.

## Compatibility

The browser boundary was extracted from Zen `1.21.14b`, build `20260811103047`, source
`f4890c17420a3f7879e72b64a09b180028eba1cf`, and Firefox/Gecko `153.0.4`.

The mod relies on Firefox's tab-menu Share insertion, `SharingUtils.getLinksToShare`,
XUL menu localization, and `nsIClipboardHelper.copyString`. These are private APIs and
may require an update after Zen or Firefox changes them.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/copy-links

## Development

Run from the repository root:

    pnpm --filter @zen-mods/copy-links check
    pnpm --filter @zen-mods/copy-links test:live-xul

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
