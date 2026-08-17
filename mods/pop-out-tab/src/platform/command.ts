import { POP_OUT_COMMAND_ID } from "./shortcut.ts";

const COMMAND_SET_ID = "mainCommandSet";

export interface PopOutTabCommandDependencies {
  readonly popOutSelectedTab: () => void;
  readonly report: (error: unknown) => void;
}

export const installPopOutTabCommand = ({
  popOutSelectedTab,
  report,
}: PopOutTabCommandDependencies): (() => void) => {
  const document = window.document;
  const commandSet = document.getElementById(COMMAND_SET_ID);
  if (!commandSet || typeof document.createXULElement !== "function") {
    throw new Error("Zen browser command set is unavailable");
  }

  document.getElementById(POP_OUT_COMMAND_ID)?.remove();
  const command = document.createXULElement("command");
  command.id = POP_OUT_COMMAND_ID;
  let destroyed = false;

  const onCommand = () => {
    if (destroyed) return;
    try {
      popOutSelectedTab();
    } catch (error) {
      report(error);
    }
  };

  command.addEventListener("command", onCommand);
  commandSet.append(command);

  return () => {
    if (destroyed) return;
    destroyed = true;
    command.removeEventListener("command", onCommand);
    command.remove();
  };
};
