import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate } from "@/i18n/provider";
import type { TrashRow } from "@/lib/api/trash";

import { daysLeft, daysLeftLabel, detailLabel, kindLabel, whoLabel } from "./trash-row";

const t = makeTranslate(DEFAULT_LOCALE);
const NOW = new Date("2026-11-10T12:00:00.000Z");
const base = {
  id: "r-1",
  deleted_at: "2026-11-01T12:00:00.000Z",
  deleted_by_user_id: "u-1",
  purge_after: "2026-12-01T12:00:00.000Z",
};

describe("daysLeft", () => {
  it("counts whole days, rounding up", () => {
    expect(daysLeft("2026-12-10T12:00:00.000Z", NOW)).toBe(30);
    expect(daysLeft("2026-11-12T11:00:00.000Z", NOW)).toBe(2);
  });

  it("says 'within a day' rather than '1 day' when less than a day remains", () => {
    expect(daysLeft("2026-11-10T20:00:00.000Z", NOW)).toBe(0);
    expect(daysLeftLabel("2026-11-10T20:00:00.000Z", t, NOW)).toBe(
      "Erased within a day",
    );
  });

  it("is zero once the date has passed", () => {
    expect(daysLeft("2026-11-01T00:00:00.000Z", NOW)).toBe(0);
  });

  it("uses the singular and plural forms", () => {
    expect(daysLeftLabel("2026-11-11T12:00:00.000Z", t, NOW)).toBe("1 day left");
    expect(daysLeftLabel("2026-11-20T12:00:00.000Z", t, NOW)).toBe("10 days left");
  });
});

describe("row labels", () => {
  const conversation: TrashRow = {
    ...base,
    kind: "conversation",
    conversation: { contact_name: "Dana Rivera", contact_phone: "+12125550123", message_count: 1 },
  };
  const note: TrashRow = {
    ...base,
    kind: "message",
    message: {
      contact_name: null,
      contact_phone: "+12125550123",
      conversation_id: "c-1",
      direction: "note",
      snippet: "Gate code is 1234",
    },
  };

  it("names the kind, telling a note from a message", () => {
    expect(kindLabel(conversation, t)).toBe("Conversation");
    expect(kindLabel(note, t)).toBe("Note");
  });

  it("falls back from name to number to unknown", () => {
    expect(whoLabel(conversation, t)).toBe("Dana Rivera");
    expect(whoLabel(note, t)).toContain("555");
    expect(
      whoLabel(
        { ...conversation, conversation: { contact_name: null, contact_phone: null, message_count: 0 } },
        t,
      ),
    ).toBe("Unknown contact");
  });

  it("describes what is inside", () => {
    expect(detailLabel(conversation, t)).toBe("1 message");
    expect(detailLabel(note, t)).toBe("Gate code is 1234");
    expect(
      detailLabel(
        {
          ...base,
          kind: "call",
          call: {
            contact_name: null,
            contact_phone: null,
            outcome: "answered",
            started_at: base.deleted_at,
            has_voicemail: true,
          },
        },
        t,
      ),
    ).toBe("Answered · Includes a voicemail");
    expect(
      detailLabel(
        {
          ...base,
          kind: "voicemail",
          voicemail: {
            contact_name: null,
            contact_phone: null,
            started_at: base.deleted_at,
            voicemail_seconds: 42,
          },
        },
        t,
      ),
    ).toBe("42s voicemail");
  });
});
