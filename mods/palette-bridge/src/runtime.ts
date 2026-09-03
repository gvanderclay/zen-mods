import {
  GenerationScope,
  type TimerPort,
} from "@zen-mods/sine-lifecycle/generation-scope";
import type { SineWindowGenerationStopReason } from "@zen-mods/sine-lifecycle/sine-window";
import { type Palette, paletteIdentity, parsePalette } from "./core/palette.ts";
import type { PaletteStyleView } from "./platform/styles.ts";

export const PALETTE_POLL_INTERVAL_MS = 1000;

const failureIdentity = (error: unknown): string =>
  error instanceof Error ? `${error.name}:${error.message}` : String(error);

export type PaletteBridgeStopReason = SineWindowGenerationStopReason | "platform-failure";

export interface PaletteFilePort {
  currentPath(): string;
  read(path: string): PromiseLike<unknown> | unknown;
}

export interface PaletteBridgeControllerOptions {
  readonly eligible: boolean;
  readonly enqueueMicrotask?: (callback: () => void) => void;
  readonly file?: PaletteFilePort;
  readonly onError?: (error: unknown) => void;
  readonly onPaletteApplied?: (palette: Palette) => void;
  readonly timers: TimerPort;
  readonly view?: PaletteStyleView;
}

export interface PaletteBridgeControllerSnapshot {
  readonly activePaletteIdentity: string | null;
  readonly eligible: boolean;
  readonly live: boolean;
  readonly pendingTimers: number;
  readonly pendingWaits: number;
  readonly readInFlight: boolean;
  readonly readRequested: boolean;
  readonly reapplyQueued: boolean;
  readonly started: boolean;
  readonly stopReason: PaletteBridgeStopReason | null;
}

export class PaletteBridgeController {
  readonly #enqueueMicrotask: (callback: () => void) => void;
  readonly #eligible: boolean;
  readonly #file: PaletteFilePort | null;
  readonly #onError: (error: unknown) => void;
  readonly #onPaletteApplied: (palette: Palette) => void;
  readonly #scope: GenerationScope;
  readonly #view: PaletteStyleView | null;
  #activePalette: Palette | null = null;
  #activePaletteIdentity: string | null = null;
  #lastUpdateFailure: string | null = null;
  #pathRevision = 0;
  #pollCancel: (() => void) | null = null;
  #readInFlight = false;
  #readRequested = false;
  #reapplyQueued = false;
  #reapplyRevision = 0;
  #started = false;
  #stopReason: PaletteBridgeStopReason | null = null;

