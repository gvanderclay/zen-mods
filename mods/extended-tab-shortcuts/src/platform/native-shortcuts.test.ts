import { describe, expect, it } from "vitest";
import { FOLDER_MOVE_SHORTCUT } from "./folder-shortcuts.ts";
import {
  installShortcutSurface,
  ownedShortcutSurfaceIds,
  SHORTCUT_KEYSET_ID,
  SHORTCUT_MENU_ENTRIES,
  SHORTCUT_MENU_ID,
  SHORTCUT_MENU_LABEL,
  SHORTCUT_MENU_POPUP_ID,
  SHORTCUT_MENU_SEPARATOR_ID,
  type ShortcutSurfaceDependencies,
  shortcutMenuItemId,
} from "./native-shortcuts.ts";
import {
  CLEAR_SELECTION_SHORTCUT,
  POP_OUT_SHORTCUT,
  POP_OUT_SHORTCUT_ID,
  SELECT_NEXT_ARROW_SHORTCUT,
  SELECT_NEXT_VIM_SHORTCUT,
  SELECT_PREVIOUS_ARROW_SHORTCUT,
  SELECT_PREVIOUS_VIM_SHORTCUT,
} from "./shortcut.ts";
import {
  MOVE_NEXT_SPACE_ARROW_SHORTCUT,
  MOVE_NEXT_SPACE_VIM_SHORTCUT,
  MOVE_PREVIOUS_SPACE_ARROW_SHORTCUT,
  MOVE_PREVIOUS_SPACE_VIM_SHORTCUT,
} from "./space-shortcuts.ts";

class FakeElement extends EventTarget {
  id = "";
  parentElement: FakeElement | null = null;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly tagName: string;

