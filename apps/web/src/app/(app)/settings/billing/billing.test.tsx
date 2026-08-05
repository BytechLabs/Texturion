/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANCELLATION_GRACE_DAYS,
  cancellationOffer,
  formatMoney,
  PLAN_PRICE_CENTS,
} from "@loonext/shared";

import { PLAN_PRICING, type CompanyView } from "@/lib/api/types";

import { PLAN_FACTS } from "./plan-facts";

describe("billing plan facts trace to PLAN_PRICING (findings 6 + 9)", () => {
  it("derives every plan's price from the shared constant", () => {
    expect(PLAN_FACTS.starter.price).toBe(
      `$${PLAN_PRICING.starter.monthlyDollars}/mo`,
    );
    expect(PLAN_FACTS.pro.price).toBe(`$${PLAN_PRICING.pro.monthlyDollars}/mo`);
  });

  it("frames texting as fair use, not a hard message count (#85)", () => {
    // The plan card no longer quotes 500/2,500 — the exact figure lives in the
    // fair-use policy the billing page links to, and the usage screen shows
    // real usage. The included line carries no hard count.
    for (const plan of ["starter", "pro"] as const) {
      expect(PLAN_FACTS[plan].included.toLowerCase()).toContain("fair use");
      expect(PLAN_FACTS[plan].included).not.toMatch(/\d/);
    }
  });

  it("derives seats, numbers (pluralized), and overage from the constant", () => {
    expect(PLAN_FACTS.starter.seats).toBe(
      `${PLAN_PRICING.starter.seats} team members`,
    );
    expect(PLAN_FACTS.pro.seats).toBe(`${PLAN_PRICING.pro.seats} team members`);

    // Starter's single number is singular; Pro's pair is plural.
    expect(PLAN_FACTS.starter.numbers).toBe(
      `${PLAN_PRICING.starter.numbers} phone number`,
    );
    expect(PLAN_FACTS.pro.numbers).toBe(
      `${PLAN_PRICING.pro.numbers} phone numbers`,
    );

    // #121: no per-text rate on the card; the figure lives in the fair-use
    // policy the billing page links to.
    expect(PLAN_FACTS.starter.overage).toBe(
      "Extra texts bill under fair use, up to a cap you control",
    );
    expect(PLAN_FACTS.pro.overage).toBe(
      "Extra texts bill under fair use, up to a cap you control",
    );
  });
});

/**
 * #277: the cancel screen.
 *
 * These are the pass/fail rules, not decoration. Cancelling may never take
 * more steps or more time than subscribing did, the question must be
 * skippable, and a dead analytics endpoint may never keep somebody
 * subscribed. Every one of those is a property of the screen that a later
 * "small copy change" could quietly remove, so each is pinned here.
 */
const {
  portal,
  record,
  exportContacts,
  checkout,
  changePlan,
  stated,
  dismiss,
  activeRole,
  companyQuery,
} = vi.hoisted(() => ({
  portal: { mutate: vi.fn(), isPending: false },
  record: { mutate: vi.fn() },
  exportContacts: { mutate: vi.fn(), isPending: false },
  checkout: { mutate: vi.fn(), isPending: false },
  changePlan: { mutate: vi.fn(), isPending: false },
  stated: {
    /** What GET /v1/billing/cancellation-reason answered, or nothing yet. */
    data: undefined as { reason: string | null; stated_at: string | null } | undefined,
    /** Whether the caller enabled the query at all — a gate, not decoration. */
    asked: undefined as boolean | undefined,
  },
  dismiss: { mutate: vi.fn() },
  /** The role the page renders for. Only the page-level tests move it. */
  activeRole: { current: "owner" },
  /** What `useCompany()` answers the PAGE with (the card tests pass props). */
  companyQuery: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/lib/api/billing", () => ({
  useBillingPortal: () => portal,
  useRecordCancellationReason: () => record,
  useCheckout: () => checkout,
  useChangePlan: () => changePlan,
  useCancellationReason: (enabled: boolean) => {
    stated.asked = enabled;
    return stated;
  },
  useDismissWinback: () => dismiss,
  // #490's count, on the page. Nothing renders from `undefined`, which is what
  // this suite wants: the win-back gate is what is under test, not the count.
  useMissedWhileOff: () => ({ data: undefined }),
}));
vi.mock("@/lib/api/contacts-export-hook", () => ({
  useExportContacts: () => exportContacts,
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: "company-1", role: activeRole.current }),
  useCompanyId: () => "company-1",
}));
vi.mock("@/lib/api/companies", () => ({
  useCompany: () => companyQuery,
  useUpdateCompany: () => ({ mutate: vi.fn(), isPending: false }),
}));

const PORTAL_URL = "https://billing.stripe.com/session/test";

const {
  CANCEL_ACTION,
  CANCEL_ADMIN_CONSEQUENCE,
  CANCEL_ADMIN_NOTE,
  CANCEL_CONSEQUENCE,
  CANCEL_EXPORT_ACTION,
  CANCELLATION_REASONS,
  CancelSubscriptionCard,
} = await import("@/components/settings/cancel-subscription-card");

const { HoldSentence, WinbackAnswer } = await import(
  "@/components/settings/cancellation-answer"
);

const { default: BillingSettingsPage } = await import("./page");

/**
 * A company shape with only the fields these screens read. Cast rather than
 * built out: `CompanyView` carries some eighty keys and a fixture that listed
 * them all would be a second, staler copy of the type.
 */
