import { describe, expect, it, vi } from "vitest";
import {
  DUPLICATE_COMMAND_ID,
  type ListenerTarget,
  observeDuplicateCommand,
} from "./duplicate-command.ts";

class FakeTarget implements ListenerTarget {
  readonly listeners = new Map<string, Set<EventListener>>();
  readonly removals: Array<{ listener: EventListener; options: unknown; type: string }> =
    [];

  addEventListener(
    type: string,
    listener: EventListener,
    _options?: boolean | AddEventListenerOptions,
  ) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ) {
    this.listeners.get(type)?.delete(listener);
    this.removals.push({ listener, options, type });
  }

  emit(type: string, target: unknown = this) {
    const event = { target } as Event;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

const setup = () => {
  const commandSet = new FakeTarget();
  const tabContainer = new FakeTarget();
  const scheduled: Array<() => void> = [];
  const showToast = vi.fn<(count: number) => void>();
  const report = vi.fn<(error: unknown) => void>();
  const dispose = observeDuplicateCommand({
    commandSet,
    report,
    schedule: callback => scheduled.push(callback),
    showToast,
    tabContainer,
  });
  return { commandSet, dispose, report, scheduled, showToast, tabContainer };
};

describe("observeDuplicateCommand", () => {
  it("counts tabs actually opened by Zen's duplicate command", () => {
    const { commandSet, scheduled, showToast, tabContainer } = setup();

    commandSet.emit("command", { id: DUPLICATE_COMMAND_ID });
    tabContainer.emit("TabOpen");
    tabContainer.emit("TabOpen");
    scheduled[0]?.();

    expect(showToast).toHaveBeenCalledWith(2);
    expect(tabContainer.listeners.get("TabOpen")).toHaveLength(0);
  });

  it("does not confirm other commands or a duplicate command that opens nothing", () => {
    const { commandSet, scheduled, showToast } = setup();

    commandSet.emit("command", { id: "cmd_newNavigatorTab" });
    commandSet.emit("command", { id: DUPLICATE_COMMAND_ID });
    scheduled[0]?.();

    expect(showToast).not.toHaveBeenCalled();
  });

  it("removes listeners and makes pending confirmation inert on cleanup", () => {
    const { commandSet, dispose, scheduled, showToast, tabContainer } = setup();

    commandSet.emit("command", { id: DUPLICATE_COMMAND_ID });
    tabContainer.emit("TabOpen");
    dispose();
    scheduled[0]?.();

    expect(showToast).not.toHaveBeenCalled();
    expect(commandSet.listeners.get("command")).toHaveLength(0);
    expect(tabContainer.listeners.get("TabOpen")).toHaveLength(0);
  });

  it("reports an asynchronous toast failure", async () => {
    const { commandSet, report, scheduled, showToast, tabContainer } = setup();
    const error = new Error("toast failed");
    showToast.mockRejectedValue(error);

    commandSet.emit("command", { id: DUPLICATE_COMMAND_ID });
    tabContainer.emit("TabOpen");
    scheduled[0]?.();
    await Promise.resolve();

    expect(report).toHaveBeenCalledWith(error);
  });
});
