import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_TEXT_DEFAULTS,
  MEMBER_ROLES,
  canSeeSettingsSection,
  type MemberRole,
} from "@loonext/shared";

import { makeTranslate } from "@/i18n/translate";
import { SETTINGS_SECTIONS } from "@/components/settings/settings-nav";

import {
  AUTOMATIC_TEXT_CHOICES,
  AUTOMATIC_TEXT_LABEL_KEYS,
  automaticTextDefaultCaption,
  automaticTextPatch,
  choicesWithCurrent,
  formatAutomaticTextDuration,
  readAutomaticTextSettings,
} from "./automatic-texts";

const en = makeTranslate("en");
const fr = makeTranslate("fr-CA");

describe("readAutomaticTextSettings", () => {
  it("decodes an older server's response, with no keys, to the defaults", () => {
    expect(readAutomaticTextSettings({})).toEqual(AUTOMATIC_TEXT_DEFAULTS);
    expect(readAutomaticTextSettings(null)).toEqual(AUTOMATIC_TEXT_DEFAULTS);
  });

  it("never reads an absent key as false or zero", () => {
    const decoded = readAutomaticTextSettings({ rating_ask_enabled: false });
    expect(decoded.rating_ask_enabled).toBe(false);
    expect(decoded.hold_scheduled_on_reply).toBe(true);
    expect(decoded.rating_ask_delay_hours).toBe(4);
    expect(decoded.auto_reply_cooldown_minutes).toBe(180);
  });

  it("keeps a value that was set, including zero", () => {
    expect(
      readAutomaticTextSettings({ rating_ask_delay_hours: 0 })
        .rating_ask_delay_hours,
    ).toBe(0);
  });
});

describe("choicesWithCurrent", () => {
  it("is the fixed list when the current value is on it", () => {
    expect(choicesWithCurrent("rating_ask_delay_hours", 4)).toEqual([
      0, 1, 2, 4, 8, 12, 24, 48,
    ]);
  });

  it("adds a current value that is not on the list, in order", () => {
    expect(choicesWithCurrent("reminder_expiry_hours", 3)).toEqual([
      1, 2, 3, 6, 12, 24, 72,
    ]);
  });

  it("offers every default, so the default is always pickable", () => {
    for (const field of Object.keys(AUTOMATIC_TEXT_CHOICES) as Array<
      keyof typeof AUTOMATIC_TEXT_CHOICES
    >) {
      expect(AUTOMATIC_TEXT_CHOICES[field]).toContain(
        AUTOMATIC_TEXT_DEFAULTS[field],
      );
    }
  });
});

describe("formatAutomaticTextDuration", () => {
  it("says durations in plain English", () => {
    expect(formatAutomaticTextDuration(en, "rating_ask_delay_hours", 4)).toBe(
      "4 hours",
    );
    expect(formatAutomaticTextDuration(en, "rating_ask_delay_hours", 1)).toBe(
      "1 hour",
    );
    expect(formatAutomaticTextDuration(en, "rating_ask_delay_hours", 0)).toBe(
      "Right away",
    );
    expect(formatAutomaticTextDuration(en, "rating_ask_cooldown_days", 30)).toBe(
      "30 days",
    );
    expect(
      formatAutomaticTextDuration(en, "auto_reply_cooldown_minutes", 180),
    ).toBe("3 hours");
    expect(
      formatAutomaticTextDuration(en, "auto_reply_cooldown_minutes", 1440),
    ).toBe("1 day");
    expect(
      formatAutomaticTextDuration(en, "auto_reply_cooldown_minutes", 30),
    ).toBe("30 minutes");
    expect(
      formatAutomaticTextDuration(en, "scheduled_text_expiry_hours", 720),
    ).toBe("30 days");
  });

  it("uses the French plural: zero and one are singular", () => {
    expect(formatAutomaticTextDuration(fr, "rating_ask_delay_hours", 1)).toBe(
      "1 heure",
    );
    expect(formatAutomaticTextDuration(fr, "rating_ask_delay_hours", 2)).toBe(
      "2 heures",
    );
    expect(formatAutomaticTextDuration(fr, "rating_ask_delay_hours", 0)).toBe(
      "Tout de suite",
    );
    expect(
      formatAutomaticTextDuration(fr, "auto_reply_cooldown_minutes", 1440),
    ).toBe("1 jour");
    expect(formatAutomaticTextDuration(fr, "rating_ask_cooldown_days", 14)).toBe(
      "14 jours",
    );
    expect(
      formatAutomaticTextDuration(fr, "auto_reply_cooldown_minutes", 30),
    ).toBe("30 minutes");
  });

  it("names every choice without a missing-key fallback", () => {
    for (const [field, list] of Object.entries(AUTOMATIC_TEXT_CHOICES)) {
      for (const value of list) {
        for (const t of [en, fr]) {
          const said = formatAutomaticTextDuration(
            t,
            field as keyof typeof AUTOMATIC_TEXT_CHOICES,
            value,
          );
          expect(said, `${field}=${value}`).not.toMatch(/settingsMore|\{/);
        }
      }
    }
  });
});

describe("automaticTextDefaultCaption", () => {
  it("states the default beside every control", () => {
    expect(automaticTextDefaultCaption(en, "hold_scheduled_on_reply")).toBe(
      "Default: on",
    );
    expect(automaticTextDefaultCaption(en, "rating_ask_delay_hours")).toBe(
      "Default: 4 hours",
    );
    expect(automaticTextDefaultCaption(fr, "hold_scheduled_on_reply")).toBe(
      "Par défaut : activé",
    );
    expect(automaticTextDefaultCaption(fr, "reminder_expiry_hours")).toBe(
      "Par défaut : 2 heures",
    );
  });
});

describe("automaticTextPatch", () => {
  it("carries only the field that changed", () => {
    expect(automaticTextPatch("rating_ask_enabled", false)).toEqual({
      rating_ask_enabled: false,
    });
    expect(automaticTextPatch("rating_ask_delay_hours", 8)).toEqual({
      rating_ask_delay_hours: 8,
    });
  });
});

describe("audit-log names", () => {
  it("covers every one of the eleven settings", () => {
    expect(Object.keys(AUTOMATIC_TEXT_LABEL_KEYS).sort()).toEqual(
      Object.keys(AUTOMATIC_TEXT_DEFAULTS).sort(),
    );
  });
});

describe("who sees the section", () => {
  const section = SETTINGS_SECTIONS.find((s) => s.slug === "automatic-texts");

  it("sits in the settings navigation", () => {
    expect(section).toBeDefined();
  });

  it("is visible to owners and admins only", () => {
    const seen = MEMBER_ROLES.filter((role: MemberRole) =>
      canSeeSettingsSection(section!.id, role),
    );
    expect([...seen].sort()).toEqual(["admin", "owner"]);
  });
});
