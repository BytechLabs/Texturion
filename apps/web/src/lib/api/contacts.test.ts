import { describe, expect, it } from "vitest";

import {
  CONTACT_IMPORT_COLUMN_FIELD,
  CONTACT_IMPORT_CONSENT_FIELD,
  CONTACT_IMPORT_CONSENT_VALUE,
  CONTACT_IMPORT_IGNORE,
  CONTACT_IMPORT_VCARD_PROPERTY_FIELD,
  parseContactImportColumn,
  parseVCardProperty,
} from "@loonext/shared";

import { importFormData, mergeContactDetail } from "./contacts";
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

/**
 * #248 — the field #226 demanded and no client ever sent.
 *
 * `edfa044e` made `consent_attested` mandatory on CSV import. The web client,
 * Android and iOS all posted the file alone, so every import on every client
 * 422'd against a field name the UI had no control for, and it stayed that way
 * for over a week: the gate was asserted only from the server side, and nothing
 * anywhere exercised the mutation that had to satisfy it. These are that
 * missing assertion.
 *
 * They read the shipped constants rather than the literal `"consent_attested"`
 * — a test that types the field name itself would keep passing against a client
 * that had drifted, which is precisely how this shipped.
 */
describe("#248 the import attestation leaves this client", () => {
  it("sends the exact field and value the server gates on", () => {
    const body = importFormData({
      file: new Blob(["phone\r\n+14165550199"]),
      consentAttested: true,
    });

    expect(body.get(CONTACT_IMPORT_CONSENT_FIELD)).toBe(
      CONTACT_IMPORT_CONSENT_VALUE,
    );
    expect(body.get("file")).not.toBeNull();
  });

  it("omits the field entirely when nobody attested", () => {
    // Absent rather than "false". The server compares against the one passing
    // value, so both fail — but only "absent" is honest about what happened,
    // and a client that always wrote a value would be the product asserting on
    // the customer's behalf that strangers agreed to be texted.
    const body = importFormData({
      file: new Blob(["phone\r\n+14165550199"]),
      consentAttested: false,
    });

    expect(body.has(CONTACT_IMPORT_CONSENT_FIELD)).toBe(false);
    expect(body.get(CONTACT_IMPORT_CONSENT_VALUE)).toBeNull();
  });

});

/**
 * #248 round 3 — the complete column declaration leaves this client.
 *
 * Round two sent a field only for the columns the server had just complained
 * about, which made the shortest path to a 200 this: post, read the column
 * names out of the 422's own sentence, post again. Two round trips, no human,
 * and a message delivered — demonstrated live by three verifiers. The
 * declaration is complete or the request is refused, so there is no refusal to
 * learn from.
 *
 * Round-tripped through the SHARED parser rather than compared to a hand-typed
 * string: this is a wire format, and a test that retypes it would keep passing
 * against a client that had drifted from the server reading it.
 */
describe("#248 the column declaration leaves this client", () => {
  it("CD-1: repeats the field once per column, by index, header intact", () => {
    const body = importFormData({
      file: new Blob(["phone,Region\r\n+14165550199,West"]),
      consentAttested: true,
      columns: [
        { index: 0, action: "phone", header: "phone" },
        // A header carrying both delimiters of the wire format. The index and
        // the action are fixed tokens and the header is last, so a comma or a
        // colon in a column name cannot move the boundary.
        { index: 1, action: CONTACT_IMPORT_IGNORE, header: "Region: N, W" },
      ],
    });

    const sent = body.getAll(CONTACT_IMPORT_COLUMN_FIELD);
    expect(sent).toHaveLength(2);
    expect(sent.map((raw) => parseContactImportColumn(String(raw)))).toEqual([
      { index: 0, action: "phone", header: "phone" },
      { index: 1, action: CONTACT_IMPORT_IGNORE, header: "Region: N, W" },
    ]);
  });

  it("CD-2: tells two nameless columns apart on the wire", () => {
    // Round two matched its field on a normalised header, so every header with
    // no ASCII alphanumerics became the SAME EMPTY STRING and two columns could
    // not be told apart. The index is the identity now, and it survives the
    // trip.
    const body = importFormData({
      file: new Blob(["a,,\r\n1,2,3"]),
      consentAttested: true,
      columns: [
        { index: 0, action: "phone", header: "a" },
        { index: 1, action: CONTACT_IMPORT_IGNORE, header: "" },
        { index: 2, action: CONTACT_IMPORT_IGNORE, header: "" },
      ],
    });

    expect(
      body
        .getAll(CONTACT_IMPORT_COLUMN_FIELD)
        .map((raw) => parseContactImportColumn(String(raw))?.index),
    ).toEqual([0, 1, 2]);
  });

  it("CD-3: sends no declaration when the caller has none", () => {
    // Absent rather than invented, exactly like the attestation beside it. A
    // client that filled in `ignore` for a column nobody answered would be the
    // product dismissing a do-not-text column on the customer's behalf.
    const body = importFormData({
      file: new Blob(["phone\r\n+14165550199"]),
      consentAttested: true,
    });

    expect(body.getAll(CONTACT_IMPORT_COLUMN_FIELD)).toEqual([]);
  });

  it("CD-4: sends the vCard door's property declaration the same way", () => {
    const body = importFormData({
      file: new Blob(["BEGIN:VCARD\r\nEND:VCARD"]),
      consentAttested: true,
      properties: [
        { property: "CATEGORIES", action: "opted_out" },
        { property: "NOTE", action: CONTACT_IMPORT_IGNORE },
      ],
    });

    expect(
      body
        .getAll(CONTACT_IMPORT_VCARD_PROPERTY_FIELD)
        .map((raw) => parseVCardProperty(String(raw))),
    ).toEqual([
      { property: "CATEGORIES", action: "opted_out" },
      { property: "NOTE", action: CONTACT_IMPORT_IGNORE },
    ]);
    // The two doors share one function and must not leak into each other: a
    // CSV import that also posted properties, or a .vcf that posted columns,
    // would be describing a file it did not attach.
    expect(body.getAll(CONTACT_IMPORT_COLUMN_FIELD)).toEqual([]);
  });
});
