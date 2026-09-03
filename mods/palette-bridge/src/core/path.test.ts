import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PALETTE_RELATIVE_PATH,
  PALETTE_PATH_PREFERENCE,
  resolvePalettePath,
} from "./path.ts";

describe("palette path", () => {
  it("uses the profile chrome file when the override is empty", () => {
    const join = vi.fn((...segments: string[]) => segments.join("/"));

    expect(resolvePalettePath("profile", "", join)).toBe(
      "profile/chrome/palette-bridge.json",
    );
    expect(join).toHaveBeenCalledWith("profile", ...DEFAULT_PALETTE_RELATIVE_PATH);
    expect(PALETTE_PATH_PREFERENCE).toBe("zen.palette-bridge.path");
  });

  it("uses a non-empty override without changing it", () => {
    const join = vi.fn((...segments: string[]) => segments.join("/"));
    const override = " /custom/palette.json ";

    expect(resolvePalettePath("profile", override, join)).toBe(override);
    expect(join).not.toHaveBeenCalled();
  });
});
