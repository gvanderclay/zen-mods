import {
  APPLICATION_COORDINATOR_PROTOCOL,
  type ApplicationOwnerApi,
} from "../application-coordinator.ts";
import type { CrashFacts } from "../core/crash.ts";

export const APPLICATION_OWNER_URI =
  "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";

interface ApplicationModule extends ApplicationOwnerApi<BrowserTab, CrashFacts> {
  readonly applicationId: string;
  readonly protocol: number;
}

const imported = ChromeUtils.importESModule<ApplicationModule>(APPLICATION_OWNER_URI);

if (imported.protocol !== APPLICATION_COORDINATOR_PROTOCOL) {
  throw new Error(
    `Keep Loaded application owner protocol ${imported.protocol} is cached; ` +
      `protocol ${APPLICATION_COORDINATOR_PROTOCOL} requires restarting Zen`,
  );
}

export const applicationOwner: ApplicationOwnerApi<BrowserTab, CrashFacts> = imported;
export const applicationId = imported.applicationId;
