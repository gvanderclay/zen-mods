import { PALETTE_PATH_PREFERENCE } from "../core/path.ts";

export interface PreferenceObserverPort {
  observe(): void;
}

export interface PreferenceStorePort {
  addObserver(name: string, observer: PreferenceObserverPort): void;
  removeObserver(name: string, observer: PreferenceObserverPort): void;
}

export const observePalettePath = (
  store: PreferenceStorePort,
  changed: () => void,
): (() => void) => {
  let live = true;
  const observer: PreferenceObserverPort = {
    observe: () => {
      if (live) changed();
    },
  };
  store.addObserver(PALETTE_PATH_PREFERENCE, observer);
  return () => {
    if (!live) return;
    live = false;
    store.removeObserver(PALETTE_PATH_PREFERENCE, observer);
  };
};
