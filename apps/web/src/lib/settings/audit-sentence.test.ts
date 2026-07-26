/**
 * #231 — the audit log reads as sentences, not identifiers.
 *
 * The person opening this page is usually not technical, is often looking
 * because something went wrong, and needs to scan for the one line that
 * matters. A row that renders `member.role_changed / member / 4f2a…` is
 * technically a record and practically useless.
 */
import { describe, expect, it } from "vitest";

import type { AuditEntry } from "@/lib/api/types";
import { auditActor, auditSentence } from "./audit-sentence";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "a-1",
    actor_user_id: "u-1",
    actor_name: "Sam",
    actor_ip: "203.0.113.7",
    action: "member.deactivated",
    target_type: "member",
    target_id: "m-1",
    before: {},
    after: {},
    occurred_at: "2026-07-20T15:04:05+00:00",
    ...overrides,
  };
}

describe("auditActor", () => {
  it("names the person, the system, or an honest placeholder", () => {
    expect(auditActor(entry())).toBe("Sam");
    // A cron or a webhook is a legitimate actor — say so rather than blaming
    // whoever happened to be signed in.
    expect(auditActor(entry({ actor_user_id: null, actor_name: null }))).toBe(
      "Loonext",
    );
    // A member with no profile name is still a person, never a raw uuid.
    expect(auditActor(entry({ actor_name: null }))).toBe("Someone");
    expect(auditActor(entry({ actor_name: "   " }))).toBe("Someone");
  });
});

describe("auditSentence", () => {
  it("reads as something that happened", () => {
    expect(
      auditSentence(
        entry({
          action: "member.role_changed",
          before: { role: "member" },
          after: { role: "admin" },
        }),
      ),
    ).toBe("Sam changed a member from member to admin");

    expect(auditSentence(entry({ action: "member.deactivated" }))).toBe(
      "Sam removed a member from the workspace",
    );

    expect(
      auditSentence(
        entry({
          action: "member.invited",
          after: { email: "jordan@example.com", role: "member" },
        }),
      ),
    ).toBe("Sam invited jordan@example.com as member");
  });

  it("says what a number-access change actually did", () => {
    expect(
      auditSentence(
        entry({ action: "number_access.changed", after: { access: "everyone" } }),
      ),
    ).toBe("Sam opened a number to everyone");
    expect(
      auditSentence(
        entry({
          action: "number_access.changed",
          after: { access: "people", people: 1, level: "read" },
        }),
      ),
    ).toBe("Sam limited a number to 1 person");
    expect(
      auditSentence(
        entry({
          action: "number_access.changed",
          after: { access: "people", people: 3, level: "read" },
        }),
      ),
    ).toBe("Sam limited a number to 3 people");
  });

  it("names the settings that moved, in the product's own words", () => {
    // "Who turned off the missed-call text-back three weeks ago, which is why
    // we stopped getting jobs" — the question the log exists to answer.
    expect(
      auditSentence(
        entry({ action: "settings.changed", after: { mctb_enabled: false } }),
      ),
    ).toBe("Sam changed the missed-call text-back");

    expect(
      auditSentence(
        entry({
          action: "settings.changed",
          after: { cnam_display_name: "RIVERA", cnam_submitted_at: "2026-07-20" },
        }),
      ),
      // The bookkeeping timestamp that rides along is not a thing anyone
      // changed, so it is not in the sentence.
    ).toBe("Sam changed the caller ID");

    expect(
      auditSentence(
        entry({
          action: "settings.changed",
          after: { away_enabled: true, away_message: "set", timezone: "UTC" },
        }),
      ),
    ).toBe("Sam changed the away reply, the away message and the timezone");
  });

  it("still says something for an action this build has never seen", () => {
    // A newer server writes a kind this client does not know. It must read as
    // something rather than vanish from the page — a gap in a log looks like
    // nothing happened.
    expect(auditSentence(entry({ action: "webhook.rotated" }))).toBe(
      "Sam — webhook rotated",
    );
  });
});
