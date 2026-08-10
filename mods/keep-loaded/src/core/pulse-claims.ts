/**
 * Reload-surviving freshness records with an iterable ledger for active docshell
 * claims. Metadata is weak-keyed; only a tab currently activated by a generation is
 * held strongly, so closing or unpinning it can release the resource immediately.
 */

export interface PulseRecord {
  readonly heldSince: number | null;
  readonly lastPulseAt: number | null;
}

export interface PulseClaimsPort<Tab extends object, Owner extends object = object> {
  get(tab: Tab): PulseRecord;
  set(tab: Tab, owner: Owner, record: PulseRecord): boolean;
  forget(tab: Tab, owner: Owner): boolean;
  remove(tab: Tab, owner: Owner): boolean;
  active(owner: Owner): Array<[Tab, PulseRecord]>;
  activeCount(owner: Owner): number;
}

interface ActiveClaim<Owner extends object> {
  readonly owner: Owner;
  readonly heldSince: number;
}

export class PulseClaims<Tab extends object, Owner extends object = object>
  implements PulseClaimsPort<Tab, Owner>
{
  readonly #records = new WeakMap<Tab, PulseRecord>();
  readonly #active = new Map<Tab, ActiveClaim<Owner>>();

  get(tab: Tab): PulseRecord {
    return this.#records.get(tab) ?? { heldSince: null, lastPulseAt: null };
  }

  /** Update timing metadata and, when heldSince is non-null, acquire the claim. */
  set(tab: Tab, owner: Owner, record: PulseRecord): boolean {
    const active = this.#active.get(tab);
    if (active && active.owner !== owner) {
      return false;
    }
    const next = Object.freeze({
      heldSince: record.heldSince,
      lastPulseAt: record.lastPulseAt,
    });
    this.#records.set(tab, next);
    if (next.heldSince === null) {
      this.#active.delete(tab);
    } else {
      this.#active.set(tab, { owner, heldSince: next.heldSince });
    }
    return true;
  }

  /** Drop this generation's active claim while retaining its timing metadata. */
  forget(tab: Tab, owner: Owner): boolean {
    const active = this.#active.get(tab);
    if (active && active.owner !== owner) {
      return false;
    }
    const record = this.get(tab);
    this.#records.set(
      tab,
      Object.freeze({ heldSince: null, lastPulseAt: record.lastPulseAt }),
    );
    this.#active.delete(tab);
    return true;
  }

  /** Remove all metadata and any active claim for a closed/unowned tab. */
  remove(tab: Tab, owner: Owner): boolean {
    const active = this.#active.get(tab);
    if (active && active.owner !== owner) {
      return false;
    }
    this.#active.delete(tab);
    this.#records.delete(tab);
    return true;
  }

  /** Snapshot active claims for one generation; never exposes the internal Map. */
  active(owner: Owner): Array<[Tab, PulseRecord]> {
    return [...this.#active.entries()]
      .filter(([, claim]) => claim.owner === owner)
      .map(([tab, claim]) => [
        tab,
        Object.freeze({
          heldSince: claim.heldSince,
          lastPulseAt: this.get(tab).lastPulseAt,
        }),
      ]);
  }

  activeCount(owner: Owner): number {
    let count = 0;
    for (const claim of this.#active.values()) {
      if (claim.owner === owner) {
        count += 1;
      }
    }
    return count;
  }
}
