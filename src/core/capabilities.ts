/**
 * Turns a set of presence checks into a verdict. Pure — the probing itself is
 * privileged and lives next to the APIs it checks (`prefProbes`, `browserProbes`).
 *
 * This mod is built entirely on private Zen and Firefox APIs, so the failure to
 * design for is a Zen update quietly removing one. Silence is the bad outcome:
 * tabs would look fine and stop receiving notifications.
 */

export interface Probe {
  /** How the capability is named in the log, e.g. `gBrowser._insertBrowser`. */
  name: string;
  present: boolean;
  /** Required capabilities abort the sweep; optional ones only degrade it. */
  required: boolean;
}

export interface CapabilityReport {
  ok: boolean;
  missingRequired: string[];
  missingOptional: string[];
  /** Empty when there is nothing to say. */
  message: string;
}

export function reportCapabilities(probes: readonly Probe[]): CapabilityReport {
  const missing = (required: boolean) =>
    probes.filter(p => p.required === required && !p.present).map(p => p.name);

  const missingRequired = missing(true);
  const missingOptional = missing(false);

  let message = "";
  if (missingRequired.length) {
    message = `Zen no longer provides ${missingRequired.join(", ")} — not sweeping. This mod depends on private APIs; see DECISIONS.md.`;
  } else if (missingOptional.length) {
    message = `running degraded, ${missingOptional.join(", ")} is missing`;
  }

  return {
    ok: !missingRequired.length,
    missingRequired,
    missingOptional,
    message,
  };
}