  constructor({
    eligible,
    enqueueMicrotask,
    file,
    onError,
    onPaletteApplied,
    timers,
    view,
  }: PaletteBridgeControllerOptions) {
    if (eligible && (!file || !view)) {
      throw new Error("eligible Palette Bridge windows require file and style ports");
    }
    this.#enqueueMicrotask =
      enqueueMicrotask ?? (callback => globalThis.queueMicrotask(callback));
    this.#eligible = eligible;
    this.#file = file ?? null;
    this.#onError = error => {
      try {
        onError?.(error);
      } catch {}
    };
    this.#onPaletteApplied = palette => {
      try {
        onPaletteApplied?.(palette);
      } catch {}
    };
    this.#scope = new GenerationScope({
      onDisposeError: this.#onError,
      timers,
    });
    this.#view = view ?? null;
    if (eligible) {
      this.#scope.defer(() => this.#view?.dispose());
    }
  }

  defer(disposer: () => unknown): void {
    this.#scope.defer(disposer);
  }

  isLive(): boolean {
    return this.#scope.isLive();
  }

  snapshot(): PaletteBridgeControllerSnapshot {
    return {
      activePaletteIdentity: this.#activePaletteIdentity,
      eligible: this.#eligible,
      live: this.isLive(),
      pendingTimers: this.#scope.pendingTimers,
      pendingWaits: this.#scope.pendingWaits,
      readInFlight: this.#readInFlight,
      readRequested: this.#readRequested,
      reapplyQueued: this.#reapplyQueued,
      started: this.#started,
      stopReason: this.#stopReason,
    };
  }

  start(): boolean {
    if (this.#started || !this.isLive()) {
      return false;
    }
    this.#started = true;
    if (this.#eligible) {
      this.#beginRead();
    }
    return true;
  }

  pathChanged(): boolean {
    if (!this.#eligible || !this.#started || !this.isLive()) {
      return false;
    }
    this.#pathRevision += 1;
    this.#readRequested = true;
    this.#pollCancel?.();
    this.#pollCancel = null;
    if (!this.#readInFlight) {
      this.#beginRead();
    }
    return true;
  }

  requestReapply(): boolean {
    if (
      !this.#eligible ||
      !this.isLive() ||
      !this.#activePalette ||
      this.#reapplyQueued
    ) {
      return false;
    }
    this.#reapplyQueued = true;
    const revision = ++this.#reapplyRevision;
    try {
      this.#enqueueMicrotask(() => {
        if (!this.isLive() || revision !== this.#reapplyRevision) {
          return;
        }
        this.#reapplyQueued = false;
        const palette = this.#activePalette;
        const view = this.#view;
        if (!palette || !view) {
          return;
        }
        try {
          if (!view.apply(palette)) {
            throw new Error("palette style view is stopped");
          }
        } catch (error) {
          this.#onError(error);
          this.stop("platform-failure");
        }
      });
    } catch (error) {
      this.#reapplyQueued = false;
      this.#onError(error);
      this.stop("platform-failure");
      return false;
    }
    return true;
  }

  stop(reason: PaletteBridgeStopReason = "manual"): boolean {
    if (!this.isLive()) {
      return false;
    }
    this.#stopReason = reason;
    this.#pollCancel = null;
    this.#readInFlight = false;
    this.#readRequested = false;
    this.#activePalette = null;
    this.#reapplyQueued = false;
    this.#reapplyRevision += 1;
    return this.#scope.stop();
  }

  #beginRead(): void {
    if (this.#readInFlight || !this.isLive()) {
      return;
    }
    this.#readInFlight = true;
    this.#readRequested = false;
    void this.#readAndSchedule(this.#pathRevision);
  }

  async #readAndSchedule(pathRevision: number): Promise<void> {
    await this.#loadOnce(pathRevision);
    this.#readInFlight = false;
    if (!this.isLive()) {
      return;
    }
    if (this.#readRequested) {
      this.#beginRead();
      return;
    }
    this.#pollCancel = this.#scope.schedule(PALETTE_POLL_INTERVAL_MS, () => {
      this.#pollCancel = null;
      this.#beginRead();
    });
  }

  async #loadOnce(pathRevision: number): Promise<void> {
    const file = this.#file;
    const view = this.#view;
    if (!file || !view) {
      return;
    }
    let value: unknown;
    try {
      const path = file.currentPath();
      const result = await this.#scope.wait(file.read(path));
      if (result.kind === "stopped") {
        return;
      }
      value = result.value;
    } catch (error) {
      if (this.isLive() && pathRevision === this.#pathRevision) {
        this.#reportUpdateFailure(`read:${failureIdentity(error)}`, error);
      }
      return;
    }
    if (!this.isLive() || pathRevision !== this.#pathRevision) {
      return;
    }
    const parsed = parsePalette(value);
    if (!parsed.ok) {
      this.#reportUpdateFailure(`validation:${parsed.error}`, new Error(parsed.error));
      return;
    }
    this.#lastUpdateFailure = null;
    const nextIdentity = paletteIdentity(parsed.palette);
    if (this.#activePaletteIdentity === nextIdentity) {
      return;
    }
    try {
      if (!view.apply(parsed.palette)) {
        throw new Error("palette style view is stopped");
      }
      this.#activePaletteIdentity = nextIdentity;
      this.#activePalette = parsed.palette;
      this.#onPaletteApplied(parsed.palette);
    } catch (error) {
      this.#onError(error);
      this.stop("platform-failure");
    }
  }

  #reportUpdateFailure(key: string, error: unknown): void {
    if (this.#lastUpdateFailure === key) {
      return;
    }
    this.#lastUpdateFailure = key;
    this.#onError(error);
  }
}
