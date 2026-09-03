type PaletteBridgeFacade =
  import("../src/platform/sine.ts").PaletteBridgeGenerationFacade;

interface Window {
  zenPaletteBridge?: PaletteBridgeFacade;
  addUnloadListener?: (callback: () => unknown) => void;
}

interface PaletteBridgeFile {
  readonly path: string;
}

interface PaletteBridgeDirectoryService {
  get(name: "ProfD", interfaceType: unknown): PaletteBridgeFile;
}

interface PaletteBridgePreferenceStore {
  getStringPref(name: string, fallback: string): string;
}

interface PaletteBridgeServices {
  readonly dirsvc: PaletteBridgeDirectoryService;
  readonly prefs: PaletteBridgePreferenceStore;
}

declare const Ci: { readonly nsIFile: unknown };
declare const IOUtils: {
  readJSON(path: string): Promise<unknown>;
};
declare const PathUtils: {
  join(...segments: string[]): string;
};
declare const Services: PaletteBridgeServices;
