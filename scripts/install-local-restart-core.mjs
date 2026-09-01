const MOD_ID = /^[a-z0-9][a-z0-9-]*$/;

export const quitZenScript = pid =>
  `tell application "System Events" to tell first application process whose unix id is ${pid} to tell menu 1 of menu bar item 2 of menu bar 1 to click first menu item whose value of attribute "AXMenuItemCmdChar" is "Q"`;

export const parseRestartArguments = args => {
  let all = false;
  let modId = null;
  let profile = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--all") {
      all = true;
    } else if (argument === "--profile") {
      profile = args[index + 1] ?? null;
      if (!profile) {
        throw new Error("--profile requires a path");
      }
      index += 1;
    } else if (!argument?.startsWith("-") && !modId) {
      modId = argument;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  if (all && modId) {
    throw new Error("--all cannot combine with a mod id");
  }
  if (all && profile) {
    throw new Error("--all does not accept --profile");
  }
  if (!all && !modId) {
    throw new Error("a mod id or --all is required");
  }
  if (modId && !MOD_ID.test(modId)) {
    throw new Error(`invalid mod id: ${modId}`);
  }

  return { all, modId, profile };
};

export const localInstallCommand = (
  options,
  { nodePath, installerPath, pnpmCommand = "pnpm" },
) => {
  if (options.all) {
    return { command: pnpmCommand, args: ["run", "install:local:all"] };
  }

  const args = [installerPath, options.modId];
  if (options.profile) {
    args.push("--profile", options.profile);
  }
  return { command: nodePath, args };
};
