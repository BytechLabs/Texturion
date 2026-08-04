/**
 * #228 - the language an automated message goes out in.
 *
 * The interesting assertions here are all about the NULL on `contacts.locale`.
 * It means "whatever the business works in", and the cheapest wrong
 * implementation - resolving eagerly and storing the answer per contact - looks
 * identical on the day it ships and diverges the first time an owner changes
 * the company setting.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_AWAY_MESSAGE } from "./away.js";
import { emergencyReplyBody } from "./emergency.js";
import {
  DEFAULT_LOCALE,
  EN_COPY,
  FR_CA_COPY,
  LOCALES,
  LOCALE_LABELS,
  copyFor,
  copyForContact,
  isLocale,
  resolveLocale,
} from "./locale.js";
import { DEFAULT_MCTB_MESSAGE } from "./mctb.js";

describe("#228 resolving the language", () => {
  it("LOC-1 the contact's own language wins", () => {
    expect(resolveLocale("fr-CA", "en")).toBe("fr-CA");
    expect(resolveLocale("en", "fr-CA")).toBe("en");
  });

  it("LOC-2 a contact with no language of its own follows the company", () => {
    // The load-bearing null. Not "English": a Montreal crew set to fr-CA texts
    // French to every customer it has not said otherwise about, including the
    // ones added before the setting existed.
    expect(resolveLocale(null, "fr-CA")).toBe("fr-CA");
    expect(resolveLocale(undefined, "fr-CA")).toBe("fr-CA");
  });

  it("LOC-3 changing the company language moves the contacts that never chose", () => {
    // The property the storage shape exists to preserve, stated as a test so a
    // later "optimisation" that denormalises the resolved value fails here.
    const contacts = [null, undefined, "fr-CA", "en"];
    const before = contacts.map((c) => resolveLocale(c, "en"));
    const after = contacts.map((c) => resolveLocale(c, "fr-CA"));
    expect(before).toEqual(["en", "en", "fr-CA", "en"]);
    expect(after).toEqual(["fr-CA", "fr-CA", "fr-CA", "en"]);
  });

  it("LOC-4 anything unrecognised falls back rather than throwing", () => {
    // This runs on the send path. A row carrying a locale some later migration
    // added must not stop a text reaching a customer.
    expect(resolveLocale("de", "xx")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("", "")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null, null)).toBe(DEFAULT_LOCALE);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("FR-CA")).toBe(false);
  });
});

describe("#228 the copy behind each language", () => {
  it("LOC-5 the English copy is READ from the modules that own it", () => {
    // Not a second literal. Two definitions of the product default drift the
    // first time somebody edits the one they happened to find, which is #414.
    expect(EN_COPY.awayReply).toBe(DEFAULT_AWAY_MESSAGE);
    expect(EN_COPY.missedCallTextBack).toBe(DEFAULT_MCTB_MESSAGE);
  });

  it("LOC-6 every language answers every message", () => {
    // A missing translation must be a build failure, not a customer receiving
    // `undefined` where a sentence should be.
    for (const locale of LOCALES) {
      const copy = copyFor(locale);
      for (const [key, value] of Object.entries(copy)) {
        if (key === "appointmentReminders") continue;
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect((value as string).length, `${locale}.${key}`).toBeGreaterThan(0);
      }
      expect(copy.appointmentReminders.length, locale).toBe(
        EN_COPY.appointmentReminders.length,
      );
    }
    expect(Object.keys(FR_CA_COPY).sort()).toEqual(Object.keys(EN_COPY).sort());
  });

  it("LOC-7 the merge fields survive translation", () => {
    // A translated body that dropped `{business_name}` would send a customer a
    // sentence with a hole in it, and nothing else would notice.
    expect(FR_CA_COPY.missedCallTextBack).toContain("{business_name}");
    expect(FR_CA_COPY.ratingAsk).toContain("{business_name}");
    expect(FR_CA_COPY.identificationSuffix).toContain("{business_name}");
    expect(FR_CA_COPY.appointmentReminders[0].body).toContain("{first_name}");
    expect(FR_CA_COPY.appointmentReminders[0].body).toContain("{job_time}");
  });

  it("LOC-8 the reminder offsets are the same ladder in both languages", () => {
    // The offsets are scheduling, not copy. A translation that changed them
    // would quietly send French customers reminders at different times.
    expect(FR_CA_COPY.appointmentReminders.map((r) => r.offset_minutes)).toEqual(
      EN_COPY.appointmentReminders.map((r) => r.offset_minutes),
    );
  });

  it("LOC-9 the opt-out instruction stays STOP in French", () => {
    // STOP is what the carrier's network listens for. Telling a French
    // customer to send a word Telnyx does not recognise would leave them
    // texting into the void, which is worse than an English word that works.
    // ARRET is honoured on our side (keywords.ts) but is not what we instruct.
    expect(FR_CA_COPY.identificationSuffix).toContain("STOP");
    expect(FR_CA_COPY.identificationSuffix).not.toContain("ARRET");
  });

  it("LOC-10 the emergency keyword stays URGENT in French", () => {
    // Same reason, one level down: the away reply invites a word, and the
    // keyword matcher is what has to recognise it. A French invitation to
    // reply with a French word nothing matches is #414 in another language.
    expect(FR_CA_COPY.awayReply).toContain("URGENT");
  });

  it("LOC-10a the safety line is translated, and the reply carries the translated one", () => {
    // The sentence with the safety property, and the one place a missing
    // translation is not merely a poor experience: a French body ending in
    // "If anyone is in danger, call 911" keeps the appearance of the guarantee
    // and loses it for the person it exists for.
    expect(FR_CA_COPY.emergencySafetyLine).not.toBe(EN_COPY.emergencySafetyLine);
    expect(FR_CA_COPY.emergencySafetyLine).toContain("911");

    const body = emergencyReplyBody(null, {
      fallback: FR_CA_COPY.emergencyAck,
      safetyLine: FR_CA_COPY.emergencySafetyLine,
    });
    expect(body).toContain(FR_CA_COPY.emergencyAck);
    expect(body).toContain(FR_CA_COPY.emergencySafetyLine);
    expect(body).not.toContain(EN_COPY.emergencySafetyLine);
  });

  it("LOC-10b appends the safety line to an owner's own words, in the resolved language", () => {
    // An owner writing their own emergency body does not opt out of the safety
    // line, and a French workspace must not get an English one bolted on.
    const body = emergencyReplyBody("On arrive tout de suite.", {
      fallback: FR_CA_COPY.emergencyAck,
      safetyLine: FR_CA_COPY.emergencySafetyLine,
    });
    expect(body).toContain("On arrive tout de suite.");
    expect(body).toContain(FR_CA_COPY.emergencySafetyLine);
    // Still idempotent, against the line actually being used.
    expect(
      emergencyReplyBody(`Deja dit. ${FR_CA_COPY.emergencySafetyLine}`, {
        safetyLine: FR_CA_COPY.emergencySafetyLine,
      }).match(/911/g)?.length,
    ).toBe(1);
  });

  it("LOC-11 resolves and picks the copy in one step for a contact", () => {
    expect(copyForContact(null, "fr-CA")).toBe(FR_CA_COPY);
    expect(copyForContact("en", "fr-CA")).toBe(EN_COPY);
    expect(copyForContact(null, null)).toBe(EN_COPY);
  });

  it("LOC-12 every language names itself in its own words", () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale]?.length, locale).toBeGreaterThan(0);
    }
  });
});
