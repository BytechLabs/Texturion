import { describe, expect, it } from "vitest";

import type {
  PhoneNumberSummary,
  TextEnablement,
  TextEnablementStatus,
} from "@/lib/api/types";

import {
  deriveTextEnableUiState,
  MAX_HOSTED_DOCUMENT_BYTES,
  onlyHostedNumbers,
  splitHostedNumbers,
  TEXT_ENABLE_STATE_COPY,
  textEnableFailedLine,
  validateHostedDocument,
} from "./text-enable-state";

/** Minimal order factory — only the fields the deriver reads matter. */
function order(overrides: Partial<TextEnablement> = {}): TextEnablement {
  return {
    id: "te-1",
    phone_e164: "+16135550100",
    country: "CA",
    status: "pending",
    has_loa: false,
    has_bill: false,
    last_error: null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-07-03T12:00:00Z",
    ...overrides,
  };
}

/** Minimal number factory for the partition helpers. */
function number(overrides: Partial<PhoneNumberSummary> = {}): PhoneNumberSummary {
  return {
    id: "num-1",
    status: "active",
    country: "CA",
    number_e164: "+16135550100",
    requested_area_code: "613",
    created_at: "2026-07-03T12:00:00Z",
    source: "provisioned",
    voice_enabled: true,
    ...overrides,
  };
}

describe("deriveTextEnableUiState — one honest status per state", () => {
  it("pending without documents: quiet waiting line, upload form open", () => {
    const ui = deriveTextEnableUiState(order({ status: "pending" }));
    expect(ui.statusLine).toBe(TEXT_ENABLE_STATE_COPY.pending);
    expect(ui.tone).toBe("muted");
    expect(ui.documentsPending).toBe(true);
    expect(ui.showDocumentsForm).toBe(true);
    expect(ui.canResubmit).toBe(false);
    expect(ui.cancellable).toBe(true);
    expect(ui.live).toBe(false);
  });

  it("pending with BOTH documents on file: nothing to upload, form hidden", () => {
    const ui = deriveTextEnableUiState(
      order({ status: "pending", has_loa: true, has_bill: true }),
    );
    expect(ui.documentsPending).toBe(false);
    expect(ui.showDocumentsForm).toBe(false);
  });

  it("action-required: warning tone, upload form open, no resubmit until docs fixed", () => {
    const ui = deriveTextEnableUiState(order({ status: "action-required" }));
    expect(ui.statusLine).toBe(TEXT_ENABLE_STATE_COPY.actionRequired);
    expect(ui.tone).toBe("warning");
    expect(ui.showDocumentsForm).toBe(true);
    expect(ui.canResubmit).toBe(false);
  });

  it("action-required with both documents on file: resubmit unlocks (docs can still be replaced)", () => {
    const ui = deriveTextEnableUiState(
      order({ status: "action-required", has_loa: true, has_bill: true }),
    );
    expect(ui.canResubmit).toBe(true);
    expect(ui.showDocumentsForm).toBe(true);
  });

  it("in-progress: carrier reviewing — no upload, no resubmit, still cancellable", () => {
    const ui = deriveTextEnableUiState(
      order({ status: "in-progress", has_loa: true, has_bill: true }),
    );
    expect(ui.statusLine).toBe(TEXT_ENABLE_STATE_COPY.inProgress);
    expect(ui.tone).toBe("muted");
    expect(ui.showDocumentsForm).toBe(false);
    expect(ui.canResubmit).toBe(false);
    expect(ui.cancellable).toBe(true);
  });

  it("completed: quiet done state — live, success tone, nothing actionable", () => {
    const ui = deriveTextEnableUiState(
      order({
        status: "completed",
        has_loa: true,
        has_bill: true,
        completed_at: "2026-07-08T09:00:00Z",
      }),
    );
    expect(ui.statusLine).toBe(TEXT_ENABLE_STATE_COPY.completed);
    expect(ui.tone).toBe("success");
    expect(ui.live).toBe(true);
    expect(ui.showDocumentsForm).toBe(false);
    expect(ui.canResubmit).toBe(false);
    expect(ui.cancellable).toBe(false);
  });

  it("failed: the carrier's reason verbatim + resubmit + re-upload window", () => {
    const ui = deriveTextEnableUiState(
      order({
        status: "failed",
        has_loa: true,
        has_bill: true,
        last_error: "The bill on file is older than 30 days.",
      }),
    );
    expect(ui.statusLine).toBe("The bill on file is older than 30 days.");
    expect(ui.tone).toBe("warning");
    expect(ui.canResubmit).toBe(true);
    expect(ui.showDocumentsForm).toBe(true);
    expect(ui.cancellable).toBe(true);
  });

  it("failed with no stored reason: calm fallback, never an empty banner", () => {
    for (const lastError of [null, "", "   "]) {
      expect(textEnableFailedLine(lastError)).toBe(
        TEXT_ENABLE_STATE_COPY.failedFallback,
      );
    }
    const ui = deriveTextEnableUiState(
      order({ status: "failed", last_error: null }),
    );
    expect(ui.statusLine).toBe(TEXT_ENABLE_STATE_COPY.failedFallback);
  });

  it("cancelled: terminal quiet note — nothing actionable at all", () => {
    const ui = deriveTextEnableUiState(
      order({ status: "cancelled", cancelled_at: "2026-07-04T10:00:00Z" }),
    );
    expect(ui.cancelled).toBe(true);
    expect(ui.statusLine).toBe(TEXT_ENABLE_STATE_COPY.cancelled);
    expect(ui.showDocumentsForm).toBe(false);
    expect(ui.canResubmit).toBe(false);
    expect(ui.cancellable).toBe(false);
  });

  it("cancel window matches the API: every non-terminal state is cancellable", () => {
    const cancellable: TextEnablementStatus[] = [
      "pending",
      "action-required",
      "in-progress",
      "failed",
    ];
    for (const status of cancellable) {
      expect(deriveTextEnableUiState(order({ status })).cancellable).toBe(true);
    }
    for (const status of ["completed", "cancelled"] as const) {
      expect(deriveTextEnableUiState(order({ status })).cancellable).toBe(
        false,
      );
    }
  });

  it("verification window matches the API gate: only while under review", () => {
    // routes/text-enablement.ts verificationGate — pending / action-required /
    // in-progress only. (Its no-vendor-order-yet half stays server-side.)
    const verifiable: TextEnablementStatus[] = [
      "pending",
      "action-required",
      "in-progress",
    ];
    for (const status of verifiable) {
      expect(deriveTextEnableUiState(order({ status })).canVerify).toBe(true);
    }
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(deriveTextEnableUiState(order({ status })).canVerify).toBe(false);
    }
  });

  it("failed keeps the raw carrier reason visible verbatim (API last_error contract)", () => {
    // The API persists the owner-facing copy WITH the raw Telnyx status —
    // rendered untouched, never summarized away.
    const lastError =
      "Carrier rejected the hosted-messaging order (Telnyx status: carrier_rejected)";
    const ui = deriveTextEnableUiState(order({ status: "failed", last_error: lastError }));
    expect(ui.statusLine).toBe(lastError);
    expect(ui.tone).toBe("warning");
  });
});

