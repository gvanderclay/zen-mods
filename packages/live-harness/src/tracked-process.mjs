/** Own the spawned Zen process and its profile-scoped shutdown escalation. */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const parseProfileProcessIds = (output, { binary, profile }) =>
  output
    .split("\n")
    .map(line => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(Boolean)
    .filter(([, , command]) => {
      const arguments_ = command.split(/\s+/);
      if (arguments_[0] !== binary) return false;
      return arguments_.some(
        (argument, index) =>
          ((argument === "--profile" || argument === "-profile") &&
            arguments_[index + 1] === profile) ||
          argument === `--profile=${profile}` ||
          argument === `-profile=${profile}`,
      );
    })
    .map(match => Number.parseInt(match[1], 10))
    .filter(pid => Number.isInteger(pid) && pid > 1 && pid !== process.pid);

export const profileProcessIds = async (profile, binary) => {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseProfileProcessIds(stdout, { binary, profile });
};

export const waitForProfileExit = async (readProcessIds, timeoutMilliseconds) => {
  const deadline = Date.now() + timeoutMilliseconds;
  let pids = await readProcessIds();
  while (pids.length > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    pids = await readProcessIds();
  }
  return pids;
};

export const signalProcesses = (pids, signal) => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
};

export const startTrackedProcess = (binary, arguments_, options) => {
  const child = spawn(binary, arguments_, options);
  const started = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return { child, started };
};
