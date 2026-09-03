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
  addObserver(name: string, observer: PaletteBridgePreferenceObserver): void;
  getStringPref(name: string, fallback: string): string;
  removeObserver(name: string, observer: PaletteBridgePreferenceObserver): void;
}

interface PaletteBridgePreferenceObserver {
  observe(): void;
}

interface PaletteBridgeObserver {
  observe(subject: unknown, topic: string): void;
}

interface PaletteBridgeObserverStore {
  addObserver(observer: PaletteBridgeObserver, topic: string): void;
  removeObserver(observer: PaletteBridgeObserver, topic: string): void;
}

interface PaletteBridgeServices {
  readonly dirsvc: PaletteBridgeDirectoryService;
  readonly obs: PaletteBridgeObserverStore;
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
