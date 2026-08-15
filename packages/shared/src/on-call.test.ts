import { describe, expect, it } from "vitest";

import {
  ALERT_BANNER_COPY,
  ON_CALL_COPY,
  ON_CALL_PRESETS,
  alertTakenLine,
  onCallLine,
  onCallWindow,
} from "./on-call";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/* #228 — this module names keys, so the assertions resolve them. */
function lookUp(table: unknown, key: string, lang: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no ${lang} for ${key}`);
  return value;
}

const say = (key: string): string => lookUp(WEB_EN, key, "English");
const sayFr = (key: string): string => lookUp(WEB_FR, key, "French");

/** Toronto in August: UTC-4, so a -240 minute offset. */
const TORONTO = -240;

/** Wednesday 2026-08-05, 14:00 local (18:00Z). */
const WEDNESDAY_AFTERNOON = new Date("2026-08-05T18:00:00Z");
/** Wednesday 2026-08-05, 21:00 local (01:00Z Thursday). */
const WEDNESDAY_LATE = new Date("2026-08-06T01:00:00Z");
/** Saturday 2026-08-08, 09:00 local. */
const SATURDAY_MORNING = new Date("2026-08-08T13:00:00Z");

/** The local wall clock a UTC instant lands on, for readable assertions. */
function local(iso: string): string {
  return new Date(new Date(iso).getTime() + TORONTO * 60_000)
    .toISOString()
    .slice(0, 16);
}

describe("onCallWindow", () => {
  it("OW-1: tonight is 6pm to 8am, in the crew's own clock", () => {
    const window = onCallWindow("tonight", WEDNESDAY_AFTERNOON, TORONTO);

    expect(local(window.starts_at)).toBe("2026-08-05T18:00");
    expect(local(window.ends_at)).toBe("2026-08-06T08:00");
  });

  it("OW-2: set after 6pm, it starts NOW rather than retroactively", () => {
    // A shift backdated to 6pm would claim responsibility for three hours
    // nobody was holding — including, potentially, a call that already came in
    // and woke the whole crew. The honest start is when somebody accepted it.
    const window = onCallWindow("tonight", WEDNESDAY_LATE, TORONTO);

    expect(local(window.starts_at)).toBe("2026-08-05T21:00");
    expect(local(window.ends_at)).toBe("2026-08-06T08:00");
  });

  it("OW-3: 'this weekend' set ON the weekend means THIS one", () => {
    // Booking eight days out would leave tonight uncovered by the very action
    // taken to cover it — the failure is silent and lands at 2am.
    const window = onCallWindow("weekend", SATURDAY_MORNING, TORONTO);

    expect(local(window.starts_at)).toBe("2026-08-07T18:00");
    expect(local(window.ends_at)).toBe("2026-08-10T08:00");
  });

  it("OW-4: midweek, 'this weekend' is the coming Friday", () => {
    const window = onCallWindow("weekend", WEDNESDAY_AFTERNOON, TORONTO);

    expect(local(window.starts_at)).toBe("2026-08-07T18:00");
    expect(local(window.ends_at)).toBe("2026-08-10T08:00");
  });

  it("OW-5: a week starts now and runs seven days", () => {
    const window = onCallWindow("week", WEDNESDAY_AFTERNOON, TORONTO);

    expect(window.starts_at).toBe(WEDNESDAY_AFTERNOON.toISOString());
    expect(new Date(window.ends_at).getTime()).toBe(
      WEDNESDAY_AFTERNOON.getTime() + 7 * 86_400_000,
    );
  });

  it("OW-6: every window ends after it starts, in every timezone we sell to", () => {
    // The API refuses a backwards window with a 422, so a preset that produced
    // one would be a button that never works — and only in one timezone, which
    // is how it would reach a customer.
    for (const offset of [-480, -420, -360, -300, -240, -210, -180]) {
      for (const preset of ["tonight", "weekend", "week"] as const) {
        for (const day of [3, 4, 5, 6, 7, 8, 9]) {
          const now = new Date(`2026-08-0${day}T13:00:00Z`);
          const window = onCallWindow(preset, now, offset);
          expect(
            new Date(window.ends_at).getTime(),
            `${preset} at offset ${offset} on the ${day}th`,
          ).toBeGreaterThan(new Date(window.starts_at).getTime());
        }
      }
    }
  });
});

describe("#228 the on-call copy reads in both languages", () => {
  it("resolves every preset, every line and every banner state", () => {
    const keys = [
      ...ON_CALL_PRESETS.flatMap((preset) => [preset.label, preset.detail]),
      ...Object.values(ON_CALL_COPY),
      ...Object.values(ALERT_BANNER_COPY),
    ];
    for (const key of keys) {
      expect(say(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key), `${key} is not translated`).not.toBe(say(key));
    }
    expect(keys.length).toBeGreaterThan(12);
  });

  it("gives each preset its own label and its own hours", () => {
    // Three presets sharing a label would satisfy every assertion above while
    // making the picker unusable — and the hours ARE the content here, so two
    // presets sharing a detail is the same defect one line down.
    const labels = ON_CALL_PRESETS.map((preset) => say(preset.label));
    const details = ON_CALL_PRESETS.map((preset) => say(preset.detail));
    expect(new Set(labels).size).toBe(ON_CALL_PRESETS.length);
    expect(new Set(details).size).toBe(ON_CALL_PRESETS.length);
  });

  it("assembles both lines from a template rather than by concatenation", () => {
    // The reason these are template keys: a name and a clause joined with a
    // space is English word order written as code. Asserting the NAME survives
    // and the sentence differs by language is what proves the template is doing
    // the joining rather than the function.
    expect(onCallLine("Dana", "8:00 AM", say)).toContain("Dana");
    expect(onCallLine("Dana", "8:00 AM", say)).toContain("8:00 AM");
    expect(onCallLine("Dana", "8:00 AM", sayFr)).toContain("Dana");
    expect(onCallLine("Dana", "8:00 AM", sayFr)).not.toBe(
      onCallLine("Dana", "8:00 AM", say),
    );

    expect(alertTakenLine("Sam", say)).toContain("Sam");
    expect(alertTakenLine("Sam", sayFr)).toContain("Sam");
    expect(alertTakenLine("Sam", sayFr)).not.toBe(alertTakenLine("Sam", say));
  });

  it("still says nobody is on call as a consequence, not a status", () => {
    // "Nobody is on call" alone is a fact. The sentence exists to say what it
    // COSTS — everyone gets woken — because that is the decision being made.
    expect(say(ON_CALL_COPY.nobody)).toMatch(/wakes everyone/i);
    expect(sayFr(ON_CALL_COPY.nobody)).toMatch(/réveille|tout le monde/i);
  });
});
