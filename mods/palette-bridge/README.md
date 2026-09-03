# Palette Bridge

A [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that applies browser-chrome colors from one
external semantic palette file. Replace the file and the open Zen window updates in
about one second.

Palette Bridge changes Zen's tabs, sidebar, toolbar, URL bar, panels, and browser
background. It does not change the installed Firefox theme or style websites.

## Install

You need Zen Browser and Sine. In Sine's settings, enable **Install JS from unofficial
sources**, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/palette-bridge

Create the palette file at:

    <Zen profile>/chrome/palette-bridge.json

`<Zen profile>` is the active profile directory, not the Zen application directory.
Palette Bridge resolves it through Firefox's profile service, so the default contains no
machine-specific absolute path.

## Palette format

[`palette.schema.json`](palette.schema.json) is the authoritative JSON Schema draft
2020-12 contract. Version 1 accepts exactly one flat object. All listed fields are
required except `displayName`; unknown fields are rejected.

    {
      "schemaVersion": 1,
      "displayName": "High contrast light",
      "mode": "light",
      "accent": "#335577",
      "mainBackground": "#f0f2f5",
      "secondarySurface": "#ffffff",
      "selectionSurface": "#dbe7f3",
      "border": "#8a96a3",
      "normalForeground": "#18212b",
      "mutedForeground": "#5d6873",
      "strongForeground": "#000000"
    }

| Field | Meaning |
|---|---|
| `schemaVersion` | Must be the number `1` |
| `displayName` | Optional name used in a successful-update log |
| `mode` | `dark` or `light`; controls the browser-chrome color scheme |
| `accent` | Accent used by active Zen chrome |
| `mainBackground` | Main browser and toolbar background |
| `secondarySurface` | URL bar, panel, dialog, input, and secondary background |
| `selectionSurface` | Selected and hovered surface |
| `border` | Borders, separators, and contrasting edges |
| `normalForeground` | Normal labels, icons, and controls |
| `mutedForeground` | Inactive or less prominent text |
| `strongForeground` | Highest-emphasis foreground |

Every color must use lowercase six-digit hexadecimal form: `#rrggbb`. Short hex,
uppercase hex, alpha channels, CSS color names, and other CSS color syntax are invalid.
Do not add a `$schema` property to the palette document; version 1 rejects fields that
are not listed above. Configure the schema in the producing tool or editor instead.

`mode` is explicit. Palette Bridge does not derive colors or choose between two
palettes from the operating-system appearance. A producer that follows system light and
dark mode should replace the complete document, including `mode` and all eight colors,
when the system appearance changes.

## Optional path

The Sine setting **Palette file path** writes this Firefox preference:

    zen.palette-bridge.path

Its default is an empty string, which selects the profile-owned default above. A
non-empty value is used as an exact filesystem path. It must be a path Zen can read;
shell forms such as `~` and environment variables are not expanded. Changing the
setting starts an immediate read without waiting for the next poll.

## Updates and errors

Each ordinary browser window reads once at startup, then schedules one read 1000
milliseconds after the previous read finishes. Reads never overlap. A valid, changed
palette is applied as one complete update. Replacing the file atomically is recommended:
write a temporary file in the same directory, then rename it over the public path.

If a file is missing, malformed, incomplete, or invalid, the last valid palette stays
applied. Before the first valid palette, Zen stays native. The same read or validation
error is logged once per window until a successful read or a different error occurs.

Zen can rewrite its workspace gradient and window scheme while running. Palette Bridge
reapplies the last valid palette after those native updates. When the mod unloads, it
restores the latest native or third-party values it observed. A newer value written
after Palette Bridge's last application is left alone.

Private windows and Zen isolated/unsynced windows keep their native treatment. They do
not read the file, poll, or apply palette values.

## Producer contract

A palette producer needs only the following information:

- Write the exact version 1 object documented above.
- Supply all eight colors and `mode` together; only `displayName` is optional.
- Use lowercase `#rrggbb` colors and no unknown fields.
- Atomically replace `<Zen profile>/chrome/palette-bridge.json`; or write another file
  and set `zen.palette-bridge.path` to its exact absolute path.
- Keep the public path stable. The mod notices valid replacements without a shell
  command, browser restart, workspace-state write, or producer-specific integration.

A producer may link the default path to a stable generated file. Replacing that file or
retargeting the link is noticed on a later read as long as the default path remains
readable. A producer that does not use the default path should set
`zen.palette-bridge.path`. Palette Bridge reads JSON only; it never runs the producer
or any shell command.

## Compatibility

The shipped bundle and its private Zen boundaries were verified against:

- Zen `1.21.16b`, build `20260828113729`;
- Zen source `f4d9821fd777663660b099127b4f2d8399c7fd2c`;
- Firefox/Gecko `154.0.1`;
- Sine `2.3.3.0`.

The implementation relies on private Zen elements, CSS properties, and the
`zen-space-gradient-update` and `zen-theme-change` observer topics. These may require a
compatibility update after Zen changes them.

Installed-source evidence:

- `modules/zen/ZenGradientGenerator.mjs:60-66,1730-1798` owns the background
  elements, native writes, and update topic.
- `modules/zen/ZenSpace.mjs:392-407` owns workspace-local colors.
- `chrome/browser/content/browser/zen-styles/zen-theme.css:11-250` defines the mapped
  properties and native private/unsynced treatment.

## Non-goals

- Website or content-page theming
- JSWindowActors
- Zen Boosts
- Wallpaper management
- Writing Zen workspace state or scheme preferences
- Changing the installed Firefox theme
- Running shell commands or knowing which program produces the palette
- Generating colors, deriving contrast, or accepting additional CSS color formats

## Manual validation

1. Put the complete example at the default path and enable Palette Bridge in Sine.
2. Confirm the sidebar, selected tab, toolbar, URL bar, and panels are readable.
3. Atomically replace `accent` with another valid lowercase color and confirm the
   browser chrome changes in about one second.
4. Replace the file with invalid or partial JSON and confirm the previous palette stays.
5. Restore a valid file, change workspace or system appearance, and confirm the palette
   returns after Zen updates its native gradient.
6. Open a private window and an isolated/unsynced window and confirm both remain native.
7. Disable Palette Bridge and confirm the current native Zen appearance returns.

## Development

Run from the repository root:

    pnpm --filter @zen-mods/palette-bridge check
    pnpm --filter @zen-mods/palette-bridge test:live-xul
    pnpm --filter @zen-mods/palette-bridge preview:live-xul

The live test builds and stages the production mod in a fresh throwaway profile. It
does not modify the normal Zen profile. The committed `dist/` file is generated; edit
`src/`, never `dist/` directly.