function company(overrides: Partial<CompanyView> = {}): CompanyView {
  return {
    id: "company-1",
    plan: "pro",
    country: "US",
    billing_currency: "usd",
    subscription_status: "active",
    registration_fee_paid_at: null,
    canceled_at: null,
    cancel_at_period_end: false,
    numbers: [],
    ...overrides,
  } as unknown as CompanyView;
}

/** `days` ago, as the webhook would have stamped `canceled_at`. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Render the card as somebody actually meets it, and return the control that
 * leaves. There is deliberately no interaction in here: every test below
 * measures its steps from a plain arrival on the billing screen, so a trigger
 * added in front of the card would have to be clicked somewhere visible rather
 * than hidden inside a helper.
 */
function renderCard(overrides: Partial<CompanyView> = {}): HTMLElement {
  render(<CancelSubscriptionCard isOwner company={company(overrides)} />);
  return screen.getByRole("button", { name: new RegExp(CANCEL_ACTION) });
}

afterEach(cleanup);

beforeEach(() => {
  portal.mutate.mockReset();
  portal.isPending = false;
  record.mutate.mockReset();
  exportContacts.mutate.mockReset();
  exportContacts.isPending = false;
  checkout.mutate.mockReset();
  checkout.isPending = false;
  changePlan.mutate.mockReset();
  changePlan.isPending = false;
  dismiss.mutate.mockReset();
  stated.data = undefined;
  stated.asked = undefined;
  activeRole.current = "owner";
  companyQuery.data = undefined;
});

