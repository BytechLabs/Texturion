/**
 * #292 / D49 — the destination clock.
 *
 * Two things are being pinned. The ladder: which rung answered, and that it
 * never runs out of rungs. And the arithmetic on the two days a year it can go
 * wrong — the morning that skips an hour, and the one that has an hour twice.
 * Those are the days a reminder scheduled last week fires sixty minutes off,
 * and nobody finds out until a customer is woken up.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import {
  isQuietHour,
  nextSendableInstant,
  resolveDestinationClock,
} from "./destination-clock";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";

/** 613 is Ottawa: America/Toronto. 780 is Edmonton: America/Edmonton. */
const OTTAWA = "+16135551000";
const EDMONTON = "+17805551000";
/** 521 is a US non-geographic services code — no region, and so no clock. */
const NON_GEOGRAPHIC = "+15215551000";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function world(options: { contactTimezone?: string; companyTimezone?: string } = {}) {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/contacts", () =>
    options.contactTimezone ? [{ timezone: options.contactTimezone }] : [],
  );
  sb.on("GET", "/rest/v1/companies", () => [
    { timezone: options.companyTimezone ?? "America/Vancouver" },
  ]);
  stubFetch(sb.route);
  return { sb, db: getDb(env) };
}

describe("the D49 ladder", () => {
  it("prefers a person's correction over the area code", async () => {
    // The case the issue is about: a mobile number keeps its original code
    // when its owner moves provinces, and a dispatcher who knows had no way to
    // say so. 21:00 in Ottawa is 19:00 in Edmonton — quiet under the
    // inference, fine under the truth.
    const { db } = world({ contactTimezone: "America/Edmonton" });

    const clock = await resolveDestinationClock(db, {
      companyId: COMPANY_ID,
      phoneE164: OTTAWA,
      atUtc: new Date("2026-07-27T01:00:00Z"), // 21:00 Toronto, 19:00 Edmonton
    });

    expect(clock).toMatchObject({
      timezone: "America/Edmonton",
      source: "contact",
      localHour: 19,
      quiet: false,
    });
  });

  it("falls back to the area code when nobody has corrected it", async () => {
    const { db } = world();

    const clock = await resolveDestinationClock(db, {
      companyId: COMPANY_ID,
      phoneE164: EDMONTON,
      atUtc: new Date("2026-07-27T01:00:00Z"),
    });

    expect(clock).toMatchObject({
      timezone: "America/Edmonton",
      source: "area_code",
      localHour: 19,
      quiet: false,
    });
  });

  it("falls back to the shop's clock when the area code has no region", async () => {
    // A non-geographic US code passes the destination gate and has no
    // timezone. The old shape returned null and left every caller to invent a
    // policy; an automated path that invents "send anyway" texts at 3am.
    const { db } = world({ companyTimezone: "America/Vancouver" });

    const clock = await resolveDestinationClock(db, {
      companyId: COMPANY_ID,
      phoneE164: NON_GEOGRAPHIC,
      atUtc: new Date("2026-07-27T01:00:00Z"), // 18:00 Vancouver
    });

    expect(clock).toMatchObject({
      timezone: "America/Vancouver",
      source: "company",
      localHour: 18,
      quiet: false,
    });
  });

  it("always answers, whatever it is handed", async () => {
    // The property the automated paths depend on: there is no input for which
    // the resolver declines to say what time it is.
    const { db } = world();
    for (const phone of [OTTAWA, EDMONTON, NON_GEOGRAPHIC, "+15005550006", "nonsense"]) {
      const clock = await resolveDestinationClock(db, {
        companyId: COMPANY_ID,
        phoneE164: phone,
        atUtc: new Date("2026-07-27T01:00:00Z"),
      });
      expect(clock.timezone).toBeTruthy();
      expect(clock.localHour).toBeGreaterThanOrEqual(0);
      expect(clock.localHour).toBeLessThanOrEqual(23);
    }
  });

  it("takes a caller's already-loaded values instead of querying again", async () => {
    const { sb, db } = world();

    await resolveDestinationClock(db, {
      companyId: COMPANY_ID,
      phoneE164: NON_GEOGRAPHIC,
      contactTimezone: null, // known to have none — do not go and ask
      companyTimezone: "America/Halifax",
      atUtc: new Date("2026-07-27T01:00:00Z"),
    });

    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/companies")).toHaveLength(0);
  });
});

describe("quiet hours are half-open: 08:00 in, 20:00 out", () => {
  it("draws the boundary where D4 does", () => {
    expect(isQuietHour(7)).toBe(true);
    expect(isQuietHour(8)).toBe(false);
    expect(isQuietHour(19)).toBe(false);
    expect(isQuietHour(20)).toBe(true);
    expect(isQuietHour(0)).toBe(true);
  });
});

