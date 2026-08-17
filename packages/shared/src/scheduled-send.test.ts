/**
 * #233 — the parts of send later that are wrong silently.
 *
 * "Tomorrow 8am" landing at 7am is not an error anybody sees in a log. It is a
 * text arriving an hour before a customer is awake, twice a year, in one
 * timezone. So the DST cases are pinned with real instants rather than a
 * property nobody can check by reading.
 */
import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

import { describe, expect, it } from "vitest";

import {
  SCHEDULED_HOLD_REASONS,
  SCHEDULED_MESSAGE_STATUSES,
  isScheduledMessageLive,
  schedulePresets,
  scheduledClockProvenance,
  scheduledReasonRecovers,
  SCHEDULED_HOLD_REASON_KEYS,
  scheduledHoldText,
} from "./scheduled-send";

/**
 * #228 — the presets take the reader's resolver now, so the tests supply one.
 *
 * English here: these cases are about WHEN a preset lands, and a French label
 * would not make a DST assertion any truer. The words themselves are asserted
 * in both languages in their own case at the bottom of this block.
 */
const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);

function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}


/** The local wall-clock hour of an instant, in a zone. */
function hourIn(instant: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(instant),
  ) % 24;
}

function weekdayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    instant,
  );
}

describe("#233 presets land on the destination's wall clock", () => {
  it("means 8am where the customer is, not 8am here", () => {
    // Mid-afternoon UTC, which is still the morning in Los Angeles — the case
    // where "tomorrow" is ambiguous if you do the arithmetic in the wrong zone.
    const now = new Date("2026-06-15T21:00:00Z");
    const [tomorrow] = schedulePresets(now, "America/Los_Angeles", sayEn);
    expect(tomorrow.at).not.toBeNull();
    expect(hourIn(tomorrow.at as Date, "America/Los_Angeles")).toBe(8);
  });

  it("is still 8am across the spring-forward boundary", () => {
    // 2026-03-08 is when US clocks jump 2am -> 3am. A fixed-offset
    // implementation returns 9am here and nobody notices until a customer does.
    const now = new Date("2026-03-07T12:00:00Z");
    const [tomorrow] = schedulePresets(now, "America/New_York", sayEn);
    expect(hourIn(tomorrow.at as Date, "America/New_York")).toBe(8);
  });

  it("is still 8am across the fall-back boundary", () => {
    // 2026-11-01, clocks go back. The mirror of the case above, and the one
    // that produces a 7am text.
    const now = new Date("2026-10-31T12:00:00Z");
    const [tomorrow] = schedulePresets(now, "America/New_York", sayEn);
    expect(hourIn(tomorrow.at as Date, "America/New_York")).toBe(8);
  });

  it("lands Monday on a Monday, in that zone", () => {
    const now = new Date("2026-06-17T15:00:00Z"); // a Wednesday
    const monday = schedulePresets(now, "America/New_York", sayEn)[1];
    expect(weekdayIn(monday.at as Date, "America/New_York")).toBe("Mon");
    expect(hourIn(monday.at as Date, "America/New_York")).toBe(8);
  });

  it("means NEXT Monday when today is already Monday", () => {
    // Otherwise "Monday 8am" on a Monday afternoon is a time that has passed,
    // which the API would reject as in_the_past — a preset that cannot be used.
    const now = new Date("2026-06-15T18:00:00Z"); // Monday
    const monday = schedulePresets(now, "America/New_York", sayEn)[1];
    expect(weekdayIn(monday.at as Date, "America/New_York")).toBe("Mon");
    expect((monday.at as Date).getTime()).toBeGreaterThan(now.getTime());
  });

  it("never offers a preset that is already in the past", () => {
    // Every hour of one day, in a zone well behind UTC. A preset the API would
    // refuse is worse than no preset.
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(Date.UTC(2026, 5, 15, hour));
      for (const preset of schedulePresets(now, "America/Los_Angeles", sayEn)) {
        if (preset.at) expect(preset.at.getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });

  it("offers two presets and a way out, in that order", () => {
    // Two, not five: a list long enough to read is slower than the picker it
    // replaced.
    const presets = schedulePresets(new Date("2026-06-15T12:00:00Z"), "UTC", sayEn);
    expect(presets.map((p) => p.id)).toEqual(["tomorrow", "monday", "custom"]);
    expect(presets[2].at).toBeNull();
  });

  it("says the presets in the reader's language (#228)", () => {
    // The failure this replaces: the labels were English inside the shared
    // module, so a French member opened the menu and read "Tomorrow, 8:00am"
    // above a French confirmation sentence.
    const en = schedulePresets(new Date("2026-06-15T12:00:00Z"), "UTC", sayEn);
    const fr = schedulePresets(new Date("2026-06-15T12:00:00Z"), "UTC", sayFr);
    expect(en.map((p) => p.label)).toEqual([
      "Tomorrow, 8:00am",
      "Monday, 8:00am",
      "Pick a time",
    ]);
    for (const [i, preset] of fr.entries()) {
      expect(preset.label, `${preset.id} is not translated`).not.toBe(
        en[i].label,
      );
      // And it is words, not the key falling through the resolver.
      expect(preset.label).not.toMatch(/^domain\./);
    }
  });

});

describe("#233 what we tell somebody when it did not send", () => {
  it("has copy for every reason, and none of it is a code", () => {
    for (const [reason, copy] of Object.entries(SCHEDULED_HOLD_REASONS)) {
      expect(copy.length, `${reason} has no copy`).toBeGreaterThan(20);
      expect(copy, `${reason} reads like a code`).toMatch(/[a-z] [a-z]/);
      expect(copy.trim()).toBe(copy);
    }
  });

  it("does not promise a retry against something that will never change", () => {
    // The distinction that matters: a recoverable reason means the firing job
    // holds and tries again. Marking an opt-out recoverable would retry against
    // a STOP forever — and the copy would be promising to send a message that
    // must never go.
    expect(scheduledReasonRecovers("recipient_opted_out")).toBe(false);
    expect(scheduledReasonRecovers("invalid_destination")).toBe(false);
    expect(scheduledReasonRecovers("expired")).toBe(false);
    expect(scheduledReasonRecovers("workspace_closed")).toBe(false);

    expect(scheduledReasonRecovers("subscription_inactive")).toBe(true);
    expect(scheduledReasonRecovers("registration_pending")).toBe(true);
    expect(scheduledReasonRecovers("service_unavailable")).toBe(true);
    expect(scheduledReasonRecovers("customer_replied")).toBe(true);
  });

  it("offers no remedy for the one that has none", () => {
    // Binding: an opt-out can only be lifted by the customer. Copy that hinted
    // otherwise would be teaching an owner to try to work around a STOP.
    expect(SCHEDULED_HOLD_REASONS.recipient_opted_out).toMatch(/only they can/i);
  });

  it("classifies every status as live or done, with none missed", () => {
    const live = SCHEDULED_MESSAGE_STATUSES.filter(isScheduledMessageLive);
    expect([...live].sort()).toEqual(["held", "pending"]);
  });
});

describe("#233 whose clock it was", () => {
  /*
   * #228 — the function names keys now, so these resolve them.
   *
   * Through the catalogue the scheduled rows read, which is a better test than
   * the one it replaces: that read the module's own English back to itself,
   * and this reads what somebody is actually shown.
   */
  const say = (key: string): string => {
    const [section, name] = key.split(".");
    const value = (WEB_EN as Record<string, Record<string, string>>)[section]?.[name];
    if (typeof value !== "string") throw new Error(`no English for ${key}`);
    return value;
  };
  const sayFr = (key: string): string => {
    const [section, name] = key.split(".");
    const value = (WEB_FR as Record<string, Record<string, string>>)[section]?.[name];
    if (typeof value !== "string") throw new Error(`no French for ${key}`);
    return value;
  };

  it("admits the weakest rung is our own clock", () => {
    // Scheduling "Monday 8am" against a non-geographic number with no contact
    // override is the SHOP's 8am. A UI that hides that implies a precision the
    // product does not have.
    expect(say(scheduledClockProvenance("company"))).toMatch(/we don't know theirs/);
    expect(say(scheduledClockProvenance("contact"))).toMatch(/their time/);
    expect(say(scheduledClockProvenance("area_code"))).toMatch(/area code/);
  });

  it("uses the same words as the thread's own time line", () => {
    // One vocabulary for one fact. `their-time.tsx` says "from their area code"
    // and "your workspace's timezone — we don't know theirs"; a second phrasing
    // here would be the product describing the same rung two ways.
    expect(say(scheduledClockProvenance("area_code"))).toContain(
      "from their area code",
    );
    expect(say(scheduledClockProvenance("company"))).toContain(
      "we don't know theirs",
    );
  });

  it("keeps the weakest rung honest in French too", () => {
    // The admission is the whole point of this rung, and it is the kind of
    // clause a translator smooths away. "nous ne connaissons pas" has to
    // survive, or the French app claims a precision the English one refuses.
    const three = (["contact", "area_code", "company"] as const).map((source) =>
      sayFr(scheduledClockProvenance(source)),
    );
    for (const line of three) expect(line.length).toBeGreaterThan(8);
    // All three distinct: a catalogue that answered one sentence for every rung
    // would pass every assertion above and say nothing.
    expect(new Set(three).size).toBe(3);
    expect(three[2]).toMatch(/ne connaissons pas|ne savons pas/i);
  });
});

/**
 * #228 — the hold reason, as a key.
 *
 * The failure these exist to stop is a reason gaining a sentence and no key (a
 * French reader gets English) or a key and no sentence (a build that predates
 * the key gets nothing at all). Both are silent, and both land on the one
 * screen where the product is delivering bad news.
 */
describe("SCHEDULED_HOLD_REASON_KEYS", () => {
  it("covers exactly the reasons that have sentences, both directions", () => {
    // Set equality. A reason added to one map and not the other is the whole
    // failure mode, and `satisfies` only catches the missing-key half.
    expect(Object.keys(SCHEDULED_HOLD_REASON_KEYS).sort()).toEqual(
      Object.keys(SCHEDULED_HOLD_REASONS).sort(),
    );
  });

  it("names a distinct key per reason", () => {
    // Two reasons sharing a key is two different situations telling somebody
    // the same thing, which is the confusion the reason roster exists to stop.
    const keys = Object.values(SCHEDULED_HOLD_REASON_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("scheduledHoldText", () => {
  const words = (key: string) =>
    key === "domain.scheduledHoldExpired" ? "La fenêtre est passée." : key;

  it("prefers the reader's language over the stored English", () => {
    expect(
      scheduledHoldText("domain.scheduledHoldExpired", "The send window passed.", words),
    ).toBe("La fenêtre est passée.");
  });

  it("falls back to the stored English for a key it has no words for", () => {
    // The catalogue fails OPEN: a missing key resolves to itself. Rendering
    // `scheduled.holdWorkspacePaused` at somebody is worse than English.
    expect(
      scheduledHoldText(
        "domain.scheduledHoldWorkspacePaused",
        "Your plan is paused.",
        words,
      ),
    ).toBe("Your plan is paused.");
  });

  it("still says something for a row written before keys existed", () => {
    expect(scheduledHoldText(null, "Your plan is paused.", words)).toBe(
      "Your plan is paused.",
    );
  });

  it("says nothing when there is nothing to say", () => {
    expect(scheduledHoldText(null, null, words)).toBeNull();
  });
});
