/**
 * #319 — a rejected number transfer, said in words the customer can act on.
 *
 * The translation catalogue and the notice that renders it both already
 * existed; only the registration surface was calling them, so a customer whose
 * transfer was refused read `LOA_MISMATCH` and a form. What is pinned here is
 * the wiring, because every part of it fails silently rather than loudly:
 *
 *   - the plain-language pair comes from the shared catalogue, so nobody can
 *     "improve" the port copy on web alone and drift from Android and iOS
 *   - an unrecognised reason KEEPS the raw banner. A generic sentence in its
 *     place would hide the only concrete thing the carrier gave us, and the
 *     screen would still look finished
 *   - the carrier's own words survive translation, so a support conversation
 *     can quote the string the customer is looking at
 *   - a person is offered on the second rejection, not the first
 *
 * Copy is asserted THROUGH `explainRejection` rather than as literals: the
 * catalogue is the source of truth, and a test that restates it becomes a
 * ceiling on editing it.
 */
import {
  explainRejection,
  RESUBMISSION_WAIT,
} from "@loonext/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PORT_STATE_COPY } from "@/components/porting/copy";
import type { PortRequest } from "@/lib/api/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({
    role: "owner",
    companyId: "co_1",
    membership: { name: "Ace Locksmith" },
  }),
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({
    data: { id: "co_1", name: "Ace Locksmith", plan: "pro" },
  }),
}));
vi.mock("@/lib/api/porting", () => {
  const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return {
    useCancelPortRequest: () => idle,
    useSubmitPortRequest: () => idle,
    useUpdatePortRequest: () => idle,
    useResubmitPortRequest: () => idle,
    useUploadPortDocuments: () => idle,
  };
});

import { PortCard } from "./port-card";

/** A transfer the carrier refused, with the reason it gave. */
function rejected(reason: string | null, submissionCount = 1): PortRequest {
  return {
    id: "port_1",
    phone_e164: "+14165550142",
    country: "CA",
    status: "exception",
    messaging_port_status: "pending",
    foc_date: null,
    rejection_reason: reason,
    submission_count: submissionCount,
    entity_name: "Ace Locksmith Ltd",
    auth_person_name: "Dana Chen",
    service_street: "12 King St W",
    service_locality: "Toronto",
    service_admin_area: "ON",
    service_postal_code: "M5H 1A1",
    has_loa: true,
    has_invoice: true,
    has_account_number: true,
    assignment_blocked: false,
    bridge_number_e164: null,
  } as unknown as PortRequest;
}

const render = (port: PortRequest) =>
  renderToStaticMarkup(<PortCard port={port} country="CA" />);

/**
 * React escapes quotes and ampersands on render, so copy holding an apostrophe
 * ("We've sent…") never appears in the markup as it appears in the source.
 * Escape the expectation rather than the assertion, so what a test names is
 * still the sentence a customer reads.
 */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** The catalogue entry a reason resolves to, or a hard failure if it does not. */
function guidanceFor(reason: string) {
  const guidance = explainRejection("port", reason);
  if (!guidance) throw new Error(`catalogue no longer matches: ${reason}`);
  return guidance;
}

describe("PortCard rejection guidance — #319", () => {
  it("translates the carrier's token into what happened and what to change", () => {
    const reason = "ACCOUNT_NUMBER_MISMATCH";
    const guidance = guidanceFor(reason);
    const html = render(rejected(reason));

    expect(html).toContain(esc(guidance.what));
    expect(html).toContain(esc(guidance.fix));
    // The untranslated banner is what #319 is replacing; both at once would be
    // the same rejection explained twice, in two voices.
    expect(html).not.toContain("Your carrier flagged something on the transfer");
  });

  it("keeps the carrier's own words on screen after translating them", () => {
    // Support quotes this string back; hiding it costs the only concrete
    // identifier the customer and the carrier share.
    expect(render(rejected("ACCOUNT_NUMBER_MISMATCH"))).toContain(
      "ACCOUNT_NUMBER_MISMATCH",
    );
  });

  it("states how long a resubmission takes", () => {
    // An unbounded second wait after a rejection is where people give up.
    expect(render(rejected("ACCOUNT_NUMBER_MISMATCH"))).toContain(
      esc(RESUBMISSION_WAIT.port),
    );
  });

  it("falls back to the raw reason when the catalogue does not recognise it", () => {
    // The honest failure. A rejection we cannot translate must still be shown.
    const reason = "ORDER REFUSED PER TARIFF 22B REF 88213";
    expect(explainRejection("port", reason)).toBeNull();

    const html = render(rejected(reason));
    expect(html).toContain(esc(PORT_STATE_COPY.voiceException(reason)));
    expect(html).toContain("REF 88213");
  });

  it("still says something when the carrier gave no reason at all", () => {
    const html = render(rejected(null));
    expect(html).toContain(esc(PORT_STATE_COPY.voiceException(null)));
  });

  it("offers a person on the second rejection, not the first", () => {
    // By the second, the customer has shown they cannot tell what is wrong from
    // what we have shown them; a third solo attempt buys another carrier review.
    expect(render(rejected("ACCOUNT_NUMBER_MISMATCH", 1))).not.toContain(
      "Get help from us",
    );

    const html = render(rejected("ACCOUNT_NUMBER_MISMATCH", 2));
    expect(html).toContain("Get help from us");
    // The transfer subject, not the registration one — the same inbox has to be
    // able to tell the two rejections apart.
    expect(html).toContain(
      encodeURIComponent("My number transfer keeps getting rejected"),
    );
  });

  it("offers the jump only when the catalogue names a field to fix", () => {
    // Nothing on this form fixes a pending order at the losing carrier, so
    // pointing at a field would send them round it for nothing.
    const stuckAtCarrier = "PENDING ORDER ON ACCOUNT";
    expect(guidanceFor(stuckAtCarrier).field).toBeNull();
    expect(render(rejected(stuckAtCarrier))).not.toContain("Take me to it");

    expect(guidanceFor("ACCOUNT_NUMBER_MISMATCH").field).toBe("account_number");
    expect(render(rejected("ACCOUNT_NUMBER_MISMATCH"))).toContain(
      "Take me to it",
    );
  });

  it("renders the fix form under the notice, so the correction is one screen", () => {
    const html = render(rejected("ACCOUNT_NUMBER_MISMATCH"));
    const guidance = guidanceFor("ACCOUNT_NUMBER_MISMATCH");
    expect(html).toContain("Fix and resubmit");
    expect(html.indexOf(esc(guidance.what))).toBeLessThan(
      html.indexOf("Fix and resubmit"),
    );
  });

  it("says nothing about rejections on a transfer that was not rejected", () => {
    const inFlight = { ...rejected(null), status: "in-process" } as PortRequest;
    const html = render(inFlight);
    expect(html).toContain(esc(PORT_STATE_COPY.submitted));
    expect(html).not.toContain(esc(RESUBMISSION_WAIT.port));
  });
});
