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
  roleHasCapability,
} from "@loonext/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PORT_STATE_COPY } from "@/components/porting/copy";
import { formatPhone } from "@/lib/format/phone";
import type {
  NumberStatus,
  PhoneNumberSummary,
  PortRequest,
} from "@/lib/api/types";

import type { NumberHoldState } from "./number-hold";

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
// #523: the card can now give the delivered line up, so it mounts the shared
// release dialog and its mutation.
vi.mock("@/lib/api/numbers", () => ({
  useReleaseNumber: () => ({ mutate: vi.fn(), isPending: false }),
}));

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

/**
 * #523: the `phone_numbers` row a completed transfer delivered. Its E.164 is the
 * port's, because that is how `numberForPort` resolves it — a row only carries
 * one after cutover, which is what makes "has the number arrived" answerable.
 */
function delivered(status: NumberStatus = "suspended"): PhoneNumberSummary {
  return {
    id: "n_ported",
    status,
    country: "CA",
    number_e164: "+14165550142",
    requested_area_code: null,
    created_at: "2026-07-01T00:00:00Z",
    source: "ported",
  } as unknown as PhoneNumberSummary;
}

const render = (
  port: PortRequest,
  hold?: NumberHoldState | null,
  /**
   * The delivered row and the plan state — both null/live by default, which is
   * the ordinary in-flight transfer every test above is about.
   */
  extra: {
    number?: PhoneNumberSummary | null;
    subscriptionActive?: boolean;
  } = {},
) =>
  renderToStaticMarkup(
    <PortCard
      port={port}
      country="CA"
      hold={hold}
      number={extra.number ?? null}
      subscriptionActive={extra.subscriptionActive ?? true}
    />,
  );

/** The transfer that worked: number moved, texting live. */
function completed(): PortRequest {
  return {
    ...rejected(null),
    status: "ported",
    messaging_port_status: "ported",
    rejection_reason: null,
  } as PortRequest;
}

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

/**
 * #523 — a transferred-in number that went on hold.
 *
 * THE STATE. Coming back is never refused, so a Pro workspace holding two
 * numbers can resubscribe on Starter and land on a plan that covers one. The
 * surplus stays suspended: still receiving, nothing released, and unable to send
 * or answer. The restore is oldest-first, which makes the most recently
 * TRANSFERRED line the likely one held.
 *
 * WHY THIS CARD. A ported number is de-duplicated out of the `NumberCard` list
 * on purpose, so this stepper is the only card it has — and the stepper reads
 * the port row, which knows the transfer completed and nothing about whether the
 * line still works. Untouched, it answered a held number with four green ticks,
 * "Live on Loonext", and "Text your customers straight from here".
 */
