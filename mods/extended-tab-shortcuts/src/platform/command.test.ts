import { afterEach, describe, expect, it, vi } from "vitest";
import { installCommands } from "./command.ts";
import { POP_OUT_COMMAND_ID } from "./shortcut.ts";

class FakeElement extends EventTarget {
  id = "";
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  remove() {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parentElement?.children.splice(index, 1);
    }
    this.parentElement = null;
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement();

  createXULElement() {
    return new FakeElement();
  }

  getElementById(id: string): FakeElement | null {
    const visit = (node: FakeElement): FakeElement | null => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this.documentElement);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installCommands", () => {
  it("installs every command and removes them together on disposal", () => {
    const document = new FakeDocument();
    const commandSet = new FakeElement();
    commandSet.id = "mainCommandSet";
    document.documentElement.append(commandSet);
    vi.stubGlobal("window", { document });
    const popOutSelectedTab = vi.fn();
    const selectNextTab = vi.fn();

    const dispose = installCommands(
      [
        { id: POP_OUT_COMMAND_ID, run: popOutSelectedTab },
        { id: "Extend Tab Selection Next", run: selectNextTab },
      ],
      { report: vi.fn() },
    );
    const popOutCommand = document.getElementById(POP_OUT_COMMAND_ID);
    const selectCommand = document.getElementById("Extend Tab Selection Next");

    popOutCommand?.dispatchEvent(new Event("command"));
    selectCommand?.dispatchEvent(new Event("command"));
    expect(popOutSelectedTab).toHaveBeenCalledOnce();
    expect(selectNextTab).toHaveBeenCalledOnce();

    dispose();
    expect(document.getElementById(POP_OUT_COMMAND_ID)).toBeNull();
    expect(document.getElementById("Extend Tab Selection Next")).toBeNull();
    popOutCommand?.dispatchEvent(new Event("command"));
    selectCommand?.dispatchEvent(new Event("command"));
    expect(popOutSelectedTab).toHaveBeenCalledOnce();
    expect(selectNextTab).toHaveBeenCalledOnce();
  });

  it("replaces a stale command and reports action failures", () => {
    const document = new FakeDocument();
    const commandSet = new FakeElement();
    commandSet.id = "mainCommandSet";
    const stale = new FakeElement();
    stale.id = POP_OUT_COMMAND_ID;
    commandSet.append(stale);
    document.documentElement.append(commandSet);
    vi.stubGlobal("window", { document });
    const error = new Error("pop-out failed");
    const report = vi.fn();

    installCommands(
      [
        {
          id: POP_OUT_COMMAND_ID,
          run: () => {
            throw error;
          },
        },
      ],
      { report },
    );
    document.getElementById(POP_OUT_COMMAND_ID)?.dispatchEvent(new Event("command"));

    expect(stale.parentElement).toBeNull();
    expect(report).toHaveBeenCalledWith(error);
  });
});
