import { describe, expect, it, vi } from "vitest";
import {
  installNativeIndicatorHandoff,
  NATIVE_INDICATOR_OWNER_ATTRIBUTE,
} from "./native-indicator.ts";

class FakeRoot {
  readonly attributes = new Map<string, string>();
  readonly events: string[];

  constructor(events: string[] = []) {
    this.events = events;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.events.push(`remove:${name}`);
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.events.push(`set:${name}:${value}`);
    this.attributes.set(name, value);
  }
}

describe("native indicator handoff", () => {
  it("registers exact cleanup before setting the readiness marker last", () => {
    const events: string[] = [];
    const root = new FakeRoot(events);
    let dispose: () => unknown = () => {
      throw new Error("cleanup was not registered");
    };

    installNativeIndicatorHandoff({
      defer: disposer => {
        events.push("defer");
        dispose = disposer;
      },
      document: { documentElement: root },
      token: "generation-a",
    });

    expect(events).toEqual([
      "defer",
      `set:${NATIVE_INDICATOR_OWNER_ATTRIBUTE}:generation-a`,
    ]);
    expect(root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE)).toBe("generation-a");
    dispose();
    expect(root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE)).toBeNull();
  });

  it("does not let stale cleanup remove a replacement generation", () => {
    const root = new FakeRoot();
    let disposeOld = () => {};
    installNativeIndicatorHandoff({
      defer: disposer => {
        disposeOld = disposer;
      },
      document: { documentElement: root },
      token: "old",
    });
    root.setAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE, "replacement");

    disposeOld();

    expect(root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE)).toBe("replacement");
  });

  it("fails before takeover when another owner marker exists", () => {
    const root = new FakeRoot();
    root.setAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE, "other");
    const defer = vi.fn();

    expect(() =>
      installNativeIndicatorHandoff({
        defer,
        document: { documentElement: root },
        token: "current",
      }),
    ).toThrow(/already owned/);
    expect(defer).not.toHaveBeenCalled();
    expect(root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE)).toBe("other");
  });

  it("leaves native ownership exposed when the readiness marker cannot be set", () => {
    const root = new FakeRoot();
    const error = new Error("attribute write failed");
    const setAttribute = vi.spyOn(root, "setAttribute").mockImplementation(() => {
      throw error;
    });
    let dispose = () => {};

    expect(() =>
      installNativeIndicatorHandoff({
        defer: disposer => {
          dispose = disposer;
        },
        document: { documentElement: root },
        token: "current",
      }),
    ).toThrow(error);
    dispose();

    expect(setAttribute).toHaveBeenCalledOnce();
    expect(root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE)).toBeNull();
  });

  it("rejects an empty ownership token", () => {
    const root = new FakeRoot();
    expect(() =>
      installNativeIndicatorHandoff({
        defer: vi.fn(),
        document: { documentElement: root },
        token: "",
      }),
    ).toThrow(/token/);
  });
});
