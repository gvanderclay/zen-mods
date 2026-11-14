import { execFileSync } from "node:child_process";

/**
 * Return a copy of `env` without the variables Git lists as repository-local.
 *
 * Git exports GIT_DIR and related variables to hooks; githooks(5) says a hook that runs
 * Git in a foreign repository or a different working tree "should clear these
 * environment variables". In a linked worktree's pre-push, GIT_DIR is exported without
 * GIT_WORK_TREE, so Git run from a mod directory takes that directory as the worktree
 * root. Without these variables Git rediscovers the repository from its working directory.
 */
export const withoutRepositoryGitEnvironment = env => {
  const names = execFileSync("git", ["rev-parse", "--local-env-vars"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const isolated = { ...env };
  for (const name of names) delete isolated[name];
  return isolated;
};
