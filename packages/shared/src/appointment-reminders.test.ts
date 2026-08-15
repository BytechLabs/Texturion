import { describe, expect, it } from "vitest";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

import {
  APPOINTMENT_CONFIRMED_LINE,
  reminderOffsetLabel,
} from "./appointment-reminders";

/** #228 — the module names keys now, so the tests resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const sayEn = (key: string): string => look(WEB_EN, key);
const sayFr = (key: string): string => look(WEB_FR, key);

describe("#228 the offset ladder, in the reader's language", () => {
  it("says the day before as a phrase, not as a count", () => {
    // THE case. English can get away with one key and a number — "1 day
    // before" is at worst stiff. French cannot: the day before is "La veille",
    // which shares no word with "{count} jours avant". A single key would have
    // forced "1 jour avant", which is correct and reads like a machine wrote
    // it, and no English assertion would ever have noticed.
    expect(reminderOffsetLabel(1440, sayEn)).toBe("The day before");
    expect(reminderOffsetLabel(1440, sayFr)).toBe("La veille");
    expect(reminderOffsetLabel(2880, sayFr)).toBe("2 jours avant");
  });

  it("keeps one hour apart from many, in both languages", () => {
    expect(reminderOffsetLabel(60, sayEn)).toBe("1 hour before");
    expect(reminderOffsetLabel(120, sayEn)).toBe("2 hours before");
    expect(reminderOffsetLabel(60, sayFr)).toBe("1 heure avant");
    expect(reminderOffsetLabel(120, sayFr)).toBe("2 heures avant");
  });

  it("falls through to minutes for an offset that is neither", () => {
    expect(reminderOffsetLabel(90, sayEn)).toBe("90 minutes before");
    expect(reminderOffsetLabel(90, sayFr)).toBe("90 minutes avant");
  });

  it("leaves no variable unfilled at any rung", () => {
    for (const minutes of [1440, 2880, 60, 120, 90, 20160]) {
      for (const say of [sayEn, sayFr]) {
        expect(reminderOffsetLabel(minutes, say)).not.toMatch(/\{/);
        expect(reminderOffsetLabel(minutes, say)).not.toMatch(/^domain\./);
      }
    }
  });

  it("says the customer confirmed, in both languages", () => {
    // The one system line whose actor is the CUSTOMER rather than a member.
    expect(sayEn(APPOINTMENT_CONFIRMED_LINE)).toBe(
      "They confirmed the appointment",
    );
    expect(sayFr(APPOINTMENT_CONFIRMED_LINE)).toBe(
      "Le client a confirmé le rendez-vous",
    );
  });
});