describe("validateHostedDocument — the PDF-only client gate", () => {
  const pdf = { size: 1024, type: "application/pdf", name: "loa.pdf" };

  it("accepts a normal PDF", () => {
    expect(validateHostedDocument(pdf)).toBeNull();
  });

  it("accepts a .pdf file whose browser type is empty (server defaults to PDF)", () => {
    expect(
      validateHostedDocument({ size: 1024, type: "", name: "Bill.PDF" }),
    ).toBeNull();
  });

  it("rejects empty and oversized files at the carrier's 5 MB hosted cap", () => {
    // The API's MAX_DOCUMENT_BYTES (routes/text-enablement.ts) — 5 MB,
    // stricter than porting's 10 MB.
    expect(MAX_HOSTED_DOCUMENT_BYTES).toBe(5 * 1024 * 1024);
    expect(validateHostedDocument({ ...pdf, size: 0 })).toMatch(/under 5 MB/);
    expect(
      validateHostedDocument({ ...pdf, size: MAX_HOSTED_DOCUMENT_BYTES + 1 }),
    ).toMatch(/under 5 MB/);
    expect(
      validateHostedDocument({ ...pdf, size: MAX_HOSTED_DOCUMENT_BYTES }),
    ).toBeNull();
  });

  it("rejects non-PDF types the porting form would accept (hosted is stricter)", () => {
    expect(
      validateHostedDocument({ size: 1024, type: "image/png", name: "loa.png" }),
    ).toMatch(/only PDF/);
    expect(
      validateHostedDocument({ size: 1024, type: "", name: "loa.png" }),
    ).toMatch(/only PDF/);
  });
});

describe("splitHostedNumbers — hosted rows never reach the NumberCard path", () => {
  it("partitions by source, defensively treating a missing source as not hosted", () => {
    const hostedRow = number({
      id: "num-h",
      source: "hosted",
      voice_enabled: false,
      requested_area_code: null,
    });
    const legacyRow = number({ id: "num-l", source: undefined });
    const { hosted, rest } = splitHostedNumbers([
      number(),
      hostedRow,
      legacyRow,
    ]);
    expect(hosted.map((n) => n.id)).toEqual(["num-h"]);
    expect(rest.map((n) => n.id)).toEqual(["num-1", "num-l"]);
  });

  it("keeps ported rows on the non-hosted side (the port stepper owns them)", () => {
    const { hosted, rest } = splitHostedNumbers([
      number({ id: "num-p", source: "ported", requested_area_code: null }),
    ]);
    expect(hosted).toEqual([]);
    expect(rest.map((n) => n.id)).toEqual(["num-p"]);
  });
});

describe("onlyHostedNumbers — the missed-calls caveat predicate", () => {
  const hosted = number({
    id: "num-h",
    source: "hosted",
    voice_enabled: false,
  });

  it("true when every live number is hosted", () => {
    expect(onlyHostedNumbers([hosted])).toBe(true);
  });

  it("false once any Loonext-carried number exists", () => {
    expect(onlyHostedNumbers([hosted, number()])).toBe(false);
    expect(
      onlyHostedNumbers([hosted, number({ id: "num-p", source: "ported" })]),
    ).toBe(false);
  });

  it("false with no numbers at all (nothing to caveat)", () => {
    expect(onlyHostedNumbers([])).toBe(false);
  });

  it("ignores released rows on both sides of the test", () => {
    // A released provisioned number doesn't rescue the caveat…
    expect(
      onlyHostedNumbers([hosted, number({ status: "released" })]),
    ).toBe(true);
    // …and a company whose only rows are released shows no caveat.
    expect(
      onlyHostedNumbers([{ ...hosted, status: "released" }]),
    ).toBe(false);
  });
});
