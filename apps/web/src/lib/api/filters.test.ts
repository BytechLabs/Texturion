import { describe, expect, it } from "vitest";

import { conversationMatchesFilters, isSnoozed } from "./filters";
import type { ConversationListItem } from "./types";

/**
 * #293 — the client-side copy of the server's snooze filter.
 *
 * It exists so a thread deferred in one tab leaves the cached list under the
 * hand that deferred it, and so an un-snooze puts it back without a refetch.
 * That means it has to agree with `api_list_conversations` exactly: if the two
 * ever disagree, the row the user sees and the row the server would send are
 * different, and the disagreement survives until the query goes stale.
 */
function item(overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    id: "conv-1",
    company_id: "company-1",
    contact_id: "contact-1",
    phone_number_id: "number-1",
    status: "open",
    is_spam: false,
    assigned_user_id: null,
    pinned_at: null,
    pinned_by_user_id: null,
    emergency_at: null,
    last_message_at: "2026-08-05T10:00:00.000Z",
    closed_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-08-05T10:00:00.000Z",
    contact: { id: "contact-1", name: "Jo", phone_e164: "+14165550100" },
    tags: [],
    unread: false,
    last_message: null,
    ...overrides,
  };
}

const NOW = Date.parse("2026-08-05T10:00:00.000Z");

describe("isSnoozed", () => {
  it("is computed from the return time, never from the field's presence", () => {
    expect(isSnoozed(item(), NOW)).toBe(false);
    expect(isSnoozed(item({ snoozed_until: null }), NOW)).toBe(false);
    expect(
      isSnoozed(item({ snoozed_until: "2026-08-05T12:00:00.000Z" }), NOW),
    ).toBe(true);
    // Elapsed is simply over — the same rule the server applies, so a returned
    // thread needs nothing to run before it is visible again.
    expect(
      isSnoozed(item({ snoozed_until: "2026-08-05T09:59:59.000Z" }), NOW),
    ).toBe(false);
  });

  it("treats an unparseable timestamp as not deferred", () => {
    // Hiding a live thread because a date failed to parse is the one direction
    // this must never fail in.
    expect(isSnoozed(item({ snoozed_until: "not a date" }), NOW)).toBe(false);
  });
});

describe("conversationMatchesFilters + #293", () => {
  const deferred = item({ snoozed_until: "2030-01-01T00:00:00.000Z" });
  const live = item();

  it("keeps deferrals out of the ordinary inbox", () => {
    expect(conversationMatchesFilters(live, {})).toBe(true);
    expect(conversationMatchesFilters(deferred, {})).toBe(false);
  });

  it("shows only deferrals in the Snoozed view", () => {
    expect(conversationMatchesFilters(deferred, { snoozed: "only" })).toBe(true);
    expect(conversationMatchesFilters(live, { snoozed: "only" })).toBe(false);
  });

  it("lets 'all' opt out of the filter entirely", () => {
    expect(conversationMatchesFilters(deferred, { snoozed: "all" })).toBe(true);
    expect(conversationMatchesFilters(live, { snoozed: "all" })).toBe(true);
  });

  it("still applies every other filter to a deferred row", () => {
    // The snooze filter is one gate among several, not a short circuit.
    expect(
      conversationMatchesFilters(deferred, {
        snoozed: "only",
        status: "closed",
      }),
    ).toBe(false);
  });
});

describe("conversationMatchesFilters + #508", () => {
  const waiting = item({ awaiting_reply_since: "2026-08-05T09:00:00.000Z" });
  const answered = item({ awaiting_reply_since: null });

  it("keeps the Unanswered list to threads with the clock still running", () => {
    expect(conversationMatchesFilters(waiting, { awaiting: "only" })).toBe(true);
    expect(conversationMatchesFilters(answered, { awaiting: "only" })).toBe(
      false,
    );
  });

  it("drops a row from that list the moment somebody answers it", () => {
    // The point of the local copy: a reply patches the cached row, and the
    // thread leaves the Unanswered list without waiting for a refetch.
    expect(conversationMatchesFilters(answered, { awaiting: "only" })).toBe(
      false,
    );
    expect(conversationMatchesFilters(waiting, { awaiting: "exclude" })).toBe(
      false,
    );
  });

  it("does not filter at all when nothing was asked", () => {
    // Unlike `snoozed`, absent means the ordinary inbox — answered and
    // unanswered alike.
    expect(conversationMatchesFilters(waiting, {})).toBe(true);
    expect(conversationMatchesFilters(answered, {})).toBe(true);
  });

  it("says UNKNOWN rather than 'answered' for a row that predates the field", () => {
    // An older cached payload carries no lead clock. Reading missing as
    // answered would drop a waiting lead off the one screen that names it, so
    // null hands the decision back to staleness instead.
    expect(conversationMatchesFilters(item(), { awaiting: "only" })).toBe(null);
  });

  it("is one gate among several, not a short circuit", () => {
    expect(
      conversationMatchesFilters(waiting, {
        awaiting: "only",
        status: "closed",
      }),
    ).toBe(false);
  });
});
