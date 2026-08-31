const COMMAND_SET_ID = "mainCommandSet";

export interface CommandDefinition {
  readonly id: string;
  readonly run: () => void;
}

export interface CommandRegistryDependencies {
  readonly report: (error: unknown) => void;
}

export const installCommands = (
  commands: readonly CommandDefinition[],
  { report }: CommandRegistryDependencies,
): (() => void) => {
  if (new Set(commands.map(command => command.id)).size !== commands.length) {
    throw new Error("command IDs must be unique");
  }

  const document = window.document;
  const commandSet = document.getElementById(COMMAND_SET_ID);
  if (!commandSet || typeof document.createXULElement !== "function") {
    throw new Error("Zen browser command set is unavailable");
  }

  let destroyed = false;
  const installed = commands.map(definition => {
    document.getElementById(definition.id)?.remove();
    const element = document.createXULElement("command");
    element.id = definition.id;
    const onCommand = () => {
      if (destroyed) return;
      try {
        definition.run();
      } catch (error) {
        report(error);
      }
    };
    element.addEventListener("command", onCommand);
    commandSet.append(element);
    return { element, onCommand };
  });

  return () => {
    if (destroyed) return;
    destroyed = true;
    for (const { element, onCommand } of installed) {
      element.removeEventListener("command", onCommand);
      element.remove();
    }
  };
};
