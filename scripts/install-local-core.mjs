import { isAbsolute, resolve } from "node:path";

const sectionsFromIni = contents => {
  const sections = [];
  let current;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    const heading = /^\[([^\]]+)]$/.exec(line);
    if (heading?.[1]) {
      current = { name: heading[1], values: {} };
      sections.push(current);
      continue;
    }

    const separator = line.indexOf("=");
    if (current && separator > 0) {
      current.values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }

  return sections;
};

export const profilePathFromIni = (contents, zenRoot) => {
  const defaults = sectionsFromIni(contents).filter(
    section => section.name.startsWith("Profile") && section.values.Default === "1",
  );
  if (defaults.length !== 1) {
    throw new Error("profiles.ini must declare exactly one default profile");
  }

  const profile = defaults[0];
  const profilePath = profile?.values.Path;
  if (!profilePath) {
    throw new Error("the default profile in profiles.ini has no Path");
  }

  if (profile.values.IsRelative === "0" || isAbsolute(profilePath)) {
    return resolve(profilePath);
  }
  return resolve(zenRoot, profilePath);
};

const isObject = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const validateManifest = (manifest, directoryId) => {
  if (!isObject(manifest)) {
    throw new Error("theme.json must contain an object");
  }
  if (manifest.id !== directoryId) {
    throw new Error(
      `theme.json id ${JSON.stringify(manifest.id)} must match ${directoryId}`,
    );
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new Error("theme.json must declare a non-empty name");
  }
  if (!isObject(manifest.scripts) && !isObject(manifest.style)) {
    throw new Error("theme.json must declare scripts or style");
  }
};

const MANIFEST_OWNED_KEYS = new Set([
  "id",
  "name",
  "description",
  "homepage",
  "author",
  "version",
  "createdAt",
  "updatedAt",
  "scripts",
  "style",
  "preferences",
  "supportsUnload",
  "tags",
  "fork",
  "readme",
  "image",
  "chromeManifest",
]);

export const localModEntry = (manifest, existing = undefined) => {
  const runtimeState = isObject(existing)
    ? Object.fromEntries(
        Object.entries(existing).filter(([key]) => !MANIFEST_OWNED_KEYS.has(key)),
      )
    : {};
  return {
    ...runtimeState,
    ...manifest,
    origin: "local",
    "no-updates": true,
    enabled: typeof existing?.enabled === "boolean" ? existing.enabled : true,
  };
};

const LOCAL_BACKUP_FILENAME =
  /^mods\.json\.bak-local-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export const localBackupFilename = date =>
  `mods.json.bak-local-${date.toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;

export const isLocalBackupFilename = filename => LOCAL_BACKUP_FILENAME.test(filename);

const ZEN_EXECUTABLE = /\/Zen\.app\/Contents\/MacOS\/zen(?:\s|$)/;

export const zenProcessIsRunning = commands =>
  commands.some(command => ZEN_EXECUTABLE.test(command));

export const parseModDatabase = contents => {
  const parsed = JSON.parse(contents);
  if (!isObject(parsed)) {
    throw new Error("Sine mods.json must contain an object");
  }
  return parsed;
};
