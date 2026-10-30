/**
 * tzdata 2026c made Alberta permanent UTC-6 from 2026-11-01, so what
 * America/Edmonton does that day depends on the runtime's tzdata release.
 * The era comes from the release name rather than from probing Intl: a probe
 * would let a runtime with wrong Alberta rules file itself under whichever era
 * matches its wrong answer, and the era's assertions would then agree with it.
 *
 * The apps/api twin lives in its calendar normalization test.
 */
export function tzdataEra(release: string | undefined): "pre-2026c" | "2026c+" | null {
  const match = /^(\d{4})([a-z])$/.exec(release ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  return year < 2026 || (year === 2026 && match[2] < "c")
    ? "pre-2026c"
    : "2026c+";
}

export const TZDATA_RELEASE = process.versions.tz;
export const TZDATA_ERA = tzdataEra(TZDATA_RELEASE);
