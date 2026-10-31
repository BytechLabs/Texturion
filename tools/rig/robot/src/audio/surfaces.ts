/**
 * The coded bursts each rig surface sends.
 *
 * Voice processing removes a steady tone within seconds, so every surface
 * sends 160 ms bursts in one fixed on/off pattern, at its own frequency. The
 * frequency says who is talking and the pattern says it is a code, not noise.
 * None of the frequencies is a keypad tone, a call-progress tone or 2,600 Hz,
 * and the closest two are 200 Hz apart.
 */
export const SURFACE_HZ = {
  robot: 1100,
  "qa-w-owner": 1300,
  "qa-a-dispatcher": 1500,
  "qa-w-technician": 1700,
  "qa-c": 1900,
  pixel: 2300,
  emulator: 2750,
} as const;

export type Surface = keyof typeof SURFACE_HZ;

export const SURFACES = Object.keys(SURFACE_HZ) as Surface[];

export function isSurface(value: unknown): value is Surface {
  return typeof value === "string" && Object.hasOwn(SURFACE_HZ, value);
}

export const SLOT_MS = 160;

/**
 * One cycle of twelve 160 ms slots, 1.92 s. Every burst stands alone between
 * silent slots, and the gaps between bursts differ (1, 2, 3 and 2 slots), so
 * no shift of the pattern but the true one lines up more than half of its
 * bursts. That is what lets the detector find the phase without a clock.
 */
export const PATTERN: readonly (0 | 1)[] = [1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0];

export const CYCLE_MS = SLOT_MS * PATTERN.length;

export const BURSTS_PER_CYCLE = PATTERN.filter((slot) => slot === 1).length;