describe("#277 saying why, on the way out", () => {
  it("CR-1: the codes are the ones every client sends", () => {
    // The label is this screen's; the CODE is the record, and a report that
    // counts `not_using` on one client and `unused` on another counts nothing.
    expect(CANCELLATION_REASONS.map((r) => r.code)).toEqual([
      "too_expensive",
      "seasonal",
      "missing_feature",
      "switched",
      "not_using",
      "other",
    ]);
    // The route answers 422 above 40 characters, and a 422 here would be a
    // reason silently lost at the last click.
    for (const { code } of CANCELLATION_REASONS) {
      expect(code.length, code).toBeLessThanOrEqual(40);
    }
  });

  it("CR-2: question, export offer and the way out are ONE screen", () => {
    // Not a funnel and not a modal: everything needed to decide is in the card,
    // beside the plan card that already offers the cheaper plan.
    const leave = renderCard();
    for (const { label } of CANCELLATION_REASONS) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
    expect(screen.getByText(CANCEL_EXPORT_ACTION)).toBeTruthy();
    expect(leave).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("CR-2a: the card arrives OPEN, so the exit costs one action", () => {
    // THE STEP COUNT. Before this card existed, the cancel path was a sentence
    // pointing at "Manage payment & invoices", one press from this screen to
    // Stripe. A card that has to be expanded before the leave button exists
    // makes that two, which is the thing regulators act on and the reason this
    // card may not borrow the collapse that guards account deletion.
    render(<CancelSubscriptionCard isOwner company={company()} />);

    // No click, no expand, no sheet: the control that leaves is in the FIRST
    // render, enabled.
    const leave = screen.getByRole("button", {
      name: new RegExp(CANCEL_ACTION),
    });
    expect(leave.hasAttribute("disabled")).toBe(false);

    // And it is one of exactly two buttons, which is what pins the absence of
    // BOTH a trigger in front of the card and a dismiss beside the confirm.
    // (The reason rows are role=radio, and "Clear" only exists once an answer
    // has been given, so neither counts here.)
    expect(
      screen.getAllByRole("button").map((button) => button.textContent?.trim()),
    ).toEqual([CANCEL_EXPORT_ACTION, CANCEL_ACTION]);
  });

  it("CR-3: nothing is pre-selected", () => {
    // A default answer is a reason we made up and then counted. It
    // misrepresents the person and poisons the report in the same stroke.
    renderCard();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(CANCELLATION_REASONS.length);
    for (const radio of radios) {
      expect(radio.getAttribute("aria-checked")).toBe("false");
    }
  });

  it("CR-4: ONE action reaches Stripe with nothing answered", () => {
    // The whole rule. No second dialog, no "are you sure", no
    // disabled-until-you-pick. One click from this screen to the portal.
    const leave = renderCard();
    expect(leave.hasAttribute("disabled")).toBe(false);

    fireEvent.click(leave);
    expect(portal.mutate).toHaveBeenCalledTimes(1);
  });

  it("CR-5: skipping is RECORDED as a skip, not as an opinion", () => {
    // An empty body is a valid record meaning they were asked and said
    // nothing, which is a different number from never having been asked.
    fireEvent.click(renderCard());
    expect(record.mutate).toHaveBeenCalledWith({ reason: null, detail: null });
  });

  it("CR-6: an answer travels with the handoff", () => {
    const leave = renderCard();
    fireEvent.click(screen.getByRole("radio", { name: "Too expensive" }));
    fireEvent.change(
      screen.getByLabelText("Anything else worth telling us (optional)"),
      { target: { value: "  Pro is more than we use.  " } },
    );
    fireEvent.click(leave);

    expect(record.mutate).toHaveBeenCalledWith({
      reason: "too_expensive",
      detail: "Pro is more than we use.",
    });
    expect(portal.mutate).toHaveBeenCalledTimes(1);
  });

  it("CR-7: an answer given by accident can be taken back", () => {
    // A radio cannot be un-picked. Without this the only way out of a stray
    // click is to say something they did not mean.
    const leave = renderCard();
    fireEvent.click(screen.getByRole("radio", { name: "Not using it" }));
    fireEvent.click(screen.getByText("Clear"));
    fireEvent.click(leave);

    expect(record.mutate).toHaveBeenCalledWith({ reason: null, detail: null });
  });

  it("CR-8: a dead reason endpoint cannot keep anybody subscribed", () => {
    // The one that matters at 2am, and it is the ORDER that guarantees it: the
    // handoff is already issued before the note is attempted, so no failure on
    // the note's path can precede it, delay it or replace it. Putting the note
    // first, the obvious way to write this, fails here.
    record.mutate.mockImplementation(() => {
      throw new Error("cancellation-reason is down");
    });
    const leave = renderCard();
    fireEvent.click(leave);

    expect(portal.mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("CR-9: the portal is opened, and its failure is the one that shows", () => {
    portal.mutate.mockImplementation(
      (
        _input: undefined,
        options: { onSuccess: (result: { url: string }) => void },
      ) => options.onSuccess({ url: PORTAL_URL }),
    );
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});

    fireEvent.click(renderCard());
    expect(assign).toHaveBeenCalledWith(PORTAL_URL);
  });

  it("CR-10: leaving is the loudest thing in the card", () => {
    // The dark pattern this card exists to avoid is an exit that is smaller,
    // greyer or lower-contrast than whatever keeps somebody subscribed. The
    // way out is the only primary here; the export beside it is an outline,
    // and nothing at all competes with the confirm.
    const leave = renderCard();
    expect(leave.getAttribute("data-variant")).toBe("default");
    expect(
      screen.getByText(CANCEL_EXPORT_ACTION).getAttribute("data-variant"),
    ).toBe("outline");
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.getAttribute("data-variant") === "default"),
    ).toHaveLength(1);
  });

  it("CR-11: they can take their contacts, all of them", () => {
    // "We made it hard to leave with your data" is the story told about us
    // afterwards. "" is every contact, not the slice a search box was showing.
    renderCard();
    fireEvent.click(screen.getByText(CANCEL_EXPORT_ACTION));
    expect(exportContacts.mutate.mock.calls[0][0]).toBe("");
  });

  it("CR-12: a long note is trimmed here, not refused there", () => {
    // The route caps `detail` at 2,000 and answers 422 above it. Discovering
    // that at the last click would lose both the note and the moment.
    const leave = renderCard();
    fireEvent.change(
      screen.getByLabelText("Anything else worth telling us (optional)"),
      { target: { value: "x".repeat(2500) } },
    );
    fireEvent.click(leave);

    const sent = record.mutate.mock.calls[0][0] as { detail: string };
    expect(sent.detail).toHaveLength(2000);
  });

  it("CR-13: no guilt, no pleading, no second-guessing", () => {
    // How we behave on the way out is the referral channel (#399). This screen
    // records an answer; it does not argue with the decision.
    renderCard();
    const copy = document.body.textContent?.toLowerCase() ?? "";
    for (const pitch of [
      "are you sure",
      "sure you want",
      "reconsider",
      "we're sad",
      "miss you",
      "think again",
      "one last",
      "wait!",
    ]) {
      expect(copy, `copy must not say "${pitch}"`).not.toContain(pitch);
    }
  });

  it("CR-14: an admin is told who can, not sent to a page that cannot", () => {
    // #421 split the portal by role: an admin lands on Stripe's card-update
    // flow, which has no cancellation surface at all.
    render(<CancelSubscriptionCard isOwner={false} company={company()} />);
    expect(screen.getByText(CANCEL_ADMIN_NOTE)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("CR-15: an admin is not promised something and then denied it", () => {
    // The owner's copy opens "Cancel anytime", which is true for the person it
    // is shown to and a runaround for anybody else: read directly above "only
    // the owner can cancel" it says the screen is either broken or stalling.
    // The non-owner gets the same three facts, said about the owner.
    render(<CancelSubscriptionCard isOwner={false} company={company()} />);
    expect(screen.queryByText(CANCEL_CONSEQUENCE)).toBeNull();

    const copy = screen.getByText(CANCEL_ADMIN_CONSEQUENCE).textContent ?? "";
    // Still says what cancelling COSTS, which is the part an admin relays.
    expect(copy).toMatch(/30 days/);
    expect(copy.toLowerCase()).toContain("texting stops");
    expect(copy.toLowerCase()).not.toContain("cancel anytime");
  });

  it("CR-16: the hold is counted from the CANCELLATION, in both voices", () => {
    // The expensive sentence on this card. `runGraceJob` measures
    // `now - companies.canceled_at`, and `startCancellationLifecycle` stamps
    // that column from Stripe's own `subscription.canceled_at` — which for a
    // `cancel_at_period_end` cancellation is the moment cancelling was
    // REQUESTED, not the end of the period. The vendored `Subscriptions.d.ts`
    // says so in as many words: "the time of the most recent update request,
    // not the end of the subscription period".
    //
    // So "texting stops at the end of your billing period, and we hold your
    // number for 30 days" has exactly one reading and it is the wrong one:
    // cancel on day 2 of a month and you count ~59 days when you have ~30.
    // Wrong in the customer's favour about a deadline is the expensive
    // direction, and what is lost at the end of the miscount is the number on
    // the van.
    expect(CANCEL_CONSEQUENCE).toMatch(
      new RegExp(`${CANCELLATION_GRACE_DAYS} days from the day you cancel`),
    );
    expect(CANCEL_ADMIN_CONSEQUENCE).toMatch(
      new RegExp(`${CANCELLATION_GRACE_DAYS} days from the day they cancel`),
    );
  });
});

/**
 * The two shapes of sentence that cannot be true on this card.
 *
 * They are separate because the defect has two forms and the obvious guard only
 * catches one of them. Written the first time as HOLD_ANCHORED_TO_PERIOD alone,
 * this passed against the exact copy that shipped — proof that a guard nobody
 * has broken is a guard nobody has tested.
 *
 *   ANCHORED_TO_PERIOD  "30 days after your billing period ends". Explicit, and
 *                       the shape `cancellation-offers.test.ts` bans module-
 *                       wide. Deliberately NOT a ban on the phrase "billing
 *                       period" — texting really does stop at period end and a
 *                       downgrade really does apply then, and both sentences say
 *                       so. What is banned is tying the DAYS to it.
 *   STATED_WITHOUT_ANCHOR
 *                       "texting stops at the end of your billing period, and
 *                       we hold your number for 30 days". This is what actually
 *                       shipped. It names no anchor at all, which is precisely
 *                       why it is dangerous: the reader takes the anchor from
 *                       the clause in front of it, and that clause is the period
 *                       end. So the rule is not "do not name the period" but
 *                       "every duration on this card names where it starts".
 *
 * Both run over rendered text rather than against a constant, because the defect
 * they catch is a CONTRADICTION between constants that are each defensible on
 * their own: the consequence line said one anchor and the seasonal answer, four
 * lines below it on the same card, said the other.
 */
const HOLD_ANCHORED_TO_PERIOD =
  /\b\d+[\s-]+days?\s+(after|from|following)\s+(your|the|that)[^.]{0,28}period/i;

const HOLD_STATED_WITHOUT_ANCHOR = new RegExp(
  // A count of days with no "from the day you/they cancel(led)" close behind it.
  String.raw`\b${CANCELLATION_GRACE_DAYS}[\s-]+days?\b(?![\s\S]{0,48}?from the day (you|they) cancel)`,
  "i",
);

/**
 * The offer, or the absence of one, for the reason somebody just picked.
 *
 * Throws rather than returning null, so a test that means to assert copy can
 * never quietly assert nothing.
 */
function offerFor(input: Parameters<typeof cancellationOffer>[0]) {
  const offer = cancellationOffer(input);
  if (!offer) throw new Error(`expected an offer for ${JSON.stringify(input)}`);
  return offer;
}

/** Pick one of the six reasons, by the words on its label. */
function pick(label: string): void {
  fireEvent.click(screen.getByRole("radio", { name: label }));
}

/** The buttons the card carries once a reason has been given, and no offer. */
const QUIET_CARD_BUTTONS = ["Clear", CANCEL_EXPORT_ACTION, CANCEL_ACTION];

/**
 * #277 follow-up — answering the reason, without standing in the doorway.
 *
 * The card already asked why and said nothing back. Three of the six reasons
 * have a true and useful answer the person has no way of knowing; the other
 * three (and Starter's "too expensive") have none, and the pass/fail rule for
 * those is that we say NOTHING rather than something softer.
 *
 * The rule that outranks all of it is the step count: answering an optional
 * question must never cost more than skipping it.
 */
describe("#277 follow-up: answering the reason, on the cancel card", () => {
  it("OFFER-1: says nothing at all until a reason is picked", () => {
    // A plain arrival on this screen is byte-for-byte the screen it was before
    // this shipped — CR-2a's two buttons, and no answer to a question nobody
    // has answered.
    renderCard();
    for (const { code } of CANCELLATION_REASONS) {
      const offer = cancellationOffer({ reason: code, plan: "pro" });
      if (offer) expect(screen.queryByText(offer.heading), code).toBeNull();
    }
  });

  it("OFFER-2: THE EXIT DOES NOT MOVE — the answer renders after the button", () => {
    const leave = renderCard();
    pick("Too expensive");

    const heading = screen.getByText(
      offerFor({ reason: "too_expensive", plan: "pro" }).heading,
    );
    // The whole constraint, in one assertion. The answer is a heading, four or
    // five lines and a control — around 160px. On a 375px phone `Continue to
    // cancel` already sits roughly two screens below the top of this page, so
    // anything inserted ABOVE it is scrolling added to leaving, in direct
    // response to somebody having cooperated with an optional question. So it
    // goes last, and this is what stops a later "it reads better up there".
    expect(
      leave.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // And leaving is unchanged: one action, enabled, nothing in the way.
    expect(leave.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(leave);
    expect(portal.mutate).toHaveBeenCalledTimes(1);
  });

  it("OFFER-3: quotes Starter's real price, from the book", () => {
    renderCard();
    pick("Too expensive");
    const copy = document.body.textContent ?? "";
    expect(copy).toContain(formatMoney(PLAN_PRICE_CENTS.usd.starter, "usd"));
    expect(copy).toContain(formatMoney(PLAN_PRICE_CENTS.usd.pro, "usd"));
  });

  it("OFFER-3a: a Canadian workspace is never quoted a US price", () => {
    // #328: the one screen where the number is the whole content. Reading
    // "$29" beside a Canadian invoice for $39 is the credibility wobble that
    // whole change exists to remove.
    renderCard({ billing_currency: "cad" });
    pick("Too expensive");
    const copy = document.body.textContent ?? "";
    expect(copy).toContain(formatMoney(PLAN_PRICE_CENTS.cad.starter, "cad"));
    expect(copy).not.toContain(
      formatMoney(PLAN_PRICE_CENTS.usd.starter, "usd"),
    );
  });

  it("OFFER-4: a Starter workspace is offered NOTHING for 'too expensive'", () => {
    // There is no cheaper plan. Inventing one is exactly the dishonesty #277
    // forbids, and a softer sentence about the price being fair is an argument
    // with somebody who has just told us it is not, on the screen they came to
    // leave from.
    renderCard({ plan: "starter" });
    pick("Too expensive");
    expect(
      screen.queryByText(offerFor({ reason: "too_expensive", plan: "pro" }).heading),
    ).toBeNull();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent?.trim()),
    ).toEqual(QUIET_CARD_BUTTONS);
  });

  it("OFFER-5: the three reasons with no honest answer get no answer", () => {
    // We do not know what they switched to, and the export and the exit are
    // already on the card for the other two. Silence is the correct content.
    for (const label of [
      "Going with something else",
      "Not using it",
      "Something else",
    ]) {
      renderCard();
      pick(label);
      expect(
        screen.getAllByRole("button").map((b) => b.textContent?.trim()),
        label,
      ).toEqual(QUIET_CARD_BUTTONS);
      cleanup();
    }
  });

  it("OFFER-6: seasonal is words only — there is nothing to press", () => {
    // There is no pause feature. The answer is about the hold that already
    // exists, so it has no control, and a button here would imply a product we
    // do not sell.
    renderCard();
    pick("Quiet season, I'll be back");
    const offer = offerFor({ reason: "seasonal", plan: "pro" });
    expect(screen.getByText(offer.heading)).toBeTruthy();
    expect(screen.getByText(offer.body)).toBeTruthy();
    expect(
      screen.getAllByRole("button").map((b) => b.textContent?.trim()),
    ).toEqual(QUIET_CARD_BUTTONS);
  });

  it("OFFER-7: the registration-fee promise needs a paid fee", () => {
    // Gated on the timestamp, not on country: `registration_fee_paid_at` is
    // exactly what checkout tests before adding the one-time line. A workspace
    // that has NOT paid it WILL be charged on return, so for them the sentence
    // is absent rather than softened.
    renderCard({ registration_fee_paid_at: "2026-01-05T00:00:00.000Z" });
    pick("Quiet season, I'll be back");
    expect(document.body.textContent).toContain("registration fee");
    cleanup();

    renderCard();
    pick("Quiet season, I'll be back");
    expect(document.body.textContent).not.toContain("registration fee");
  });

  it("OFFER-8: 'missing something' routes to the help screen", () => {
    // The offer names a CONTROL, never a route — a URL returned from the shared
    // module would be wrong on two of the three clients. Web's control is the
    // in-product help page (#382).
    renderCard();
    pick("Missing something I need");
    const offer = offerFor({ reason: "missing_feature", plan: "pro" });
    expect(
      screen.getByRole("link", { name: offer.actionLabel ?? "" }).getAttribute("href"),
    ).toBe("/settings/help");
  });

  it("OFFER-9: leaving stays the loudest thing in the card", () => {
    // CR-10's rule, re-checked in the two states that could break it. The dark
    // pattern this card exists to avoid is an exit that is quieter than
    // whatever keeps somebody subscribed, so every control the offer can put on
    // screen has to be checked, not just the first one.
    for (const label of ["Too expensive", "Missing something I need"]) {
      renderCard();
      pick(label);
      const primaries = [
        ...screen.getAllByRole("button"),
        ...screen.queryAllByRole("link"),
      ].filter((node) => node.getAttribute("data-variant") === "default");
      expect(primaries.map((n) => n.textContent?.trim()), label).toEqual([
        CANCEL_ACTION,
      ]);
      cleanup();
    }
  });

  it("OFFER-10: the control is the plan switcher already on this screen", () => {
    // `change_plan` means the ChangePlanDialog, not a second implementation of
    // switching plans. Its trigger derives its own label from the company's
    // plan while `actionLabel` is shared across three clients — two places
    // arriving at the same words is precisely how they stop matching, so the
    // equality is pinned rather than assumed.
    renderCard();
    pick("Too expensive");
    const offer = offerFor({ reason: "too_expensive", plan: "pro" });
    const control = screen.getByRole("button", {
      name: offer.actionLabel ?? "",
    });
    expect(control.getAttribute("aria-haspopup")).toBe("dialog");
    expect(control.getAttribute("data-state")).toBe("closed");
    expect(changePlan.mutate).not.toHaveBeenCalled();
  });

  it("OFFER-11: taking the answer back takes the offer with it", () => {
    renderCard();
    pick("Too expensive");
    const { heading } = offerFor({ reason: "too_expensive", plan: "pro" });
    expect(screen.getByText(heading)).toBeTruthy();

    fireEvent.click(screen.getByText("Clear"));
    expect(screen.queryByText(heading)).toBeNull();
  });

  it("OFFER-12: still no guilt, whichever answer is on screen", () => {
    // CR-13 with the offer rendered. How we behave on the way out is the
    // referral channel (#399); an answer is not permission to argue.
    for (const { label } of CANCELLATION_REASONS) {
      renderCard();
      pick(label);
      const copy = (document.body.textContent ?? "").toLowerCase();
      for (const pitch of [
        "are you sure",
        "sure you want",
        "reconsider",
        "we're sad",
        "miss you",
        "think again",
        "one last",
        "wait!",
        "don't go",
      ]) {
        expect(copy, `"${label}" must not say "${pitch}"`).not.toContain(pitch);
      }
      cleanup();
    }
  });

  it("OFFER-13: every duration on the card says where it is counted from", () => {
    // The whole card, in every state it can reach, rather than the two strings
    // that were wrong. This shipped as a contradiction: the consequence line at
    // the top said "texting stops at the end of your billing period, and we
    // hold your number for 30 days" while the seasonal answer a few lines below
    // said the 30 days run from the day you cancel. Both were on screen at
    // once, to one person, deciding whether to leave — and only one of them can
    // be checked against `runGraceJob`.
    //
    // Period-first, then anchor: the two catch different rewrites of the same
    // false statement, and running them in this order is what lets each one be
    // proven by breaking it.
    const surfaces: [string, () => void][] = CANCELLATION_REASONS.map(
      ({ label }) => [
        label,
        () => {
          renderCard();
          pick(label);
        },
      ],
    );
    // Including the version an admin reads and relays to the owner — an admin
    // who counts the deadline wrong passes the wrong deadline on.
    surfaces.push([
      "admin",
      () => render(<CancelSubscriptionCard isOwner={false} company={company()} />),
    ]);

    for (const [name, mount] of surfaces) {
      mount();
      const copy = document.body.textContent ?? "";
      expect(copy, name).not.toMatch(HOLD_ANCHORED_TO_PERIOD);
      expect(copy, name).not.toMatch(HOLD_STATED_WITHOUT_ANCHOR);
      cleanup();
    }
  });
});

/**
 * #277 follow-up — the same answer again, while the number can still be saved.
 *
 * The day 1/15/27 grace emails all link to /settings/billing, so this card is
 * seen on a cadence rather than once. The gates below are what keep that from
 * becoming nagging: it is bounded by the release deadline, it can be waved
 * away, and it stays away for that cancellation.
 */
describe("#277 follow-up: the win-back inside the canceled-state card", () => {
  function renderWinback(overrides: Partial<CompanyView> = {}) {
    render(
      <WinbackAnswer
        company={company({
          subscription_status: "canceled",
          canceled_at: daysAgo(3),
          ...overrides,
        })}
      />,
    );
  }

  it("WIN-1: answers the stated reason, in the grace voice", () => {
    stated.data = { reason: "too_expensive", stated_at: daysAgo(3) };
    renderWinback();

    const grace = offerFor({
      reason: "too_expensive",
      plan: "pro",
      phase: "grace",
    });
    expect(screen.getByText(grace.heading)).toBeTruthy();
    expect(screen.getByText(grace.body)).toBeTruthy();
    // Not the cancel card's wording: the subscription is over, so the verb is
    // coming back rather than switching.
    expect(
      screen.queryByText(offerFor({ reason: "too_expensive", plan: "pro" }).heading),
    ).toBeNull();
  });

  it("WIN-2: the control comes back on STARTER, not on the plan they left", () => {
    // They left because Pro was too expensive. A control that puts them back on
    // Pro answers nothing, and `company.plan` is Pro.
    stated.data = { reason: "too_expensive", stated_at: daysAgo(3) };
    renderWinback();
    const grace = offerFor({
      reason: "too_expensive",
      plan: "pro",
      phase: "grace",
    });
    fireEvent.click(screen.getByRole("button", { name: grace.actionLabel ?? "" }));
    expect(checkout.mutate.mock.calls[0][0]).toBe("starter");
  });

  it("WIN-3: past the release it is gone, and the reason is not even asked", () => {
    // After release the number is back in carrier inventory and reassignable
    // to another business (#413), so "come back and keep your number" stops
    // being true at exactly this boundary.
    stated.data = { reason: "seasonal", stated_at: daysAgo(40) };
    renderWinback({ canceled_at: daysAgo(CANCELLATION_GRACE_DAYS + 1) });
    expect(document.body.textContent).toBe("");
    expect(stated.asked).toBe(false);
  });

  it("WIN-3a: the day before the release, it is still true", () => {
    stated.data = { reason: "seasonal", stated_at: daysAgo(29) };
    renderWinback({ canceled_at: daysAgo(CANCELLATION_GRACE_DAYS - 1) });
    expect(stated.asked).toBe(true);
    expect(
      screen.getByText(
        offerFor({ reason: "seasonal", plan: "pro", phase: "grace" }).heading,
      ),
    ).toBeTruthy();
  });

  it("WIN-4: a dismissal belongs to ONE cancellation", () => {
    stated.data = { reason: "seasonal", stated_at: daysAgo(3) };

    // Waved away after this cancellation: gone, and not asked for again.
    renderWinback({ winback_dismissed_at: daysAgo(2) });
    expect(document.body.textContent).toBe("");
    expect(stated.asked).toBe(false);
    cleanup();

    // A stamp from a PREVIOUS cancellation suppresses nothing. This is the
    // whole reason the column is a timestamp compared against `canceled_at`
    // rather than a boolean: somebody who dismisses this, resubscribes, and
    // leaves again a year later gets the offer back, and nothing has to clear
    // anything for that to happen.
    stated.asked = undefined;
    renderWinback({ winback_dismissed_at: daysAgo(400) });
    expect(stated.asked).toBe(true);
    expect(document.body.textContent).not.toBe("");
  });

  it("WIN-5: 'No thanks' hides it at once and records it", () => {
    // Hidden first, sent second. A preference must never wait on a round trip,
    // and a failed dismissal is silent — the worst case is that it comes back
    // next visit, which beats an alert telling somebody who is leaving that our
    // server would not take their "no thanks".
    stated.data = { reason: "seasonal", stated_at: daysAgo(3) };
    renderWinback();
    fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(dismiss.mutate).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toBe("");
  });

  it("WIN-6: nothing honest to say means nothing on screen", () => {
    for (const reason of ["switched", "not_using", "other"]) {
      stated.data = { reason, stated_at: daysAgo(3) };
      renderWinback();
      expect(document.body.textContent, reason).toBe("");
      cleanup();
    }

    // And a workspace already on the cheapest plan is not sold a cheaper one.
    stated.data = { reason: "too_expensive", stated_at: daysAgo(3) };
    renderWinback({ plan: "starter" });
    expect(document.body.textContent).toBe("");
    cleanup();

    // Somebody who was asked and skipped the question is not guessed at.
    stated.data = { reason: null, stated_at: daysAgo(3) };
    renderWinback();
    expect(document.body.textContent).toBe("");
  });

  it("WIN-7: no skeleton and no error box while the answer is unknown", () => {
    // A supporting note on somebody else's screen. A broken box where a
    // sentence should be makes the billing itself look broken.
    stated.data = undefined;
    renderWinback();
    expect(document.body.textContent).toBe("");
  });

  it("WIN-8: a healthy workspace never pays for the question", () => {
    stated.data = { reason: "seasonal", stated_at: daysAgo(3) };
    renderWinback({ subscription_status: "active", canceled_at: null });
    expect(stated.asked).toBe(false);
    expect(document.body.textContent).toBe("");
  });
});

/**
 * #277 follow-up — the date the number actually dies on.
 *
 * This card used to say "we hold your number for 30 days after your last
 * period". The release job measures from `canceled_at`, which the webhook
 * stamps from Stripe's own `subscription.canceled_at` — the moment cancelling
 * was REQUESTED. On a cancel-at-period-end those are different dates, by up to
 * a month, and the old sentence was wrong in the customer's favour.
 */
describe("#277 follow-up: the deadline on the canceled-state card", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** The same UTC formatting `releaseDateLabel` uses for the day-27 email. */
  function utcDay(when: number): string {
    return new Date(when).toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  it("HOLD-1: counts from `canceled_at`, in UTC, not from the period end", () => {
    // 00:30 UTC on purpose: for any reader west of UTC that instant is the
    // PREVIOUS day locally, so a component that formatted in the reader's zone
    // prints a date one day early and fails here. (On a UTC box the two agree
    // and this cannot discriminate — it still never fails falsely.)
    const midnightish = new Date();
    midnightish.setUTCHours(0, 30, 0, 0);
    const canceledAt = new Date(midnightish.getTime() - 3 * DAY_MS);
    const periodEnd = new Date(Date.now() + 20 * DAY_MS);

    render(
      <HoldSentence
        company={company({
          canceled_at: canceledAt.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })}
      />,
    );

    const copy = document.body.textContent ?? "";
    expect(copy).toContain(
      utcDay(canceledAt.getTime() + CANCELLATION_GRACE_DAYS * DAY_MS),
    );
    // The date it would print if it ever went back to counting from the period.
    expect(copy).not.toContain(utcDay(periodEnd.getTime()));
  });

  it("HOLD-2: past the hold it says the hold ENDED, and promises no old number", () => {
    // Deliberately not "your number has been released": the release cron runs
    // daily, so between the deadline and the next sweep the number may still be
    // ours. The claim that is true at exactly this boundary is about the hold.
    render(
      <HoldSentence
        company={company({ canceled_at: daysAgo(CANCELLATION_GRACE_DAYS + 2) })}
      />,
    );
    const copy = (document.body.textContent ?? "").toLowerCase();
    expect(copy).toContain("ended on");
    expect(copy).toContain("new number");
    expect(copy).not.toContain("hold your number until");
    expect(copy).not.toContain("picks up where it left off");
  });

  it("HOLD-2a: says nothing only the release cron can make true", () => {
    // This branch flips on the READER'S clock at `canceled_at + 30d`. Release
    // runs on a once-daily cron (`0 14 * * *`) and can fail and retry, so for
    // up to a day the sentence and the world disagree — and in that window the
    // old number is still recoverable: `handleCheckoutCompleted` runs
    // `.update({status:"active"}).eq("status","suspended")` with no plan
    // filter, so a resubscribe hands the same number straight back.
    //
    // Each phrase below is an outcome only the job can produce. "sets you up
    // with a new number" is the one that shipped, and it is the same defect as
    // "your number has been released" wearing different words: both tell
    // somebody the number is gone at a moment when pressing Resubscribe would
    // have kept it.
    render(
      <HoldSentence
        company={company({ canceled_at: daysAgo(CANCELLATION_GRACE_DAYS + 2) })}
      />,
    );
    const copy = (document.body.textContent ?? "").toLowerCase();
    for (const cronOnly of [
      "has been released",
      "have been released",
      "is released",
      "gone back to the phone company",
      "belongs to someone else",
      "sets you up with a new number",
    ]) {
      expect(copy, cronOnly).not.toContain(cronOnly);
    }
  });

  it("HOLD-4: the release date carries a YEAR, in both dated branches", () => {
    // `releaseDateLabel` prints this same date into the day-27 grace email as
    // "August 4, 2026", and that email links here. A screen answering
    // "4 August" is a second, vaguer answer to the question the mail raised.
    // The branch that actually needs the year is the EXPIRED one: it is read by
    // definition after the deadline, on a workspace that may have been sitting
    // cancelled for a year, where a yearless date is not a date at all.
    for (const days of [
      CANCELLATION_GRACE_DAYS - 2,
      CANCELLATION_GRACE_DAYS + 2,
    ]) {
      const canceledAt = daysAgo(days);
      // Derived, never `new Date().getFullYear()`: a run on 20 December would
      // otherwise expect this year for a release date that lands in the next.
      const year = String(
        new Date(
          Date.parse(canceledAt) + CANCELLATION_GRACE_DAYS * DAY_MS,
        ).getUTCFullYear(),
      );
      render(<HoldSentence company={company({ canceled_at: canceledAt })} />);
      expect(document.body.textContent ?? "", `${days} days ago`).toContain(
        year,
      );
      cleanup();
    }
  });

  it("HOLD-3: with no `canceled_at`, no date is invented", () => {
    render(<HoldSentence company={company({ canceled_at: null })} />);
    const copy = document.body.textContent ?? "";
    // The general rule, said as a rule.
    expect(copy).toContain(
      `${CANCELLATION_GRACE_DAYS} days from the day you cancel`,
    );
    // NOT a deadline sentence with the date missing out of it. React renders a
    // null date as nothing, so "…ended on ." is a shape this can actually take
    // — the digit check below passes on it, and it is worse than the rule.
    expect(copy).not.toContain("ended on");
    expect(copy).not.toContain("until");
    // And 30 is the only number on screen: no day, no month, no made-up date.
    expect(copy.match(/\d+/g)).toEqual([String(CANCELLATION_GRACE_DAYS)]);
  });
});

/**
 * #315 — who this screen is FOR, asked as a capability rather than a rank.
 *
 * The page gated its billing controls on `role === "owner" || role === "admin"`
 * while the API gated the same things on `billing.manage`, which the bookkeeper
 * preset holds and neither of those names covers. The result was the worst
 * shape a permission bug takes: `withBillingRedacted` SERVED the bookkeeper
 * `canceled_at` and `winback_dismissed_at`, `billingRoutes` ACCEPTED their
 * calls, and the screen showed them nothing to press. The one role built for
 * this screen was the one role locked out of it.
 *
 * Rendered as the page rather than asserted against the capability table on its
 * own, because the table was already right — what was wrong was the caller.
 */
describe("#315 the billing screen is gated by capability, not by rank", () => {
  function renderPage(role: string, overrides: Partial<CompanyView> = {}) {
    activeRole.current = role;
    companyQuery.data = company({
      subscription_status: "canceled",
      canceled_at: daysAgo(3),
      ...overrides,
    });
    render(<BillingSettingsPage />);
  }

  /** Every control on this screen sits behind `billing.manage`. */
  function billingControlsVisible(): boolean {
    return screen.queryByRole("button", { name: /Manage payment/ }) !== null;
  }

  it("BILL-1: a bookkeeper sees the billing controls the API already allows", () => {
    // `billingRoutes.use("*", requireCapability("billing.manage"))` and
    // `referralRoutes` likewise: a bookkeeper can call every route behind this
    // screen. Hiding it from them is the thing that forces the credential
    // sharing #315 exists to end.
    renderPage("bookkeeper");
    expect(billingControlsVisible()).toBe(true);
    expect(screen.getByRole("button", { name: "Resubscribe" })).toBeTruthy();
  });

  it("BILL-2: and the win-back, which is served on the same capability", () => {
    // `winback_dismissed_at` is in BILLING_ONLY_COMPANY_FIELDS, kept by
    // `withBillingRedacted` for anyone holding `billing.manage`. A bookkeeper
    // is sent the field and, before this, could never see what it gates.
    stated.data = { reason: "too_expensive", stated_at: daysAgo(3) };
    renderPage("bookkeeper");
    const grace = offerFor({
      reason: "too_expensive",
      plan: "pro",
      phase: "grace",
    });
    expect(screen.getByText(grace.heading)).toBeTruthy();
  });

  it("BILL-3: owner and admin are unchanged, and a member still gets nothing", () => {
    // The capability is the same answer as the rank for the two roles the rank
    // named — that equivalence is what makes this a safe swap rather than a
    // widening.
    for (const role of ["owner", "admin"]) {
      renderPage(role);
      expect(billingControlsVisible(), role).toBe(true);
      cleanup();
    }

    for (const role of ["member", "read_only"]) {
      renderPage(role);
      expect(billingControlsVisible(), role).toBe(false);
      // And nothing to resubscribe with, which is the control that spends
      // money.
      expect(screen.queryByRole("button", { name: "Resubscribe" }), role).toBeNull();
      cleanup();
    }
  });

  it("BILL-4: the refusal names no rank, because ranks go stale", () => {
    // "Only owners and admins can change billing" became false the day the
    // bookkeeper preset shipped. The owner is the safe thing to name: the owner
    // holds every capability by definition, so "ask the owner" cannot rot.
    renderPage("member");
    const copy = (document.body.textContent ?? "").toLowerCase();
    expect(copy).toContain("owner");
    expect(copy).not.toContain("admins can");
    expect(copy).not.toContain("only owners");
  });
});
