export const PALETTE_PATH_PREFERENCE = "zen.palette-bridge.path";
export const DEFAULT_PALETTE_RELATIVE_PATH = ["chrome", "palette-bridge.json"] as const;

export type JoinPath = (...segments: string[]) => string;

export const resolvePalettePath = (
  profileDirectory: string,
  overridePath: string,
  joinPath: JoinPath,
): string =>
  overridePath === ""
    ? joinPath(profileDirectory, ...DEFAULT_PALETTE_RELATIVE_PATH)
    : overridePath;
