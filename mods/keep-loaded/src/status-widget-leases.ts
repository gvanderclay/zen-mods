/** Owns application-global status-widget leases and live-host dispatch. */

import type {
  StatusWidgetHost,
  StatusWidgetLease,
  StatusWidgetViewEvent,
  StatusWidgetViewShowing,
} from "./status-widget-contracts.ts";

export type StatusWidgetPhase = "absent" | "creating" | "destroying" | "present";

export interface StatusWidgetLeaseSnapshot {
  readonly leaseIds: readonly string[];
  readonly leases: number;
  readonly phase: StatusWidgetPhase;
}

export interface StatusWidgetLeasePorts<Holder> {
  /** Reports whether this holder is still a live generation eligible for dispatch. */
  isCurrent(holder: Holder): boolean;
  /** Reports whether this owner still holds this exact holder. */
  isOwned(holder: Holder): boolean;
  onError(error: unknown): void;
}

export class StatusWidgetLeases<Holder extends { readonly id: string }> {
  readonly #hosts = new Map<Holder, StatusWidgetHost>();
  readonly #onViewShowing: StatusWidgetViewShowing = event => this.#show(event);
  readonly #ports: StatusWidgetLeasePorts<Holder>;
  #phase: StatusWidgetPhase = "absent";

  constructor(ports: StatusWidgetLeasePorts<Holder>) {
    this.#ports = ports;
  }

  acquire(holder: Holder, host: StatusWidgetHost): StatusWidgetLease {
    if (!this.#ports.isOwned(holder)) {
      return Object.freeze({ release: () => false });
    }
    if (this.#hosts.has(holder)) {
      throw new TypeError("a registration can own only one status widget lease");
    }

    // Record the lease before creation; the stable dispatcher retains no window closure.
    this.#hosts.set(holder, host);
    this.#ensure();

    let released = false;
    return Object.freeze({
      release: () => {
        if (released) {
          return false;
        }
        released = true;
        return this.release(holder);
      },
    });
  }

  release(holder: Holder): boolean {
    const host = this.#hosts.get(holder);
    if (!host) {
      return false;
    }
    this.#hosts.delete(holder);
    if (this.#hosts.size === 0 && this.#phase === "present") {
      this.#phase = "destroying";
      try {
        host.destroy();
      } catch (error) {
        this.#ports.onError(error);
      } finally {
        this.#phase = "absent";
        try {
          this.#ensure();
        } catch (replacementError) {
          this.#ports.onError(replacementError);
        }
      }
    }
    return true;
  }

  snapshot(): StatusWidgetLeaseSnapshot {
    return {
      leaseIds: Object.freeze([...this.#hosts.keys()].map(holder => holder.id)),
      leases: this.#hosts.size,
      phase: this.#phase,
    };
  }

  #ensure(): void {
    if (this.#phase !== "absent" || this.#hosts.size === 0) {
      return;
    }
    const entry = this.#hosts.entries().next().value as
      | [Holder, StatusWidgetHost]
      | undefined;
    if (!entry) {
      return;
    }
    const [holder, host] = entry;
    this.#phase = "creating";
    try {
      host.create(this.#onViewShowing);
    } catch (error) {
      this.#cleanupFailedCreation(holder, host, error);
      throw error;
    }
    if (this.#phase !== "creating") {
      return;
    }
    if (this.#hosts.size === 0) {
      this.#phase = "destroying";
      try {
        host.destroy();
      } catch (error) {
        this.#ports.onError(error);
      } finally {
        this.#phase = "absent";
        this.#ensure();
      }
      return;
    }
    this.#phase = "present";
  }

  /** Cleans a partial widget before retrying a lease acquired during nested teardown. */
  #cleanupFailedCreation(holder: Holder, host: StatusWidgetHost, failure: unknown): void {
    if (this.#hosts.get(holder) === host) {
      this.#hosts.delete(holder);
    }
    this.#phase = "destroying";
    try {
      host.destroy();
    } catch (error) {
      this.#ports.onError(error);
    } finally {
      this.#phase = "absent";
      // Fail this generation before retrying a lease acquired during failed creation.
      try {
        host.fail?.(failure);
      } catch (error) {
        this.#ports.onError(error);
      }
      try {
        this.#ensure();
      } catch (replacementError) {
        this.#ports.onError(replacementError);
      }
    }
  }

  #show(event: StatusWidgetViewEvent): void {
    for (const [holder, host] of this.#hosts) {
      if (!this.#ports.isCurrent(holder)) {
        continue;
      }
      try {
        if (host.show(event)) {
          return;
        }
      } catch (error) {
        this.#ports.onError(error);
      }
    }
  }
}
