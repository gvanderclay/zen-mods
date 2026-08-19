export const DUPLICATE_COMMAND_ID = "cmd_zenDuplicateTab";

export interface ListenerTarget {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface DuplicateCommandPorts {
  readonly commandSet: ListenerTarget;
  readonly tabContainer: ListenerTarget;
  readonly schedule: (callback: () => void) => void;
  readonly showToast: (tabCount: number) => void | Promise<void>;
  readonly report: (error: unknown) => void;
}

// Zen 1.21.14b: zen-sets.js handles this command synchronously via gBrowser.duplicateTab.
export const observeDuplicateCommand = ({
  commandSet,
  report,
  schedule,
  showToast,
  tabContainer,
}: DuplicateCommandPorts): (() => void) => {
  let destroyed = false;
  const pending = new Set<() => void>();
  const onCommand: EventListener = event => {
    const target = event.target as { readonly id?: unknown } | null;
    if (destroyed || target?.id !== DUPLICATE_COMMAND_ID) return;

    let tabCount = 0;
    let watching = true;
    const onTabOpen: EventListener = () => {
      tabCount += 1;
    };
    const stopWatching = () => {
      if (!watching) return;
      watching = false;
      tabContainer.removeEventListener("TabOpen", onTabOpen);
      pending.delete(stopWatching);
    };
    pending.add(stopWatching);
    tabContainer.addEventListener("TabOpen", onTabOpen);

    try {
      schedule(() => {
        stopWatching();
        if (destroyed || tabCount === 0) return;
        try {
          void Promise.resolve(showToast(tabCount)).catch(report);
        } catch (error) {
          report(error);
        }
      });
    } catch (error) {
      stopWatching();
      report(error);
    }
  };

  commandSet.addEventListener("command", onCommand, true);
  return () => {
    if (destroyed) return;
    destroyed = true;
    commandSet.removeEventListener("command", onCommand, true);
    for (const stopWatching of [...pending]) stopWatching();
  };
};
