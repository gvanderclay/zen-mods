import {
  GenerationScope,
  type TimerPort,
} from "@zen-mods/sine-lifecycle/generation-scope";
import type { SineWindowGenerationStopReason } from "@zen-mods/sine-lifecycle/sine-window";
import { paletteIdentity, parsePalette } from "./core/palette.ts";
import type { PaletteStyleView } from "./platform/styles.ts";

export type PaletteBridgeStopReason = SineWindowGenerationStopReason | "platform-failure";

export interface PaletteFilePort {
  currentPath(): string;
  read(path: string): PromiseLike<unknown> | unknown;
}

export interface PaletteBridgeControllerOptions {
  readonly eligible: boolean;
  readonly file?: PaletteFilePort;
  readonly onError?: (error: unknown) => void;
  readonly timers: TimerPort;
  readonly view?: PaletteStyleView;
}

export interface PaletteBridgeControllerSnapshot {
  readonly activePaletteIdentity: string | null;
  readonly eligible: boolean;
  readonly live: boolean;
  readonly pendingTimers: number;
  readonly pendingWaits: number;
  readonly started: boolean;
  readonly stopReason: PaletteBridgeStopReason | null;
}

export class PaletteBridgeController {
  readonly #eligible: boolean;
  readonly #file: PaletteFilePort | null;
  readonly #onError: (error: unknown) => void;
  readonly #scope: GenerationScope;
  readonly #view: PaletteStyleView | null;
  #activePaletteIdentity: string | null = null;
  #started = false;
  #stopReason: PaletteBridgeStopReason | null = null;

  constructor({ eligible, file, onError, timers, view }: PaletteBridgeControllerOptions) {
    if (eligible && (!file || !view)) {
      throw new Error("eligible Palette Bridge windows require file and style ports");
    }
    this.#eligible = eligible;
    this.#file = file ?? null;
    this.#onError = error => {
      try {
        onError?.(error);
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
      void this.#loadInitial();
    }
    return true;
  }

  stop(reason: PaletteBridgeStopReason = "manual"): boolean {
    if (!this.isLive()) {
      return false;
    }
    this.#stopReason = reason;
    return this.#scope.stop();
  }

  async #loadInitial(): Promise<void> {
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
      if (this.isLive()) {
        this.#onError(error);
      }
      return;
    }
    if (!this.isLive()) {
      return;
    }
    const parsed = parsePalette(value);
    if (!parsed.ok) {
      this.#onError(new Error(parsed.error));
      return;
    }
    try {
      if (!view.apply(parsed.palette)) {
        throw new Error("palette style view is stopped");
      }
      this.#activePaletteIdentity = paletteIdentity(parsed.palette);
    } catch (error) {
      this.#onError(error);
      this.stop("platform-failure");
    }
  }
}
