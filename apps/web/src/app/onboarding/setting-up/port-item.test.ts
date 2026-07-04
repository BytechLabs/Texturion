import { describe, expect, it } from "vitest";

import type { PortRequest } from "@/lib/api/types";

import {
  resolvePortChecklistItem,
  type PortItemPhase,
} from "./port-item";

/** Minimal port row factory — only the fields the deriver reads matter. */
function port(overrides: Partial<PortRequest> = {}): PortRequest {
  return {
    id: "port-1",
    phone_e164: "+13035550000",
    country: "US",
    status: "draft",
    messaging_port_status: "not_applicable",
    foc_date: null,
    foc_datetime_requested: null,
    rejection_reason: null,
    submission_count: 0,
    entity_name: "Acme",
    auth_person_name: "Sam",
    billing_phone_number: null,
    service_street: "1 Main St",
    service_extended: null,
    service_locality: "Denver",
    service_admin_area: "CO",
    service_postal_code: "80202",
    is_wireless: false,
    wants_bridge_number: false,
    bridge_number_id: null,
    bridge_number_e164: null,
    has_pin: false,
    has_account_number: true,
    has_ssn_sin_last4: false,
    has_loa: false,
    has_invoice: false,
    assignment_blocked: false,
    submitted_at: null,
    ported_at: null,
    cancelled_at: null,
    created_at: null,
    ...overrides,
  };
}

describe("resolvePortChecklistItem — when the port item replaces the row", () => {
  it("no ports and no numbers → null (today's provisioning behavior)", () => {
    expect(resolvePortChecklistItem([], [])).toBeNull();
  });

  it("an active number wins even with a live port (bridge or post-cutover)", () => {
    expect(
      resolvePortChecklistItem(
        [{ status: "active" }],
        [port({ status: "in-process" })],
      ),
    ).toBeNull();
  });

  it("a provisioning placeholder row does NOT suppress the port item", () => {
    // The port saga claims a phone slot as `provisioning` (PORTING.md §4) —
    // that row never advances on its own, so the transfer item must still show.
    const item = resolvePortChecklistItem(
      [{ status: "provisioning" }],
      [port()],
    );
    expect(item?.phase).toBe("needs_documents");
  });

  it("cancelled and cancel-pending ports are inert → null", () => {
    for (const status of ["cancelled", "cancel-pending"] as const) {
      expect(resolvePortChecklistItem([], [port({ status })])).toBeNull();
    }
  });

  it("skips a cancelled port to reach the live one behind it", () => {
    const item = resolvePortChecklistItem(
      [],
      [port({ id: "dead", status: "cancelled" }), port({ id: "live" })],
    );
    expect(item?.port.id).toBe("live");
  });
});

describe("resolvePortChecklistItem — the phase table (PORTING.md §1/§8.2)", () => {
  it("draft without both documents → needs_documents (the P5 hard gate)", () => {
    const cases = [
      {},
      { has_loa: true },
      { has_invoice: true },
    ] satisfies Partial<PortRequest>[];
    for (const docs of cases) {
      const item = resolvePortChecklistItem([], [port(docs)]);
      expect(item?.phase).toBe("needs_documents");
      expect(item?.actionNeeded).toBe(true);
    }
  });

  it("draft with both documents → needs_submit (still user-gated)", () => {
    const item = resolvePortChecklistItem(
      [],
      [port({ has_loa: true, has_invoice: true })],
    );
    expect(item?.phase).toBe("needs_submit");
    expect(item?.actionNeeded).toBe(true);
  });

  it("submitted / in-process → in_review, nothing for the user to do", () => {
    for (const status of ["submitted", "in-process"] as const) {
      const item = resolvePortChecklistItem(
        [],
        [port({ status, messaging_port_status: "pending" })],
      );
      expect(item?.phase).toBe("in_review");
      expect(item?.actionNeeded).toBe(false);
    }
  });

  it("foc-date-confirmed / activation-in-progress → date_confirmed", () => {
    for (const status of [
      "foc-date-confirmed",
      "activation-in-progress",
    ] as const) {
      const item = resolvePortChecklistItem(
        [],
        [port({ status, messaging_port_status: "pending" })],
      );
      expect(item?.phase).toBe("date_confirmed");
      expect(item?.actionNeeded).toBe(false);
    }
  });

  it("voice ported, messaging activating → texting_activating", () => {
    const item = resolvePortChecklistItem(
      [{ status: "provisioning" }],
      [port({ status: "ported", messaging_port_status: "activating" })],
    );
    expect(item?.phase).toBe("texting_activating");
    expect(item?.actionNeeded).toBe(false);
  });

  it("messaging exception → texting_delayed (Telnyx escalates, not the user)", () => {
    const item = resolvePortChecklistItem(
      [],
      [port({ status: "ported", messaging_port_status: "exception" })],
    );
    expect(item?.phase).toBe("texting_delayed");
    expect(item?.actionNeeded).toBe(false);
  });

  it("voice exception → needs_fix, customer-actionable", () => {
    const item = resolvePortChecklistItem(
      [],
      [port({ status: "exception", rejection_reason: "address mismatch" })],
    );
    expect(item?.phase).toBe("needs_fix");
    expect(item?.actionNeeded).toBe(true);
  });

  // The user-gated phases are exactly the ones where the screen must go loud —
  // a spinner anywhere here would promise progress that isn't happening.
  it("actionNeeded is true for exactly the user-gated phases", () => {
    const table: [PortRequest, PortItemPhase, boolean][] = [
      [port(), "needs_documents", true],
      [port({ has_loa: true, has_invoice: true }), "needs_submit", true],
      [port({ status: "exception" }), "needs_fix", true],
      [port({ status: "submitted" }), "in_review", false],
      [port({ status: "foc-date-confirmed" }), "date_confirmed", false],
      [
        port({ status: "ported", messaging_port_status: "activating" }),
        "texting_activating",
        false,
      ],
      [
        port({ status: "ported", messaging_port_status: "exception" }),
        "texting_delayed",
        false,
      ],
    ];
    for (const [row, phase, actionNeeded] of table) {
      const item = resolvePortChecklistItem([], [row]);
      expect(item?.phase).toBe(phase);
      expect(item?.actionNeeded).toBe(actionNeeded);
    }
  });
});
