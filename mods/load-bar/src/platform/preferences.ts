import {
  DEFAULT_SETTINGS,
  LOAD_BAR_PREFERENCES,
  type LoadBarSettings,
  parseLoadBarSettings,
} from "../core/settings.ts";

export interface PreferenceObserver {
  observe(): void;
}

export interface StringPreferenceStore {
  addObserver(name: string, observer: PreferenceObserver): void;
  getStringPref(name: string, fallback: string): string;
  removeObserver(name: string, observer: PreferenceObserver): void;
}

export interface LoadBarPreferences {
  install(listener: (settings: LoadBarSettings) => void): () => void;
  read(): LoadBarSettings;
}

const PREFERENCE_NAMES = Object.values(LOAD_BAR_PREFERENCES);

export const createLoadBarPreferences = (
  store: StringPreferenceStore,
): LoadBarPreferences => {
  const readValue = (name: string, fallback: string): string => {
    try {
      return store.getStringPref(name, fallback);
    } catch {
      return fallback;
    }
  };
  const read = (): LoadBarSettings =>
    parseLoadBarSettings({
      placement: readValue(LOAD_BAR_PREFERENCES.placement, DEFAULT_SETTINGS.placement),
      thickness: readValue(
        LOAD_BAR_PREFERENCES.thickness,
        String(DEFAULT_SETTINGS.thickness),
      ),
      color: readValue(LOAD_BAR_PREFERENCES.color, DEFAULT_SETTINGS.color),
      revealDelay: readValue(
        LOAD_BAR_PREFERENCES.revealDelay,
        String(DEFAULT_SETTINGS.revealDelayMs),
      ),
    });

  return {
    install: listener => {
      let active = true;
      const acquired: string[] = [];
      const observer: PreferenceObserver = {
        observe: () => {
          if (active) listener(read());
        },
      };
      try {
        for (const name of PREFERENCE_NAMES) {
          store.addObserver(name, observer);
          acquired.push(name);
        }
      } catch (error) {
        active = false;
        for (const name of acquired.reverse()) {
          try {
            store.removeObserver(name, observer);
          } catch {}
        }
        throw error;
      }
      return () => {
        if (!active) return;
        active = false;
        let firstError: unknown;
        for (const name of acquired.reverse()) {
          try {
            store.removeObserver(name, observer);
          } catch (error) {
            firstError ??= error;
          }
        }
        if (firstError) throw firstError;
      };
    },
    read,
  };
};
