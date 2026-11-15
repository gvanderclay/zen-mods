const COMMAND_SET_ID = "mainCommandSet";

export interface CommandDefinition {
  readonly id: string;
  readonly run: () => unknown;
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
  // Every owned id is preflighted before any mutation so a foreign same-id node rejects
  // the whole registration instead of being replaced.
  for (const definition of commands) {
    if (document.getElementById(definition.id)) {
      throw new Error(`command ID is already owned: ${definition.id}`);
    }
  }

  let destroyed = false;
  const installed = commands.map(definition => {
    const element = document.createXULElement("command");
    element.id = definition.id;
    const onCommand = () => {
      if (destroyed) return;
      try {
        void Promise.resolve(definition.run()).catch(error => {
          if (!destroyed) report(error);
        });
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
