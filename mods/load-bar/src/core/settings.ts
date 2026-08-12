export const LOAD_BAR_PREFERENCES = {
  placement: "zen.load-bar.placement",
  thickness: "zen.load-bar.thickness",
  color: "zen.load-bar.color",
  revealDelay: "zen.load-bar.reveal-delay",
} as const;

export const PLACEMENTS = ["top", "bottom"] as const;
export const THICKNESSES = [2, 3, 4] as const;
export const COLOR_SOURCES = ["firefox", "zen"] as const;
export const REVEAL_DELAYS_MS = [0, 100, 200, 500] as const;

export type Placement = (typeof PLACEMENTS)[number];
export type Thickness = (typeof THICKNESSES)[number];
export type ColorSource = (typeof COLOR_SOURCES)[number];
export type RevealDelayMs = (typeof REVEAL_DELAYS_MS)[number];

export interface LoadBarSettings {
  readonly placement: Placement;
  readonly thickness: Thickness;
  readonly color: ColorSource;
  readonly revealDelayMs: RevealDelayMs;
}

export const DEFAULT_SETTINGS = {
  placement: "top",
  thickness: 2,
  color: "firefox",
  revealDelayMs: 200,
} as const satisfies LoadBarSettings;

const THICKNESS_BY_VALUE = {
  "2": 2,
  "3": 3,
  "4": 4,
} as const;

const REVEAL_DELAY_BY_VALUE = {
  "0": 0,
  "100": 100,
  "200": 200,
  "500": 500,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const isChoice = <Choice extends string>(
  value: unknown,
  choices: readonly Choice[],
): value is Choice => typeof value === "string" && choices.includes(value as Choice);

const mappedNumber = <Value extends number>(
  value: unknown,
  choices: Readonly<Record<string, Value>>,
  fallback: Value,
): Value =>
  typeof value === "string" && Object.hasOwn(choices, value)
    ? (choices[value] ?? fallback)
    : fallback;

export const parseLoadBarSettings = (raw: unknown): LoadBarSettings => {
  if (!isRecord(raw)) {
    return DEFAULT_SETTINGS;
  }

  const placement = own(raw, "placement");
  const color = own(raw, "color");
  return {
    placement: isChoice(placement, PLACEMENTS) ? placement : DEFAULT_SETTINGS.placement,
    thickness: mappedNumber(
      own(raw, "thickness"),
      THICKNESS_BY_VALUE,
      DEFAULT_SETTINGS.thickness,
    ),
    color: isChoice(color, COLOR_SOURCES) ? color : DEFAULT_SETTINGS.color,
    revealDelayMs: mappedNumber(
      own(raw, "revealDelay"),
      REVEAL_DELAY_BY_VALUE,
      DEFAULT_SETTINGS.revealDelayMs,
    ),
  };
};