  constructor(tagName: string) {
    super();
    this.tagName = tagName;
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  remove() {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parentElement?.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

class FakeDocument {
  readonly body = new FakeElement("body");
  readonly documentElement = new FakeElement("window");
  readonly toolsPopup = new FakeElement("menupopup");

  constructor({ withToolsMenu = true } = {}) {
    this.documentElement.append(this.body);
    if (withToolsMenu) {
      this.toolsPopup.id = "menu_ToolsPopup";
      this.documentElement.append(this.toolsPopup);
    }
  }

  createXULElement(tagName: string) {
    return new FakeElement(tagName);
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

const dependencies = (document: FakeDocument): ShortcutSurfaceDependencies => ({
  definitions: SHORTCUT_MENU_ENTRIES,
  document: document as unknown as Document,
});

describe("installShortcutSurface", () => {
  it("installs one populated keyset and the approved Tools submenu", () => {
    const document = new FakeDocument();

    installShortcutSurface(dependencies(document));

    const keyset = document.getElementById(SHORTCUT_KEYSET_ID);
    expect(keyset?.parentElement).toBe(document.body);
    expect(keyset?.children.map(child => child.id)).toEqual(
      SHORTCUT_MENU_ENTRIES.map(definition => definition.id),
    );
    expect(
      keyset?.children.map(child => ({
        command: child.getAttribute("command"),
        key: child.getAttribute("key"),
        keycode: child.getAttribute("keycode"),
        modifiers: child.getAttribute("modifiers"),
      })),
    ).toEqual([
      {
        command: "Extend Tab Selection Next",
        key: "j",
        keycode: null,
        modifiers: "control,meta",
      },
      {
        command: "Extend Tab Selection Next",
        key: null,
        keycode: "VK_DOWN",
        modifiers: "control,meta",
      },
      {
        command: "Extend Tab Selection Previous",
        key: "k",
        keycode: null,
        modifiers: "control,meta",
      },
      {
        command: "Extend Tab Selection Previous",
        key: null,
        keycode: "VK_UP",
        modifiers: "control,meta",
      },
      {
        command: "Clear Tab Selection",
        key: "`",
        keycode: null,
        modifiers: "control,meta",
      },
      {
        command: "Pop Out / Merge Selected Tabs",
        key: "o",
        keycode: null,
        modifiers: "control,meta",
      },
      {
        command: "Move Selected Tabs to Next Space",
        key: "n",
        keycode: null,
        modifiers: "control,meta",
      },
      {
        command: "Move Selected Tabs to Next Space",
        key: null,
        keycode: "VK_RIGHT",
        modifiers: "control,meta,shift",
      },
      {
        command: "Move Selected Tabs to Previous Space",
        key: "p",
        keycode: null,
        modifiers: "control,meta",
      },
      {
        command: "Move Selected Tabs to Previous Space",
        key: null,
        keycode: "VK_LEFT",
        modifiers: "control,meta,shift",
      },
      {
        command: "Move Selected Tabs to Folder",
        key: "m",
        keycode: null,
        modifiers: "control,meta",
      },
    ]);

    const separator = document.getElementById(SHORTCUT_MENU_SEPARATOR_ID);
    const menu = document.getElementById(SHORTCUT_MENU_ID);
    expect(separator?.parentElement).toBe(document.toolsPopup);
    expect(menu?.parentElement).toBe(document.toolsPopup);
    expect(document.toolsPopup.children.indexOf(separator as FakeElement)).toBe(
      document.toolsPopup.children.length - 2,
    );
    expect(menu?.getAttribute("label")).toBe(SHORTCUT_MENU_LABEL);
    const popup = document.getElementById(SHORTCUT_MENU_POPUP_ID);
    expect(popup?.parentElement).toBe(menu);
    expect(
      popup?.children.map(item => ({
        command: item.getAttribute("command"),
        id: item.id,
        key: item.getAttribute("key"),
        label: item.getAttribute("label"),
      })),
    ).toEqual(
      SHORTCUT_MENU_ENTRIES.map(definition => ({
        command: definition.action,
        id: shortcutMenuItemId(definition.id),
        key: definition.id,
        label: definition.label,
      })),
    );
  });

  it("rejects the whole registration when an owned id already exists", () => {
    const document = new FakeDocument();
    const foreign = new FakeElement("key");
    foreign.id = POP_OUT_SHORTCUT_ID;
    document.body.append(foreign);

    expect(() => installShortcutSurface(dependencies(document))).toThrow(
      `shortcut surface ID is already owned: ${POP_OUT_SHORTCUT_ID}`,
    );
    expect(foreign.parentElement).toBe(document.body);
    expect(document.getElementById(SHORTCUT_KEYSET_ID)).toBeNull();
    expect(document.getElementById(SHORTCUT_MENU_ID)).toBeNull();
    expect(document.getElementById(SHORTCUT_MENU_SEPARATOR_ID)).toBeNull();
  });

  it("rejects a foreign menu node before mutating anything", () => {
    const document = new FakeDocument();
    const foreign = new FakeElement("menu");
    foreign.id = SHORTCUT_MENU_ID;
    document.toolsPopup.append(foreign);

    expect(() => installShortcutSurface(dependencies(document))).toThrow(
      `shortcut surface ID is already owned: ${SHORTCUT_MENU_ID}`,
    );
    expect(foreign.parentElement).toBe(document.toolsPopup);
    expect(document.getElementById(SHORTCUT_KEYSET_ID)).toBeNull();
  });

  it("refuses to install without the Zen Tools menu", () => {
    const document = new FakeDocument({ withToolsMenu: false });

    expect(() => installShortcutSurface(dependencies(document))).toThrow(
      "Zen browser shortcut menu is unavailable",
    );
    expect(document.body.children).toEqual([]);
  });

  it("removes only its own nodes and keeps browser customizations", () => {
    const document = new FakeDocument();
    const dispose = installShortcutSurface(dependencies(document));
    const keyset = document.getElementById(SHORTCUT_KEYSET_ID);
    const menu = document.getElementById(SHORTCUT_MENU_ID);
    const separator = document.getElementById(SHORTCUT_MENU_SEPARATOR_ID);

    dispose();

    expect(keyset?.parentElement).toBeNull();
    expect(menu?.parentElement).toBeNull();
    expect(separator?.parentElement).toBeNull();
    expect(document.getElementById(POP_OUT_SHORTCUT_ID)).toBeNull();
    dispose();
    expect(document.body.children).toEqual([]);
  });

  it("cannot remove a newer generation's surface", () => {
    const document = new FakeDocument();
    const disposeFirst = installShortcutSurface(dependencies(document));
    disposeFirst();
    const disposeSecond = installShortcutSurface(dependencies(document));
    const keyset = document.getElementById(SHORTCUT_KEYSET_ID);

    disposeFirst();

    expect(keyset?.parentElement).toBe(document.body);
    expect(document.getElementById(SHORTCUT_MENU_ID)?.parentElement).toBe(
      document.toolsPopup,
    );
    disposeSecond();
    expect(document.getElementById(SHORTCUT_KEYSET_ID)).toBeNull();
  });
});

describe("ownedShortcutSurfaceIds", () => {
  it("covers every key, menu node and menu item id", () => {
    const ids = ownedShortcutSurfaceIds(SHORTCUT_MENU_ENTRIES);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4 + SHORTCUT_MENU_ENTRIES.length * 2);
    expect(ids).toContain(POP_OUT_SHORTCUT_ID);
    expect(ids).toContain(shortcutMenuItemId(POP_OUT_SHORTCUT_ID));
    expect(ids).toContain(SHORTCUT_KEYSET_ID);
    expect(ids).toContain(SHORTCUT_MENU_POPUP_ID);
  });

  it("lists the approved menu order", () => {
    expect(SHORTCUT_MENU_ENTRIES).toEqual([
      SELECT_NEXT_VIM_SHORTCUT,
      SELECT_NEXT_ARROW_SHORTCUT,
      SELECT_PREVIOUS_VIM_SHORTCUT,
      SELECT_PREVIOUS_ARROW_SHORTCUT,
      CLEAR_SELECTION_SHORTCUT,
      POP_OUT_SHORTCUT,
      MOVE_NEXT_SPACE_VIM_SHORTCUT,
      MOVE_NEXT_SPACE_ARROW_SHORTCUT,
      MOVE_PREVIOUS_SPACE_VIM_SHORTCUT,
      MOVE_PREVIOUS_SPACE_ARROW_SHORTCUT,
      FOLDER_MOVE_SHORTCUT,
    ]);
  });
});
