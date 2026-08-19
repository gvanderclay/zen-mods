import { lstat, readlink, realpath, symlink, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const missing = error => error?.code === "ENOENT";
const unchanged = { changed: false, repaired: false, rollback: async () => {} };

const replaceLink = async (linkPath, target, previousTarget = null) => {
  if (previousTarget !== null) await unlink(linkPath);
  try {
    await symlink(target, linkPath, "dir");
  } catch (error) {
    if (previousTarget !== null) {
      await symlink(previousTarget, linkPath, "dir").catch(() => {});
    }
    throw error;
  }
  return {
    changed: true,
    repaired: previousTarget !== null,
    rollback: async () => {
      await unlink(linkPath);
      if (previousTarget !== null) {
        await symlink(previousTarget, linkPath, "dir");
      }
    },
  };
};

export const installLocalLink = async (linkPath, expectedTarget) => {
  let stats;
  try {
    stats = await lstat(linkPath);
  } catch (error) {
    if (missing(error)) return replaceLink(linkPath, expectedTarget);
    throw error;
  }
  if (!stats.isSymbolicLink()) {
    throw new Error(`${linkPath} already exists and is not a symlink`);
  }

  const previousTarget = await readlink(linkPath);
  const target = resolve(dirname(linkPath), previousTarget);
  let canonicalTarget;
  try {
    canonicalTarget = await realpath(target);
  } catch (error) {
    if (missing(error)) {
      return replaceLink(linkPath, expectedTarget, previousTarget);
    }
    throw error;
  }
  if (canonicalTarget !== expectedTarget) {
    throw new Error(`${linkPath} points to ${target}, not ${expectedTarget}`);
  }
  return unchanged;
};
