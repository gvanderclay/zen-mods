export interface FolderPickerKeyInput {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly destinations: readonly {
    readonly id: string;
    readonly shortcut: string | null;
  }[];
  readonly key: string;
  readonly metaKey: boolean;
  readonly newFolderName?: string;
  readonly view: "destinations" | "new-folder";
}

export type FolderPickerKeyDecision =
  | { readonly kind: "activate" }
  | { readonly kind: "close" }
  | { readonly kind: "create" }
  | { readonly kind: "go-back" }
  | { readonly kind: "move"; readonly folderId: string }
  | { readonly kind: "navigate"; readonly direction: -1 | 1 }
  | { readonly kind: "new-folder" }
  | { readonly kind: "none" };

export const decideFolderPickerKey = (
  input: FolderPickerKeyInput,
): FolderPickerKeyDecision => {
  if (input.key === "Escape") return { kind: "close" };
  if (input.metaKey || input.ctrlKey || input.altKey) return { kind: "none" };
  if (input.view === "new-folder") {
    if (input.key === "Enter") return { kind: "create" };
    if (input.key === "Backspace" && !input.newFolderName) {
      return { kind: "go-back" };
    }
    return { kind: "none" };
  }

  const destination = input.destinations.find(
    candidate => candidate.shortcut === input.key,
  );
  if (destination) return { folderId: destination.id, kind: "move" };

  switch (input.key.toLowerCase()) {
    case "j":
    case "arrowdown":
      return { direction: 1, kind: "navigate" };
    case "k":
    case "arrowup":
      return { direction: -1, kind: "navigate" };
    case "n":
      return { kind: "new-folder" };
    case "enter":
      return { kind: "activate" };
    default:
      return { kind: "none" };
  }
};
