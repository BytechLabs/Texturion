import { describe, expect, it } from "vitest";

import type {
  PhoneNumberSummary,
  PortMessagingStatus,
  PortRequest,
  PortStatus,
} from "@/lib/api/types";

import { PORT_STATE_COPY } from "./copy";
import {
  derivePortUiState,
  numberForPort,
  partitionNumbers,
  type PortStepKey,
} from "./port-ui-state";

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

  // §8.2/§9: the post-port 10DLC assignment FAILED guidance ("ask your
  // previous texting provider to remove this number from their campaign").
  it("assignment_blocked surfaces the §9 guidance flag post-cutover", () => {
    const ui = derivePortUiState(
      port({
        status: "ported",
        messaging_port_status: "activating",
        assignment_blocked: true,
      }),
    );
    expect(ui.assignmentBlocked).toBe(true);
    // The card renders exactly the §9 table row for this flag.
    expect(PORT_STATE_COPY.assignmentBlocked("(303) 555-0000")).toBe(
      "One more step: ask your previous texting provider to remove (303) 555-0000 from their carrier campaign, then we'll finish connecting it. We'll retry automatically once they do.",
    );
  });

  it("assignment_blocked coexists with live (separate track from the messaging port)", () => {
    const ui = derivePortUiState(
      port({
        status: "ported",
        messaging_port_status: "ported",
        assignment_blocked: true,
      }),
    );
    expect(ui.live).toBe(true);
    expect(ui.assignmentBlocked).toBe(true);
  });

  it("assignment_blocked defaults off and is suppressed on a cancelled port", () => {
    expect(derivePortUiState(port({ status: "ported" })).assignmentBlocked).toBe(
      false,
    );
    expect(
      derivePortUiState(
        port({ status: "cancelled", assignment_blocked: true }),
      ).assignmentBlocked,
    ).toBe(false);
  });

  it("cancel-pending is treated as cancelled for the tracker", () => {
    const ui = derivePortUiState(port({ status: "cancel-pending" }));
    expect(ui.cancelled).toBe(true);
  });

  // PORTING.md D16: the opt-in temporary (bridge) number line.
  it("bridge surfaces the live temporary number while the transfer is in flight", () => {
    const ui = derivePortUiState(
      port({
        status: "submitted",
        messaging_port_status: "pending",
        bridge_number_e164: "+13035550777",
      }),
    );
    expect(ui.bridge).toBe("+13035550777");
    // The card renders exactly the §9 line for it.
    expect(PORT_STATE_COPY.bridgeAvailable("(303) 555-0777")).toBe(
      "Your temporary number (303) 555-0777 is ready so you can text today. Once your real number finishes transferring, you can release the temporary one.",
    );
  });

  it("bridge goes quiet once texting is live and on abandoned ports", () => {
    expect(
      derivePortUiState(
        port({
          status: "ported",
          messaging_port_status: "ported",
          bridge_number_e164: "+13035550777",
        }),
      ).bridge,
    ).toBeNull();
    for (const status of ["cancelled", "cancel-pending"] as const) {
      expect(
        derivePortUiState(
          port({ status, bridge_number_e164: "+13035550777" }),
        ).bridge,
      ).toBeNull();
    }
  });

  it("bridge is null without a live bridge number — including pre-bridge cached shapes", () => {
    expect(derivePortUiState(port()).bridge).toBeNull();
    // Cached rows serialized before the field existed lack it entirely.
    const legacy = port();
    delete (legacy as { bridge_number_e164?: string | null }).bridge_number_e164;
    expect(derivePortUiState(legacy).bridge).toBeNull();
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

/**
 * #523 — the partition, which had no tests at all and one real hole.
 *
 * A row this function calls "ported" is DROPPED by the numbers page: the caller
 * keeps only `provisioned`, because the stepper renders from the PORT list
 * rather than from this one. So a misclassification here is not a cosmetic
 * mistake, it is a phone number that appears on no surface — no status, no
 * access controls, no release. That is the shape of the #523 iOS defect, and web
 * had its own version of it hiding behind an inference the server has not needed
 * for a long time.
 */
function numberRow(
  overrides: Partial<PhoneNumberSummary> = {},
): PhoneNumberSummary {
  return {
    id: "num-1",
    status: "active",
    number_e164: "+13035550000",
    country: "US",
    requested_area_code: "303",
    source: "provisioned",
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  } as unknown as PhoneNumberSummary;
}

describe("partitionNumbers — which surface owns a row", () => {
  it("routes by the row's own `source`, not by an inference beside it", () => {
    const { provisioned, ported } = partitionNumbers(
      [
        numberRow({ id: "bought", source: "provisioned" }),
        numberRow({
          id: "transferred",
          source: "ported",
          requested_area_code: null,
          number_e164: "+13035551111",
        }),
      ],
      [],
    );
    expect(provisioned.map((n) => n.id)).toEqual(["bought"]);
    expect(ported.map((n) => n.id)).toEqual(["transferred"]);
  });

  it("keeps a bought number with no area code on a surface that draws it", () => {
    // THE HOLE. `requested_area_code === null` used to mean "ported"
    // unconditionally, so a provisioned row that reached the client without one
    // was handed to a stepper that never draws it — and the number vanished from
    // the product while still being billed for. `source` says what it is.
    const { provisioned, ported } = partitionNumbers(
      [numberRow({ source: "provisioned", requested_area_code: null })],
      [],
    );
    expect(ported).toEqual([]);
    expect(provisioned).toHaveLength(1);
  });

  it("still reads the old signals when the row predates `source`", () => {
    // The field is optional on the client type because a cached pre-wave shape
    // lacks it. Dropping the fallback would push every one of those rows onto
    // the card surface mid-transfer, with the "under a minute" provisioning
    // copy over a multi-day carrier window.
    const legacy = numberRow({ requested_area_code: null, number_e164: null });
    delete (legacy as { source?: string }).source;
    expect(partitionNumbers([legacy], []).ported).toHaveLength(1);

    const byNumber = numberRow({ number_e164: "+14165550142" });
    delete (byNumber as { source?: string }).source;
    expect(
      partitionNumbers([byNumber], [port({ phone_e164: "+14165550142" })])
        .ported,
    ).toHaveLength(1);
  });

  it("does not let an abandoned transfer claim a number back", () => {
    // A cancelled port left the number where it was. Matching on it would hide
    // a perfectly ordinary bought number behind a stepper that says the transfer
    // is off.
    const byNumber = numberRow({ number_e164: "+14165550142" });
    delete (byNumber as { source?: string }).source;
    const { provisioned } = partitionNumbers(
      [byNumber],
      [port({ phone_e164: "+14165550142", status: "cancelled" })],
    );
    expect(provisioned).toHaveLength(1);
  });
});

describe("numberForPort — the line a transfer delivered", () => {
  const transferred = port({ phone_e164: "+14165550142", status: "ported" });

  it("finds the row the transfer produced, by the number they share", () => {
    const row = numberRow({
      id: "ported-row",
      source: "ported",
      status: "suspended",
      requested_area_code: null,
      number_e164: "+14165550142",
    });
    expect(numberForPort(transferred, [numberRow(), row])?.id).toBe(
      "ported-row",
    );
  });

  it("answers null while the number has not arrived yet", () => {
    // Mid-transfer the `phone_numbers` row carries no E.164 at all, so there is
    // nothing to be suspended and nothing for the card to say. This is why the
    // hold branch can replace the transfer banner outright.
    const inFlight = numberRow({
      source: "ported",
      status: "provisioning",
      requested_area_code: null,
      number_e164: null,
    });
    expect(numberForPort(transferred, [inFlight])).toBeNull();
  });

  it("does not resolve a number that has been given up", () => {
    // A released row is not held; putting a hold note on it would offer a way
    // back to a number nobody has.
    const released = numberRow({
      source: "ported",
      status: "released",
      number_e164: "+14165550142",
    });
    expect(numberForPort(transferred, [released])).toBeNull();
  });
});
