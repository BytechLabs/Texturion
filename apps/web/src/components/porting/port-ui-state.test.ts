import { describe, expect, it } from "vitest";

import type {
  PortMessagingStatus,
  PortRequest,
  PortStatus,
} from "@/lib/api/types";

import { derivePortUiState, type PortStepKey } from "./port-ui-state";

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
    has_pin: false,
    has_account_number: true,
    has_ssn_sin_last4: false,
    has_loa: false,
    has_invoice: false,
    submitted_at: null,
    ported_at: null,
    cancelled_at: null,
    created_at: null,
    ...overrides,
  };
}

function stateOf(key: PortStepKey, ui: ReturnType<typeof derivePortUiState>) {
  return ui.steps.find((s) => s.key === key)?.state;
}

describe("derivePortUiState — the §8.2 4-step tracker", () => {
  it("draft with no documents: step 1 active, documents pending, cannot submit", () => {
    const ui = derivePortUiState(port({ status: "draft" }));
    expect(stateOf("submitted", ui)).toBe("active");
    expect(stateOf("date_confirmed", ui)).toBe("todo");
    expect(ui.documentsPending).toBe(true);
    expect(ui.canSubmit).toBe(false);
    expect(ui.editable).toBe(true);
  });

  it("draft WITH both documents: submit is unlocked", () => {
    const ui = derivePortUiState(
      port({ status: "draft", has_loa: true, has_invoice: true }),
    );
    expect(ui.documentsPending).toBe(false);
    expect(ui.canSubmit).toBe(true);
  });

  it("submitted: step 1 done, step 2 (date) is the active one", () => {
    const ui = derivePortUiState(port({ status: "submitted" }));
    expect(stateOf("submitted", ui)).toBe("done");
    expect(stateOf("date_confirmed", ui)).toBe("active");
    expect(stateOf("number_switched", ui)).toBe("todo");
  });

  it("foc-date-confirmed: steps 1–2 done, step 3 (switch) active", () => {
    const ui = derivePortUiState(
      port({ status: "foc-date-confirmed", foc_date: "2026-07-20T17:00:00Z" }),
    );
    expect(stateOf("submitted", ui)).toBe("done");
    expect(stateOf("date_confirmed", ui)).toBe("done");
    expect(stateOf("number_switched", ui)).toBe("active");
    expect(stateOf("texting_live", ui)).toBe("todo");
  });

  it("voice ported, messaging activating: step 4 (texting) is the active one", () => {
    const ui = derivePortUiState(
      port({ status: "ported", messaging_port_status: "activating" }),
    );
    expect(stateOf("number_switched", ui)).toBe("done");
    expect(stateOf("texting_live", ui)).toBe("active");
    expect(ui.live).toBe(false);
  });

  it("messaging ported: all 4 done and live", () => {
    const ui = derivePortUiState(
      port({ status: "ported", messaging_port_status: "ported" }),
    );
    for (const key of [
      "submitted",
      "date_confirmed",
      "number_switched",
      "texting_live",
    ] as PortStepKey[]) {
      expect(stateOf(key, ui)).toBe("done");
    }
    expect(ui.live).toBe(true);
    expect(ui.exception).toBeNull();
  });

  it("voice exception: flagged as a customer-actionable fix, resubmit gated on docs", () => {
    const withoutDocs = derivePortUiState(port({ status: "exception" }));
    expect(withoutDocs.exception).toBe("voice");
    expect(withoutDocs.editable).toBe(true);
    expect(withoutDocs.canResubmit).toBe(false);

    const withDocs = derivePortUiState(
      port({ status: "exception", has_loa: true, has_invoice: true }),
    );
    expect(withDocs.canResubmit).toBe(true);
  });

  it("messaging exception: NOT customer-actionable (voice already ported)", () => {
    const ui = derivePortUiState(
      port({ status: "ported", messaging_port_status: "exception" }),
    );
    expect(ui.exception).toBe("messaging");
    expect(stateOf("number_switched", ui)).toBe("done");
    expect(ui.live).toBe(false);
  });

  it("cancelled: no live steps, marked cancelled", () => {
    const ui = derivePortUiState(port({ status: "cancelled" }));
    expect(ui.cancelled).toBe(true);
    expect(ui.exception).toBeNull();
  });

  it("cancel-pending is treated as cancelled for the tracker", () => {
    const ui = derivePortUiState(port({ status: "cancel-pending" }));
    expect(ui.cancelled).toBe(true);
  });

  // Every non-terminal, non-exception state has exactly one active step so the
  // card always shows one obvious "what's happening now" (APP-UI §1).
  it("exactly one active step on the happy path", () => {
    const statuses: [PortStatus, PortMessagingStatus][] = [
      ["draft", "not_applicable"],
      ["in-process", "pending"],
      ["submitted", "pending"],
      ["foc-date-confirmed", "pending"],
      ["activation-in-progress", "activating"],
      ["ported", "activating"],
    ];
    for (const [status, messaging] of statuses) {
      const ui = derivePortUiState(
        port({ status, messaging_port_status: messaging }),
      );
      const active = ui.steps.filter((s) => s.state === "active");
      expect(active).toHaveLength(1);
    }
  });
});
