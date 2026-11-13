import { MESSAGE_AUTOMATIONS } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { makeTranslate } from "@/i18n/translate";

import { messageAutomationName, sentAutomaticallyLabel } from "./message-automation";

describe("#725 which automation sent a text", () => {
  it("names every automation, in both languages, with no two alike", () => {
    for (const translate of [makeTranslate("en"), makeTranslate("fr-CA")]) {
      const names = MESSAGE_AUTOMATIONS.map((a) => messageAutomationName(a, translate));
      expect(names.every((name) => typeof name === "string" && name.length > 0)).toBe(true);
      expect(new Set(names).size).toBe(MESSAGE_AUTOMATIONS.length);
    }
  });

  it("says a text was sent automatically even when it cannot say by what", () => {
    const t = makeTranslate("en");
    expect(sentAutomaticallyLabel("away_reply", t)).toBe("Sent automatically · Away reply");
    expect(sentAutomaticallyLabel(null, t)).toBe("Sent automatically");
    expect(sentAutomaticallyLabel("something_new", t)).toBe("Sent automatically");
  });
});
