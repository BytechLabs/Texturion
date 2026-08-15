import { describe, expect, it } from "vitest";

import {
  isOnCallNow,
  onCallSilenceWarning,
} from "./on-call-notifications";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names keys now, so the tests resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);


const ME = "u-me";
const SOMEBODY = "u-else";

function shift(
  user_id: string,
  starts_at: string,
  ends_at: string,
): { user_id: string; starts_at: string; ends_at: string } {
  return { user_id, starts_at, ends_at };
}

/** Inside the shifts below. */
const NOW = new Date("2026-08-11T18:00:00Z");

describe("isOnCallNow (#538 audit)", () => {
  it("is true inside my own shift", () => {
    expect(
      isOnCallNow(
        [shift(ME, "2026-08-11T12:00:00Z", "2026-08-12T00:00:00Z")],
        ME,
        NOW,
      ),
    ).toBe(true);
  });

  it("is false for somebody else's shift", () => {
    // The warning is about the person holding the phone, not about the workspace
    // having a rota at all.
    expect(
      isOnCallNow(
        [shift(SOMEBODY, "2026-08-11T12:00:00Z", "2026-08-12T00:00:00Z")],
        ME,
        NOW,
      ),
    ).toBe(false);
  });

  it("is false before it starts and after it ends", () => {
    expect(
      isOnCallNow([shift(ME, "2026-08-11T19:00:00Z", "2026-08-12T00:00:00Z")], ME, NOW),
    ).toBe(false);
    expect(
      isOnCallNow([shift(ME, "2026-08-11T06:00:00Z", "2026-08-11T12:00:00Z")], ME, NOW),
    ).toBe(false);
  });

  it("treats the end as exclusive, so back-to-back shifts do not overlap", () => {
    // Two people handing over at 18:00 must not both count as on call for that
    // instant, or the handover minute warns the wrong person.
    const handover = new Date("2026-08-11T18:00:00Z");
    expect(
      isOnCallNow([shift(ME, "2026-08-11T12:00:00Z", "2026-08-11T18:00:00Z")], ME, handover),
    ).toBe(false);
    expect(
      isOnCallNow([shift(ME, "2026-08-11T18:00:00Z", "2026-08-12T00:00:00Z")], ME, handover),
    ).toBe(true);
  });

  it("ignores a shift with an unreadable stamp rather than assuming it covers now", () => {
    // A warning that fires wrongly is one people learn to dismiss, which costs more
    // than the one it was meant to prevent.
    expect(isOnCallNow([shift(ME, "not a date", "also not")], ME, NOW)).toBe(false);
  });

  it("is false with no shifts at all", () => {
    expect(isOnCallNow([], ME, NOW)).toBe(false);
  });
});

describe("onCallSilenceWarning (#538 audit)", () => {
  it("warns when somebody on call switches a channel off", () => {
    const warning = onCallSilenceWarning(true, true, "push", sayEn)!;
    expect(warning).toContain("on call right now");
    // Says what is actually lost — the pages reach nothing — and that nobody else
    // finds out, which is the part that makes it a customer problem.
    expect(warning).toContain("go nowhere");
    expect(warning).toContain("no one else is told");
    // And offers the way out rather than only the objection.
    expect(warning).toContain("Hand the shift over");
  });

  it("names the channel being switched off", () => {
    expect(onCallSilenceWarning(true, true, "push", sayEn)).toContain("Push alerts");
    expect(onCallSilenceWarning(true, true, "email", sayEn)).toContain("Emails");
  });

  it("says nothing when I am not on call", () => {
    expect(onCallSilenceWarning(false, true, "push", sayEn)).toBeNull();
  });

  it("says nothing when I am switching something ON", () => {
    // Turning notifications back on is the good outcome. A dialog there would be
    // punishing the fix.
    expect(onCallSilenceWarning(true, false, "push", sayEn)).toBeNull();
  });
});

describe("#228 the warning in French", () => {
  it("carries the article on the channel, which is why it is a key", () => {
    // "LES alertes push sont…" and "LES courriels sont…". A bare English
    // "Push alerts" dropped into the French sentence would read "Vous êtes de
    // garde. Push alerts sont…", which is the shape a half-translated string
    // always takes.
    const push = onCallSilenceWarning(true, true, "push", sayFr)!;
    const email = onCallSilenceWarning(true, true, "email", sayFr)!;
    expect(push).toContain("Les alertes push");
    expect(email).toContain("Les courriels");
    expect(push, "a variable survived the fill").not.toMatch(/\{/);
    expect(push).not.toBe(email);
  });

  it("still says nobody else is told", () => {
    // The half that makes this a warning rather than a setting description: a
    // page that goes nowhere is not escalated to anyone.
    expect(onCallSilenceWarning(true, true, "push", sayEn)).toMatch(
      /no one else is told/i,
    );
    expect(onCallSilenceWarning(true, true, "push", sayFr)).toMatch(
      /personne d'autre n'est prévenu/i,
    );
  });

  it("says nothing when the reader is not on call, in either language", () => {
    expect(onCallSilenceWarning(false, true, "push", sayEn)).toBeNull();
    expect(onCallSilenceWarning(false, true, "push", sayFr)).toBeNull();
  });
});
