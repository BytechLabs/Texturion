import { describe, expect, it } from "vitest";

import { mergeContactDetail } from "./contacts";
import type { Contact, ContactDetail } from "./types";

/**
 * #505 — what a contact save is allowed to forget.
 *
 * PATCH and POST echo the stored COLUMNS and nothing computed. The derived
 * fields exist only in the GET handler, so folding a save into the cached
 * detail by overwriting drops everything the response does not mention.
 *
 * That was a live #410 defect rather than a hypothetical one: editing a name
 * blanked the contact panel's "Customer since March 2026 · 7 conversations"
 * until something refetched, because the merge named five fields to carry
 * forward and stopped there. These pin the general rule, not those five.
 */

const saved: Contact = {
  id: "ct-1",
  phone_e164: "+14165550123",
  name: "Dana Rivera",
  address: null,
  notes: null,
  consent_source: null,
  consent_at: null,
  consent_attested_by: null,
  created_by_user_id: null,
  updated_by_user_id: null,
  timezone: null,
  first_identification_sent_at: null,
  deleted_at: null,
  created_at: "2026-03-04T10:00:00Z",
  updated_at: "2026-08-02T10:00:00Z",
} as Contact;

const cached = {
  ...saved,
  name: "Dana",
  opted_out: true,
  opt_out_source: "stop_keyword",
  timezone_resolved: "America/Toronto",
  timezone_source: "contact",
  local_hour: 9,
  conversation_count: 7,
  first_conversation_at: "2026-03-04T10:00:00Z",
  created_by_name: "Sam Founder",
  updated_by_name: "Riley Partner",
} as unknown as ContactDetail;

describe("mergeContactDetail (#505)", () => {
  it("keeps the relationship a save never mentions", () => {
    const merged = mergeContactDetail(cached, saved);

    expect(merged.conversation_count).toBe(7);
    expect(merged.first_conversation_at).toBe("2026-03-04T10:00:00Z");
  });

  it("keeps every other derived field too, not just the ones once listed", () => {
    const merged = mergeContactDetail(cached, saved) as unknown as Record<
      string,
      unknown
    >;

    // The point of the fix: these were never in the carry-forward list and
    // were being dropped on every edit.
    expect(merged.created_by_name).toBe("Sam Founder");
    expect(merged.updated_by_name).toBe("Riley Partner");
    // ...alongside the ones that were.
    expect(merged.opted_out).toBe(true);
    expect(merged.timezone_resolved).toBe("America/Toronto");
    expect(merged.local_hour).toBe(9);
  });

  it("still lets the edit the user just made win", () => {
    const merged = mergeContactDetail(cached, saved);

    expect(merged.name).toBe("Dana Rivera");
    expect(merged.updated_at).toBe("2026-08-02T10:00:00Z");
  });

  it("supplies defaults when nothing is cached yet", () => {
    const merged = mergeContactDetail(undefined, saved);

    expect(merged.opted_out).toBe(false);
    expect(merged.opt_out_source).toBeNull();
    expect(merged.timezone_resolved).toBe("UTC");
    expect(merged.timezone_source).toBe("company");
    expect(merged.local_hour).toBe(0);
    expect(merged.name).toBe("Dana Rivera");
  });

  // The regression stated as the behaviour a reader cares about, so a future
  // change that reintroduces an explicit carry-forward list fails here.
  it("survives repeated saves without eroding the relationship", () => {
    let detail = cached;
    for (let i = 0; i < 5; i++) detail = mergeContactDetail(detail, saved);

    expect(detail.conversation_count).toBe(7);
  });
});
