import {
  type JoinPath,
  PALETTE_PATH_PREFERENCE,
  resolvePalettePath,
} from "../core/path.ts";
import type { PaletteFilePort } from "../runtime.ts";

export interface PaletteFilePortOptions {
  readonly joinPath: JoinPath;
  readonly overridePath: () => string;
  readonly profileDirectory: string;
  readonly readJson: (path: string) => PromiseLike<unknown> | unknown;
}

export const createPaletteFilePort = ({
  joinPath,
  overridePath,
  profileDirectory,
  readJson,
}: PaletteFilePortOptions): PaletteFilePort => ({
  currentPath: () => resolvePalettePath(profileDirectory, overridePath(), joinPath),
  read: readJson,
});

export const createFirefoxPaletteFilePort = (): PaletteFilePort => {
  const profileDirectory = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  return createPaletteFilePort({
    joinPath: (...segments) => PathUtils.join(...segments),
    overridePath: () => Services.prefs.getStringPref(PALETTE_PATH_PREFERENCE, ""),
    profileDirectory,
    readJson: path => IOUtils.readJSON(path),
  });
};