describe("daylight saving, on the two days it matters", () => {
  // North America 2026: spring forward Sunday 8 March, fall back Sunday
  // 1 November. Toronto is EST (UTC-5) / EDT (UTC-4).

  it("survives the hour that does not exist", async () => {
    // 2am–3am local never happens on 8 March. An instant inside the skipped
    // range still HAS a local hour — 07:30 UTC is 03:30 EDT, not 02:30 — and
    // offset arithmetic that added -5 would have said 02:30, an hour that did
    // not occur.
    const { db } = world();

    const before = await resolveDestinationClock(db, {
      companyId: COMPANY_ID,
      phoneE164: OTTAWA,
      atUtc: new Date("2026-03-08T06:30:00Z"), // 01:30 EST
    });
    const after = await resolveDestinationClock(db, {
      companyId: COMPANY_ID,
      phoneE164: OTTAWA,
      atUtc: new Date("2026-03-08T07:30:00Z"), // 03:30 EDT — 02:30 never existed
    });

    expect(before.localHour).toBe(1);
    expect(after.localHour).toBe(3);
    // Both are quiet, which is the answer that matters: the transition must not
    // open a hole in the window.
    expect(before.quiet).toBe(true);
    expect(after.quiet).toBe(true);
  });

  it("survives the hour that happens twice", async () => {
    // 1 November: 01:00–02:00 EDT, then 01:00–02:00 EST. Both are hour 1, and
    // both are quiet — the doubled hour must not be counted as leaving the
    // window and re-entering it.
    const { db } = world();

    const first = await resolveDestinationClock(db, {
      companyId: COMPANY_ID,
      phoneE164: OTTAWA,
      atUtc: new Date("2026-11-01T05:30:00Z"), // 01:30 EDT
    });
    const second = await resolveDestinationClock(db, {
      companyId: COMPANY_ID,
      phoneE164: OTTAWA,
      atUtc: new Date("2026-11-01T06:30:00Z"), // 01:30 EST, an hour later
    });

    expect(first.localHour).toBe(1);
    expect(second.localHour).toBe(1);
    expect(first.quiet).toBe(true);
    expect(second.quiet).toBe(true);
  });

  it("opens the window at 8am local on a spring-forward morning, not 7 or 9", async () => {
    // The reminder case from the issue: scheduled before the transition,
    // firing after it. 8am EDT on 8 March is 12:00 UTC — a fixed-offset
    // calculation using EST would produce 13:00 UTC and text an hour late,
    // or 11:00 UTC and text at 7am.
    const opens = nextSendableInstant(
      "America/Toronto",
      new Date("2026-03-08T06:30:00Z"), // 01:30 EST, deep in quiet hours
    );
    expect(opens?.toISOString()).toBe("2026-03-08T12:00:00.000Z");
  });

  it("opens the window at 8am local on a fall-back morning", async () => {
    // Same day, the other direction: 8am EST on 1 November is 13:00 UTC.
    const opens = nextSendableInstant(
      "America/Toronto",
      new Date("2026-11-01T05:30:00Z"), // 01:30 EDT
    );
    expect(opens?.toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });

  it("returns null when it is already fine to send", () => {
    // "Not yet" is the only case with an answer. A caller that treats null as
    // "never" would hold every daytime message forever.
    expect(
      nextSendableInstant("America/Toronto", new Date("2026-07-27T16:00:00Z")),
    ).toBeNull();
  });

  it("opens at 8am tomorrow when asked in the evening", () => {
    // 21:00 Toronto on a Monday → 08:00 Toronto on the Tuesday.
    const opens = nextSendableInstant(
      "America/Toronto",
      new Date("2026-07-28T01:00:00Z"), // 21:00 Mon 27 July EDT
    );
    expect(opens?.toISOString()).toBe("2026-07-28T12:00:00.000Z");
  });

  it("handles a half-hour zone", () => {
    // Newfoundland is UTC-3:30 / -2:30. A resolver doing integer-hour offset
    // arithmetic gets this wrong every single time, not twice a year.
    const opens = nextSendableInstant(
      "America/St_Johns",
      new Date("2026-07-28T03:00:00Z"), // 00:30 NDT
    );
    expect(opens?.toISOString()).toBe("2026-07-28T10:30:00.000Z");
  });
});

/**
 * The #331 discipline, applied here: one resolver, and a roll call of who is
 * allowed to decide. An automated path that re-derives quiet hours from the
 * area code would compile, pass its own tests, and text somebody at 3am.
 */
describe("only the resolver decides quiet hours (#292)", () => {
  const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

  /** The resolver itself, which is allowed to know the numbers. */
  const THE_RESOLVER = "messaging/destination-clock.ts";

  function productionSources(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
        found.push(full);
      }
    };
    walk(SRC);
    return found;
  }

  const repoPath = (file: string) =>
    relative(SRC, file).replaceAll("\\", "/");

  it("keeps the 8pm/8am boundary out of every other file", () => {
    // The shape a hand-rolled check takes: an hour compared against both ends
    // of the window. Compose used to carry one; anything that grows a second
    // one will drift from this one and nobody will notice until a customer is
    // woken up.
    const offenders = productionSources()
      .filter((file) => repoPath(file) !== THE_RESOLVER)
      .filter((file) =>
        /(>=\s*20\s*\|\|[^\n]*<\s*8)|(<\s*8\s*\|\|[^\n]*>=\s*20)/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map(repoPath);

    expect(offenders).toEqual([]);
  });

  it("keeps the raw area-code clock out of every other file", () => {
    // `destinationLocalHour` answers null for a number with no geographic
    // code, and every caller then has to invent a policy for it. The resolver
    // is where that policy lives, so nothing else should be asking.
    const offenders = productionSources()
      .filter((file) => repoPath(file) !== THE_RESOLVER)
      .filter((file) =>
        /destinationLocalHour\s*\(/.test(readFileSync(file, "utf8")),
      )
      .map(repoPath);

    expect(offenders).toEqual([]);
  });

  it("names the resolver as the file that does decide", () => {
    // Not a lint rule — a pointer. If this ever fails, the policy moved, and
    // the two assertions above are guarding the wrong file.
    const source = readFileSync(join(SRC, THE_RESOLVER), "utf8");
    expect(source).toContain("QUIET_HOURS_START = 20");
    expect(source).toContain("QUIET_HOURS_END = 8");
  });
});
