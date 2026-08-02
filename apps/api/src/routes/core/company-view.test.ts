/**
 * #515 — the company projection: what leaves `loadCompanyView`, and for whom.
 *
 * The route-level proof (a member typing the URL, a bookkeeper doing the books)
 * lives in `routes/companies.test.ts`. This file holds the two things that are
 * about the PROJECTION itself rather than about a request: that the rule is
 * asked as a capability and fails closed, and that the redaction list cannot
 * silently fall behind the column list it is redacting.
 */
import { MEMBER_ROLES, type MemberRole } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import {
  BILLING_ONLY_COMPANY_FIELDS,
  COMPANY_COLUMNS,
  withBillingRedacted,
} from "./company-view";

/** A company row carrying every redactable column plus ordinary settings. */
function row(): Record<string, unknown> {
  return {
    id: "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d",
    name: "Acme Plumbing",
    plan: "pro",
    subscription_status: "active",
    away_message: "We reply by 8am.",
    billing_currency: "cad",
    current_period_start: "2026-07-01T00:00:00Z",
    current_period_end: "2026-08-01T00:00:00Z",
    overage_cap_multiplier: "3.00",
    registration_fee_paid_at: "2026-06-01T00:00:00Z",
    canceled_at: "2026-07-20T00:00:00Z",
    cancel_at_period_end: true,
    offramp_message: "We've moved to 555-0123.",
    offramp_opted_in_at: "2026-07-20T00:00:00Z",
  };
}

describe("withBillingRedacted", () => {
  it("asks for the capability, not the rank (#315)", () => {
    // The roles that hold billing.manage keep every field; the ones that do not
    // keep none of them. Written as the capability split rather than as a list
    // of role names, because the bookkeeper is exactly the case a
    // `owner || admin` check gets wrong — and getting it wrong is what sends an
    // owner back to sharing their login.
    const withBilling: MemberRole[] = ["owner", "admin", "bookkeeper"];
    const without: MemberRole[] = ["member", "read_only"];
    // Nobody is missing from the split — a new preset must be classified here.
    expect([...withBilling, ...without].sort()).toEqual([...MEMBER_ROLES].sort());

    for (const role of withBilling) {
      expect(withBillingRedacted(row(), role), role).toEqual(row());
    }
    for (const role of without) {
      const out = withBillingRedacted(row(), role);
      for (const field of BILLING_ONLY_COMPANY_FIELDS) {
        expect(out, `${role}.${field}`).not.toHaveProperty(field);
      }
    }
  });

  it("leaves everything else exactly as it was", () => {
    // The workspace's SETTINGS are not its books. A member has to keep reading
    // the hours, the away reply and the workspace's own name — the redaction is
    // narrow on purpose.
    const out = withBillingRedacted(row(), "member");
    expect(out).toMatchObject({
      id: row().id,
      name: "Acme Plumbing",
      plan: "pro",
      subscription_status: "active",
      away_message: "We reply by 8am.",
    });
  });

  it("does not mutate the row it was given", () => {
    // Both callers hand it a freshly built object today, but a redactor that
    // edits its input in place is one refactor away from redacting the row a
    // caller still needs whole.
    const original = row();
    withBillingRedacted(original, "member");
    expect(original).toEqual(row());
  });

  it("fails closed for a role this build has never heard of", () => {
    // company_members.role is a DB enum that can grow a value ahead of a
    // deployed Worker, and the role arrives here as data from a row. The honest
    // answer to "may this unknown role see the money" is no.
    const out = withBillingRedacted(row(), "auditor" as MemberRole);
    expect(out).not.toHaveProperty("current_period_end");
    expect(out).toMatchObject({ subscription_status: "active" });
  });
});

/**
 * The drift guard. A redaction list is only as good as its last update, and the
 * failure is silent: somebody adds `next_invoice_at` to COMPANY_COLUMNS for the
 * billing screen, and it ships to every member with nothing going red.
 *
 * So anything in the projection whose NAME reads commercial must be either
 * redacted or listed below with a reason. The reason matters more than the
 * exemption — it is the decision, written where the next person will be
 * standing.
 */
const KEPT_COMMERCIAL_LOOKING: Record<string, string> = {
  // Every role needs this: the app-wide "this workspace can't send" banner and
  // the composer gate read it, and GET /v1/me publishes it per membership with
  // no gate at all. Withholding it would blind a member while hiding nothing.
  subscription_status: "the app-wide send-blocked banner reads it for every role",
};

describe("the redaction list keeps up with the column list", () => {
  const columns = COMPANY_COLUMNS.split(",").map((c) => c.split(":").pop()!.trim());

  it("finds the columns (the guard itself still works)", () => {
    expect(columns).toContain("subscription_status");
    expect(columns.length).toBeGreaterThan(30);
  });

  it("redacts, or explains, every commercial-looking column", () => {
    const commercial = columns.filter((c) =>
      /billing|period|cancel|offramp|fee_paid|overage|invoice|price|stripe/.test(c),
    );
    const unhandled = commercial.filter(
      (c) =>
        !(BILLING_ONLY_COMPANY_FIELDS as readonly string[]).includes(c) &&
        !(c in KEPT_COMMERCIAL_LOOKING),
    );
    expect(
      unhandled,
      `\n\nThese company columns look like money and go to every role:\n` +
        `  ${unhandled.join(", ")}\n\n` +
        `Add each to BILLING_ONLY_COMPANY_FIELDS, or to this test's\n` +
        `KEPT_COMMERCIAL_LOOKING with the reason a member needs it. #515:\n` +
        `GET /v1/company is gated at workspace.access because the app BOOTS on\n` +
        `it — the payload is the only thing standing between a plain member and\n` +
        `the workspace's books.\n`,
    ).toEqual([]);
  });

  it("redacts only columns that are really in the view", () => {
    // The mirror failure: a column renamed or dropped leaves a redaction entry
    // that protects nothing, and reads as though it does.
    for (const field of BILLING_ONLY_COMPANY_FIELDS) {
      expect(columns, field).toContain(field);
    }
  });
});
