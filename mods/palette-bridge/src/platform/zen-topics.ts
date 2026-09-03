export const ZEN_PALETTE_UPDATE_TOPICS = [
  "zen-space-gradient-update",
  "zen-theme-change",
] as const;

const zenPaletteUpdateTopics: ReadonlySet<string> = new Set(ZEN_PALETTE_UPDATE_TOPICS);

export interface ZenObserverPort {
  observe(subject: unknown, topic: string): void;
}

export interface ZenObserverStorePort {
  addObserver(observer: ZenObserverPort, topic: string): void;
  removeObserver(observer: ZenObserverPort, topic: string): void;
}

const removeTopics = (
  store: ZenObserverStorePort,
  observer: ZenObserverPort,
  topics: readonly string[],
): void => {
  const errors: unknown[] = [];
  for (const topic of topics) {
    try {
      store.removeObserver(observer, topic);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "could not remove Zen palette observers");
  }
};

// Zen 1.21.16b f4d9821: ZenGradientGenerator.mjs 1785-1798 and 178-181.
export const observeZenPaletteUpdates = (
  store: ZenObserverStorePort,
  changed: () => void,
): (() => void) => {
  let live = true;
  const observer: ZenObserverPort = {
    observe: (_subject, topic) => {
      if (live && zenPaletteUpdateTopics.has(topic)) changed();
    },
  };
  const registered: string[] = [];
  try {
    for (const topic of ZEN_PALETTE_UPDATE_TOPICS) {
      store.addObserver(observer, topic);
      registered.push(topic);
    }
  } catch (registrationError) {
    live = false;
    try {
      removeTopics(store, observer, registered);
    } catch (cleanupError) {
      throw new AggregateError(
        [registrationError, cleanupError],
        "could not register Zen palette observers",
      );
    }
    throw registrationError;
  }
  return () => {
    if (!live) return;
    live = false;
    removeTopics(store, observer, registered);
  };
};
