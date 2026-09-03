import {
  bindSineWindowLifecycle,
  type SineWindowTarget,
} from "@zen-mods/sine-lifecycle/sine-window";
import type { PaletteBridgeStopReason } from "../runtime.ts";

export interface PaletteBridgeGenerationController {
  defer(disposer: () => unknown): void;
  isLive(): boolean;
  stop(reason?: PaletteBridgeStopReason): boolean;
}

export interface PaletteBridgeGenerationFacade {
  readonly controller: PaletteBridgeGenerationController;
  readonly generationToken: string;
}

export interface PaletteBridgeWindowTarget extends SineWindowTarget {
  zenPaletteBridge?: PaletteBridgeGenerationFacade;
}

export interface StartPaletteBridgeGenerationOptions {
  readonly controller: PaletteBridgeGenerationController;
  readonly generationToken: string;
  readonly onSineUnloadUnavailable?: () => void;
  readonly target: PaletteBridgeWindowTarget;
}

export const startPaletteBridgeGeneration = ({
  controller,
  generationToken,
  onSineUnloadUnavailable,
  target,
}: StartPaletteBridgeGenerationOptions): PaletteBridgeGenerationFacade => {
  target.zenPaletteBridge?.controller.stop("replacement");
  const facade = Object.freeze({ controller, generationToken });
  target.zenPaletteBridge = facade;
  controller.defer(() => {
    if (target.zenPaletteBridge === facade) {
      delete target.zenPaletteBridge;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(target, controller);
    if (binding.sineUnload === "unavailable") {
      onSineUnloadUnavailable?.();
    }
  } catch (error) {
    controller.stop("startup-failure");
    throw error;
  }
  return facade;
};