describe("PortCard on a held line — #523", () => {
  it("does not call a held number live", () => {
    const html = render(completed(), { kind: "over_allowance", allowance: 1 });
    expect(html).not.toContain("Live on Loonext");
    expect(html).not.toContain(esc(PORT_STATE_COPY.textingLive));
    expect(html).toContain("On hold");
  });

  it("says why, and where the way back is", () => {
    const html = render(completed(), { kind: "over_allowance", allowance: 1 });
    expect(html).toContain("covers 1 number");
    // The reassurance before the route, same order and same words as the card a
    // BOUGHT number gets — one workspace must not be told two stories about one
    // plan because one of its lines arrived by transfer.
    expect(html).toContain("nothing has been given up");
    expect(html).toContain('href="/settings/billing"');
  });

  it("keeps the grace-window answer distinct from an allowance hold", () => {
    // A cancelled workspace's numbers are suspended for a different reason with
    // a different fix; the payment-method sentence is true of exactly this one.
    const html = render(completed(), { kind: "subscription_inactive" });
    expect(html).toContain("Update your payment method");
    expect(html).not.toContain("On hold —");
  });

  it("promises nothing about the line working, whatever else is set", () => {
    // THE CLASS, not the sentence. This defect was fixed three times running -
    // the pill, then the heading, then the state banner - and each round the
    // next forward-looking sentence was missed. So this drives every state that
    // carries one AT ONCE and asserts none survives a hold. A banner added to
    // this card without a hold arm fails here rather than on somebody's screen.
    //
    // Asserted against the shipped copy constants rather than against phrases
    // typed here: my first version of this test looked for Android's wording
    // ("switches on automatically") where web says "retry automatically", so it
    // passed with the defect fully present. A guard that quotes a string nobody
    // renders is a guard that cannot fail.
    const held: NumberHoldState = { kind: "over_allowance", allowance: 1 };

    // 1. The transfer completed and the plan then held the line. Both the
    //    blocked-assignment chore and the stepper's present-tense descriptions
    //    live here.
    const done = {
      ...completed(),
      assignment_blocked: true,
    } as PortRequest;
    const doneHtml = render(done, held);
    for (const promise of [
      esc(PORT_STATE_COPY.assignmentBlocked(formatPhone(done.phone_e164))),
      esc(PORT_STATE_COPY.textingLive),
      "Turning on texting now",
      "Text your customers straight from Loonext",
    ]) {
      expect(doneHtml, promise).not.toContain(promise);
    }
    expect(doneHtml).toContain("On hold");

    // 2. Voice cut over, messaging still activating, so the card is not `live`
    //    and the temporary-number line renders. A held row is reachable here:
    //    the phone_numbers row exists from cutover, which is what a hold needs.
    const activating = {
      ...completed(),
      messaging_port_status: "activating",
      bridge_number_e164: "+14165559999",
    } as PortRequest;
    const midHtml = render(activating, held);
    expect(midHtml).not.toContain(
      esc(PORT_STATE_COPY.bridgeAvailable(formatPhone("+14165559999"))),
    );
    expect(midHtml).not.toContain("you can text today");
    expect(midHtml).toContain("On hold");
  });

  it("still celebrates a transfer that actually finished", () => {
    // The other direction, which is the common one: no hold, no change.
    const html = render(completed());
    expect(html).toContain("Live on Loonext");
    expect(html).toContain(esc(PORT_STATE_COPY.textingLive));
    expect(html).not.toContain("On hold");
  });

  it("offers no 'cancel this transfer' on a number that already moved", () => {
    // The voice cutover happened and texting is still being switched on, so the
    // card is not `live` and the owner cancel would normally still be offered.
    // The number is HERE, though — there is nothing left to call off. The server
    // agrees and always has: `POST /v1/port-requests/:id/cancel` 409s a `ported`
    // order, so this was an action the API would have refused. Under a held line
    // it reads as the way to get rid of it, which it is not.
    const switched = {
      ...completed(),
      messaging_port_status: "activating",
    } as PortRequest;
    expect(render(switched, null, { number: delivered("active") })).not.toContain(
      "Cancel this transfer",
    );
    expect(
      render(switched, { kind: "over_allowance", allowance: 1 }, { number: delivered() }),
    ).not.toContain("Cancel this transfer");
  });

  it("still offers it while the number is genuinely still elsewhere", () => {
    // The other side of the same rule, and the guard that stops the one above
    // being satisfied by deleting the cancel outright: no delivered row means
    // the line is still the old carrier's, and calling the transfer off is the
    // only thing there is to do with it.
    const inFlight = {
      ...completed(),
      status: "in-process",
      messaging_port_status: "pending",
    } as PortRequest;
    expect(render(inFlight)).toContain("Cancel this transfer");
  });

  it("lets the owner give a held ported line up — C2", () => {
    // THE DEFECT. Both phones could release a held number; web could not, and
    // web is where it matters most — the restore is oldest-first, so the most
    // recently TRANSFERRED line is the likeliest one held. A ported row is
    // de-duplicated out of the number cards on purpose, so this stepper is the
    // only card that line has, and the release had nowhere else to go.
    const html = render(
      completed(),
      { kind: "over_allowance", allowance: 1 },
      { number: delivered() },
    );
    expect(html).toContain("Release this number");
  });

  it("withholds the release while the payment is the problem", () => {
    // The same rule the number card applies (`mayReleaseNumber`): a past-due
    // workspace has every number suspended and the answer is the card.
    const html = render(
      completed(),
      { kind: "subscription_inactive" },
      { number: delivered(), subscriptionActive: false },
    );
    expect(html).not.toContain("Release this number");
  });

  it("offers the release to an owner only", () => {
    // `workspace.own`, the capability `DELETE /v1/numbers/:id` itself requires.
    // The whole file renders as an owner, so this asserts through the rule the
    // card calls rather than by re-mocking the provider mid-suite.
    expect(roleHasCapability("owner", "workspace.own")).toBe(true);
    for (const role of ["admin", "member"] as const) {
      expect(roleHasCapability(role, "workspace.own"), role).toBe(false);
    }
  });

  it("never offers both destructive controls at once", () => {
    // One card, one irreversible thing to do, decided by whether the number has
    // arrived. Two of them side by side is the reader choosing between actions
    // whose difference nobody explained.
    const cases: [string, string][] = [
      ["arrived", render(completed(), null, { number: delivered("active") })],
      ["arrived, held", render(completed(), { kind: "over_allowance", allowance: 1 }, { number: delivered() })],
      ["in flight", render({ ...completed(), status: "submitted" } as PortRequest)],
    ];
    for (const [label, html] of cases) {
      const both =
        html.includes("Release this number") &&
        html.includes("Cancel this transfer");
      expect(both, label).toBe(false);
    }
  });

  it("offers no cancel on an arrived number even where the release is refused", () => {
    // The release branch winning is not what hides the cancel — this is the
    // case where it does not win. A past-due workspace is refused the release
    // (`mayReleaseNumber`), and the cancel must not step into the gap: the
    // number is already ours and the order is `ported`, which the API 409s.
    const switched = {
      ...completed(),
      messaging_port_status: "activating",
    } as PortRequest;
    const html = render(
      switched,
      { kind: "subscription_inactive" },
      { number: delivered(), subscriptionActive: false },
    );
    expect(html).not.toContain("Release this number");
    expect(html).not.toContain("Cancel this transfer");
  });

  it("offers no cancel once the transferred number has been released", () => {
    // The case a gate reasoning about the NUMBER misses. `numberForPort`
    // deliberately ignores released rows, so an owner who gives the transferred
    // line up leaves a completed port with no row at all — and a card that asked
    // "is there a number?" instead of "did the transfer finish?" would answer by
    // offering to cancel a transfer that completed months ago.
    //
    // Messaging is still activating on purpose, so `ui.live` is false and the
    // old gate would wave the cancel straight through.
    const switched = {
      ...completed(),
      messaging_port_status: "activating",
    } as PortRequest;
    expect(render(switched, null, { number: null })).not.toContain(
      "Cancel this transfer",
    );
  });

  it("says nothing about a hold on a transfer still in flight", () => {
    // `PortSection` cannot resolve one either — a `phone_numbers` row carries no
    // E.164 until cutover, so there is nothing to be suspended. This pins the
    // card's half of that: no hold, no change to what the customer is told.
    const inFlight = {
      ...completed(),
      status: "in-process",
      messaging_port_status: "pending",
    } as PortRequest;
    expect(render(inFlight)).toContain(esc(PORT_STATE_COPY.submitted));
    expect(render(inFlight)).not.toContain("On hold");
  });
});
