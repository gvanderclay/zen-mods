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

The browser boundary was verified against Zen `1.22b`, build `20260904060728`, source
`c2a638b7f735c7e7d4ee22e0182c8f6a16da93e5`, and Firefox/Gecko `155.0.1`.

The mod relies on Firefox's tab-menu Share insertion, `SharingUtils.getLinksToShare`
from `moz-src:///browser/components/sharing/SharingUtils.sys.mjs`, XUL menu
localization, and `nsIClipboardHelper.copyString`. These are private APIs and can
require an update after Zen or Firefox changes them. Zen `1.22b` moved `SharingUtils`
from `resource:///modules/` to `moz-src:///`, and Firefox 155 added a tab-menu layout
pass that rejects unknown items placed before its last declared item. The action
therefore rests at the end of the menu while the menu is closed and moves after Share
while the menu is open.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/copy-links

## Development

Run from the repository root:

    pnpm --filter @zen-mods/copy-links check
    pnpm --filter @zen-mods/copy-links test:live-xul

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
