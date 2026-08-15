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

import { sayEnglish } from "@/i18n/provider";
import { ApiError } from "@/lib/api/error";
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
  pause,
  pausePlan,
  resumePlan,
  toasted,
  activeRole,
  companyQuery,
  heldNumbers,
} = vi.hoisted(() => ({
  portal: { mutate: vi.fn(), isPending: false },
  /**
   * #523 GET /v1/billing/held-numbers. `asked` records the caller's `enabled`
   * for the same reason `pause.asked` below does: whether this screen spends an
   * authenticated billing read on a workspace that has nothing to show is a
   * property under test, not decoration.
   */
  heldNumbers: {
    data: undefined as unknown,
    asked: undefined as boolean | undefined,
  },
  /**
   * #529: `isPending` is present because the REAL `useRecordCancellationReason`
   * is a `useMutation` and therefore has one. Without it, `record.isPending`
   * read `undefined` on every render — so `disabled={record.isPending}` on the
   * exit was falsy always and invisible to every test in this file. The same
   * shape the `pause` fixture below documents, one mutation over.
   */
  record: { mutate: vi.fn(), isPending: false },
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
  /**
   * #277 GET /v1/billing/pause. `asked` records the caller's `enabled`, because
   * "does this screen pay two Stripe round trips it will not render" is a
   * property under test, not decoration — same as `stated.asked` above.
   *
   * `error` EXISTS SO THE SUITE CAN EXPRESS A QUERY THAT IS NOT DATA-SHAPED.
   * This mock used to hand back `{ data, asked }` and nothing else, so
   * `isPending` and `isError` were `undefined` on every render and no test in
   * the file could describe the two states that are not "the server answered":
   * the cold-start window before the read lands, and a read that failed. The
   * constraint this whole feature is subordinate to — one press reaches Stripe —
   * is exactly what a `disabled={pause.isPending}` would break, and it would
   * have broken it while the suite reported green. The flags are DERIVED below
   * rather than stored beside `data`, so a fixture cannot claim to be loading
   * and answered at once.
   */
  pause: {
    data: undefined as
      | {
          eligible: boolean;
          reason: string | null;
          paused_at: string | null;
          monthly_cents: number | null;
          resume_plan: "starter" | "pro" | null;
        }
      | undefined,
    /** What the read failed with, when it failed. */
    error: null as Error | null,
    asked: undefined as boolean | undefined,
    /**
     * Asking again. Real, because a failed read now says so on the plan card
     * and offers a retry — and a "Try again" wired to nothing is worse than no
     * "Try again", since it looks like the request was made.
     */
    refetch: vi.fn(),
  },
  pausePlan: { mutate: vi.fn(), isPending: false },
  resumePlan: { mutate: vi.fn(), isPending: false },
  toasted: vi.fn(),
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
  // #523: the held-numbers card. This file's subject is the page's gating, and
  // the card has its own suite — but the ENABLEMENT is the page's decision, so
  // the flag is recorded rather than thrown away.
  useHeldNumbers: (enabled: boolean) => {
    heldNumbers.asked = enabled;
    return { data: heldNumbers.data };
  },
  useReinstateHeldNumber: () => ({ isPending: false, mutate: vi.fn() }),
  useBillingPortal: () => portal,
  useRecordCancellationReason: () => record,
  useCheckout: () => checkout,
  useChangePlan: () => changePlan,
  useCancellationReason: (enabled: boolean) => {
    stated.asked = enabled;
    return stated;
  },
  useDismissWinback: () => dismiss,
  usePauseOffer: (enabled: boolean) => {
    // ACCUMULATES, never overwrites. Two surfaces share this key — the paused
    // card and the cancel card — and react-query fires the request if EITHER
    // enables it. A last-caller-wins recorder would report `false` for a
    // bookkeeper page (whose cancel card passes `isOwner: false`) while the
    // request was very much made.
    pause.asked = (pause.asked ?? false) || enabled;
    return {
      data: pause.data,
      error: pause.error,
      // THE THREE STATES REACT-QUERY REALLY HAS, derived from the fixture so it
      // cannot describe an impossible query. `isPending` is `status ===
      // "pending"` — no data and no error — which is also what a DISABLED query
      // reports, and that is the shape that matters most here: a screen whose
      // exit waited on this query would wait forever for the reader who never
      // enabled it.
      isPending: pause.error === null && pause.data === undefined,
      isError: pause.error !== null,
      isSuccess: pause.data !== undefined,
      refetch: pause.refetch,
    };
  },
  usePausePlan: () => pausePlan,
  useResumePlan: () => resumePlan,
  // #490's count, on the page. Nothing renders from `undefined`, which is what
  // this suite wants: the win-back gate is what is under test, not the count.
  useMissedWhileOff: () => ({ data: undefined }),
  // The three offers that only mount on an ACTIVE subscription, which the
  // canceled-state page tests never reach. Each renders nothing from
  // `undefined`, which is what this suite wants — they are neighbours of the
  // thing under test, not the thing.
  useModules: () => ({ data: undefined }),
  useSetModule: () => ({ mutate: vi.fn(), isPending: false }),
  usePrepayOffer: () => ({ data: undefined }),
  useBuyPrepaidYear: () => ({ mutate: vi.fn(), isPending: false }),
  useReferrals: () => ({ data: undefined }),
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
// The pause and the resume say so out loud, and the surface that says it is a
// toast rather than a line on the card — the paused card is a scroll away from
// where the pause is pressed.
vi.mock("sonner", () => ({ toast: { success: toasted, error: vi.fn() } }));

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

const {
  PAUSE_CONFIRMATION,
  RESUME_CONFIRMATION,
  PausedPlanCard,
  pauseOfferAction,
  pauseOfferBody,
  pauseOfferHeading,
} = await import("@/components/settings/pause-plan");

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
 * A pause fee, and the exact characters it must become on screen.
 *
 * BOTH SIDES ARE WRITTEN OUT, and the price literal is the whole point of the
 * pair. Every other price assertion in the pause suites reads
 * `pauseOfferAction(PAUSE_CENTS)` — the shipped function — and compares its
 * output to the same function's output rendered by the shipped component, which
 * is a tautology: rewrite `pauseOfferAction` to return "Pause your plan" with no
 * figure in it, or `monthly()` to return a constant, and every one of those
 * assertions still passes. A customer is agreeing to a recurring charge here, so
 * the one thing that may not be self-referential is the amount.
 *
 * 1275 rather than the 500 the fixtures elsewhere use, deliberately: a component
 * that ignored its prop and hardcoded the neighbouring fixture's "$5" would pass
 * a check written against 500. It also exercises the formatter's fractional
 * branch, which a round figure never reaches. It is not a plan price —
 * `price-surfaces.test.ts` forbids those as literals anywhere in the tree, and a
 * holding fee is not one of them.
 */
const ODD_CENTS = 1275;
const ODD_PRICE = "$12.75";

/**
 * Every money-shaped run of characters on screen, including a bare "$" — which
 * is what "$NaN" or a figure that failed to render leaves behind, and the exact
 * thing a price assertion written as `toContain("$12.75")` would sail past.
 */
function pricesShown(): string[] {
  return (document.body.textContent ?? "").match(/\$[\d,]*\.?\d*/g) ?? [];
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

/**
 * #524 — what happy-dom actually does with a click, measured rather than
 * assumed.
 *
 * Every line below was established by rendering the shape and reading the
 * result, because the previous version of this guard was built on a claim that
 * turned out to be half wrong ("happy-dom applies NO CSS" — it computes CSS
 * perfectly well; what it does not do is gate event dispatch on it).
 *
 *   disabled                    HONOURED. `fireEvent.click` on a disabled
 *                               button does not reach the handler. This is the
 *                               ONLY mechanism in the list that the press
 *                               catches on its own.
 *   style={{pointerEvents}}     IGNORED at dispatch. `getComputedStyle` reports
 *                               "none", and the click still fires.
 *   .pointer-events-none        IGNORED at dispatch, and invisible to
 *   (a Tailwind class)          `getComputedStyle` as well — no Tailwind sheet
 *                               is loaded in this environment, so the token
 *                               resolves to nothing. (A rule in a real `<style>`
 *                               element IS resolved; Tailwind's is not there.)
 *   inert                       IGNORED entirely. React 19 renders `inert=""`,
 *                               happy-dom parses it onto `.inert`, the click
 *                               fires, and `getByRole` still finds the button.
 *   a covering sibling          IMPOSSIBLE TO SEE. There is no layout:
 *                               `getBoundingClientRect()` is 0×0 for every
 *                               element and `document.elementFromPoint` is not
 *                               implemented at all, so no hit test exists.
 *
 * So: press the control and require the effect, and where the press is
 * structurally blind, say what is being stood in for instead of claiming a
 * guarantee this environment cannot give. That division is the whole shape of
 * the two functions below.
 */

/**
 * What would swallow a click on `exit` in a real browser and does not here.
 *
 * NOT A CATALOGUE OF WAYS TO DISABLE A CONTROL — that list can always be added
 * to, and three rounds of trying produced eleven escapes across the clients.
 * It is the shim that makes the PRESS below mean in happy-dom what it means in
 * Chrome, and it is deliberately the smaller half: `disabled` is absent from it
 * precisely because the press already covers that one, and a future mechanism
 * that ends up as `disabled` (or as a handler that returns early, or as a
 * control that never renders) is covered without anybody adding a line.
 *
 * Returned as sentences rather than asserted in place so the failure names the
 * element and the mechanism, and so a caller reads one property with one
 * message instead of a column of near-identical expectations.
 */
function whatSwallowsTheClick(exit: HTMLElement): string[] {
  const found: string[] = [];
  for (let node: HTMLElement | null = exit; node; node = node.parentElement) {
    const where = `<${node.tagName.toLowerCase()}>`;
    // The computed property, which covers the inline `style={{ pointerEvents:
    // "none" }}` form AND any real stylesheet rule in the document.
    if (window.getComputedStyle(node).pointerEvents === "none") {
      found.push(`${where} computes pointer-events: none`);
    }
    // …and the Tailwind token, separately, because no Tailwind sheet is loaded
    // here for the line above to resolve. THE TOKEN, NOT THE SUBSTRING: every
    // shadcn button in this tree ships `disabled:pointer-events-none` in its
    // own class list, and that variant is dead until the button really is
    // disabled, which the press settles on its own.
    if (
      (node.getAttribute("class") ?? "").split(/\s+/).includes("pointer-events-none")
    ) {
      found.push(`${where} carries the class pointer-events-none`);
    }
    // React 19 renders `inert` as a real attribute and omits it for `false`, so
    // presence is the whole test. It is the standard 2026 answer to "make this
    // non-interactive while loading", which is exactly why it has to be here.
    if (node.hasAttribute("inert")) {
      found.push(`${where} is inert`);
    }
    // Not a click-swallower in any browser — `aria-disabled` is advisory — but a
    // control that TELLS a screen reader it is dead has taken the way out away
    // from the person least able to work around it. Listed here rather than in
    // a separate guard because the caller's question is the same one.
    if (node.getAttribute("aria-disabled") === "true") {
      found.push(`${where} says aria-disabled to anybody listening`);
    }
  }
  // A collapse, an accordion or a Radix trigger wrapped around this card costs
  // a press without ever touching an attribute on the button itself.
  const behind = exit.closest("[hidden], [aria-hidden='true'], [data-state='closed']");
  if (behind !== null) {
    found.push(`<${behind.tagName.toLowerCase()}> hides the exit behind a state`);
  }
  return found;
}

/**
 * The way out, checked by TAKING it.
 *
 * # Why this replaced a list
 *
 * The previous guard enumerated three mechanisms — the `disabled` attribute, the
 * `pointer-events-none` token, and a collapsed wrapper — and every round of
 * that produced a new escape that walked straight past it. `inert` on a wrapper,
 * `style={{ pointerEvents: "none" }}`, and a covering `absolute inset-0` sibling
 * were each applied to the shipped tree and watched this suite stay green. None
 * of them is a separate defect. They are one defect three times, because a list
 * of ways to make a control unclickable cannot be finished.
 *
 * So the assertion is the OBSERVABLE the person has, not the mechanism: press
 * the button, and require that the thing it exists to do happened. Every escape
 * anybody has invented produces the same failure here — nothing reached Stripe —
 * and so does the twelfth, without this function learning about it. In
 * particular it catches two whole families the source-level and rendered-bytes
 * guards below are structurally blind to, because those two are both scoped to
 * the pause read:
 *
 *   - a gate on something ELSE. `disabled={portal.isPending ||
 *     exportContacts.isPending}` holds the door shut while a CSV downloads, and
 *     has nothing to do with `GET /v1/billing/pause`.
 *   - a guard inside the handler. `leave()` returning early draws a button that
 *     is enabled, visible, and does nothing — iOS's fifth escape, said in
 *     TypeScript.
 *
 * # What the press CANNOT see here, and what stands in
 *
 * happy-dom honours `disabled` at dispatch and nothing else (see the block
 * above — each line of it was measured). `whatSwallowsTheClick` is the shim for
 * the CSS and `inert` families, so that in this environment the press means what
 * it means in a browser.
 *
 * The one gap left over is geometric: an element drawn ON TOP of the exit. There
 * is no layout in happy-dom — every rect is 0×0 and `elementFromPoint` does not
 * exist — so no hit test is available to any test in this file, and pretending
 * otherwise would be the decorative guard in a new costume. What covers it is
 * EXIT-R1/R2/R3 at the bottom of this file, which compare the rendered bytes of
 * everything down to the exit across every state the pause read can be in: an
 * overlay that appears with a loading state changes those bytes. An
 * UNCONDITIONAL cover is caught by neither, and that is stated rather than
 * papered over — it is a visible edit to this card's own markup rather than a
 * state nobody rendered.
 */
function expectTheExitLeaves(exit: HTMLElement, when = "the exit"): void {
  expect(
    whatSwallowsTheClick(exit),
    `\n\n${when}: the way out is drawn but cannot be pressed.\n`,
  ).toEqual([]);

  // A DELTA, not `toHaveBeenCalledTimes(1)`. Several callers press the exit
  // themselves as well, and a helper that assumed it was the first press would
  // either duplicate their assertion or quietly disagree with it.
  const before = portal.mutate.mock.calls.length;
  fireEvent.click(exit);
  expect(
    portal.mutate.mock.calls.length - before,
    `\n\n${when}: pressing the way out did not open the billing portal. ` +
      `Cancelling may never take more steps or more time than subscribing ` +
      `did, so the exit has to WORK on the first press, in every state this ` +
      `screen can be in.\n`,
  ).toBe(1);
}

/**
 * What `GET /v1/billing/pause` answers for a workspace whose plan is RUNNING.
 *
 * The point of this fixture is that it is an ANSWER. `pause.data = undefined`
 * is the cold-start read, not a workspace that is not paused, and the two used
 * to render identically — which is the whole defect these suites now guard.
 * Ineligible-and-unquotable by default, so it puts no pause offer on screen:
 * these are the tests about the OTHER answers.
 */
function running(
  overrides: Partial<NonNullable<typeof pause.data>> = {},
): NonNullable<typeof pause.data> {
  return {
    eligible: false,
    reason: "not_provisioned",
    paused_at: null,
    monthly_cents: null,
    resume_plan: "pro",
    ...overrides,
  };
}

/** …and for one that is paused RIGHT NOW, which is what the route really says. */
function pausedNow(
  overrides: Partial<NonNullable<typeof pause.data>> = {},
): NonNullable<typeof pause.data> {
  return running({
    reason: "already_paused",
    paused_at: daysAgo(9),
    monthly_cents: ODD_CENTS,
    ...overrides,
  });
}

afterEach(cleanup);

beforeEach(() => {
  portal.mutate.mockReset();
  portal.isPending = false;
  record.mutate.mockReset();
  record.isPending = false;
  exportContacts.mutate.mockReset();
  exportContacts.isPending = false;
  checkout.mutate.mockReset();
  checkout.isPending = false;
  changePlan.mutate.mockReset();
  changePlan.isPending = false;
  dismiss.mutate.mockReset();
  stated.data = undefined;
  stated.asked = undefined;
  pause.data = undefined;
  pause.error = null;
  pause.asked = undefined;
  pause.refetch.mockReset();
  pausePlan.mutate.mockReset();
  pausePlan.isPending = false;
  resumePlan.mutate.mockReset();
  resumePlan.isPending = false;
  toasted.mockReset();
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
    // render, and pressing it goes straight to Stripe.
    const leave = screen.getByRole("button", {
      name: new RegExp(CANCEL_ACTION),
    });
    expectTheExitLeaves(leave, "on arrival");

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
    // disabled-until-you-pick. One click from this screen to the portal, and
    // the press IS the assertion — see `expectTheExitLeaves`.
    expectTheExitLeaves(renderCard(), "nothing answered");
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
 * #524 — a third shape, and the same defect one layer up: a sentence stating as
 * a fact something this screen never read.
 *
 * "Texting stops at the end of your billing period" tells the reader texting is
 * currently on. A paused workspace's texting stopped the day they paused, and
 * the paused card at the top of the same screen says so. Where the two above
 * catch a DURATION with no anchor, this catches a future event stated with no
 * acknowledgement that it may already have happened.
 *
 * WHAT COUNTS AS QUALIFIED IS A SHAPE, NOT A SENTENCE. Pinning the exact clause
 * that ships would make this a ceiling on the wording — the trap where a guard
 * starts failing on a correct rewrite and gets deleted. So it asks only that
 * some acknowledgement follows within a short window, keyed on the two words
 * that do that job in English. THE HONEST LIMIT: a rewrite that hedges without
 * either word ("texting stops then, unless it stopped when you paused") trips
 * this and would have to widen the shape deliberately. That direction of error
 * is the cheap one — the expensive one is a tidy-up that quietly drops the
 * qualifier and leaves the contradiction back on the screen.
 *
 * The 40-character window is just longer than the shipped clause. Two claims
 * close enough together for one's qualifier to cover the other would slip
 * through; that is not a shape this copy has ever taken, and widening the window
 * to rule it out would start swallowing unrelated sentences instead.
 */
const TEXTING_STOPS_UNQUALIFIED = /texting stops\b(?![\s\S]{0,40}?(alread|yet))/i;

/**
 * The offer, or the absence of one, for the reason somebody just picked.
 *
 * Throws rather than returning null, so a test that means to assert copy can
 * never quietly assert nothing.
 */
function offerFor(input: Parameters<typeof cancellationOffer>[0]) {
  const offer = cancellationOffer(input, sayEnglish);
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
      const offer = cancellationOffer({ reason: code, plan: "pro" }, sayEnglish);
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

    // And leaving is unchanged: one press, and it lands.
    expect(screen.queryByRole("dialog")).toBeNull();
    expectTheExitLeaves(leave, "with the answer up");
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
    // The shared answer is about the 30-day hold that already exists, so it has
    // no control. #277's paid pause is a control, and this is now the case where
    // there is NO pause to offer: `pause.data` is undefined here (the query is
    // loading, disabled, or failed), so the card is the card it always was. The
    // eligible case is PAUSE-2 below.
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
    //
    // With the pause read ANSWERED, so the plan switch is genuinely on screen:
    // this test measures the loudest control among the ones that exist, and a
    // cold-start fixture would quietly measure a card with one fewer.
    for (const label of ["Too expensive", "Missing something I need"]) {
      pause.data = running();
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
    //
    // THE READ HAS ANSWERED, and that is now load-bearing rather than scenery:
    // this control is withheld until the pause read comes back, because on a
    // paused workspace it is a button whose only outcome is a 409. `running()`
    // is that answer; `pause.data = undefined` would be the cold-start window,
    // where OFFER-P3 asserts the opposite of everything below.
    pause.data = running();
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
          pause.data = running();
          renderCard();
          pick(label);
        },
      ],
    );
    // Including the answers a PAUSED workspace gets. Two of the six are
    // different copy for that reader — copy that talks about a clock starting
    // when they cancel — and different copy is exactly where a deadline gets
    // stated without saying where it is counted from.
    surfaces.push(
      ...CANCELLATION_REASONS.map(({ label }): [string, () => void] => [
        `${label} (paused)`,
        () => {
          pause.data = pausedNow();
          renderCard();
          pick(label);
        },
      ]),
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
 * #277 — the paid pause, offered as the answer to "quiet season".
 *
 * A crew going quiet for the winter keeps its number and its history, stops
 * texting, and pays a small monthly fee instead of the plan. It is a better
 * answer to `seasonal` than the 30-day hold is, so it REPLACES the shared
 * seasonal offer in the same slot — below the exit, after a reason has been
 * volunteered.
 *
 * The pass/fail rules, in the order they matter:
 *
 *   1. the exit is unchanged. One action, never disabled, never moved.
 *   2. `eligible` is the only thing that may put a control on screen.
 *   3. no figure is ever invented — the price on the control is the API's.
 */
describe("#277 the paid pause, on the cancel card", () => {
  /**
   * A pause the server says yes to, at a price it quoted.
   *
   * The FIGURE is the fixture's, and every expectation below derives from it
   * through the shipped formatter rather than restating it — a test that types
   * "$5" alongside a component that types "$5" proves the two agree with each
   * other and nothing about where the number came from. Deliberately not a plan
   * price: `price-surfaces.test.ts` forbids those as literals anywhere in the
   * tree, and a holding fee is not one of them.
   */
  const PAUSE_CENTS = 500;

  function offered(
    overrides: Partial<NonNullable<typeof pause.data>> = {},
  ): NonNullable<typeof pause.data> {
    return {
      eligible: true,
      reason: null,
      paused_at: null,
      monthly_cents: PAUSE_CENTS,
      resume_plan: "pro",
      ...overrides,
    };
  }

  /** The heading, the body and the control, all from the shipped copy. */
  const heading = () => pauseOfferHeading(PAUSE_CENTS);
  const action = () => pauseOfferAction(PAUSE_CENTS);

  it("PAUSE-1: an ineligible pause is absent, not greyed out or explained", () => {
    // Every reason the route can give, and the answer to all of them is the
    // same: the seasonal reader gets the shared 30-day answer and there is
    // nothing to press. `not_provisioned` is the one that matters most — that is
    // our own unset Stripe catalog, and a customer on the way out must never be
    // shown a disabled control explaining our configuration to them.
    for (const reason of [
      "not_provisioned",
      "no_subscription",
      "already_paused",
      "subscription_unhealthy",
      "plan_change_pending",
      "referral_month_pending",
      "already_prepaid",
      "prepaid_coupon_orphaned",
    ]) {
      const isPaused = reason === "already_paused";
      pause.data = offered({
        eligible: false,
        reason,
        // The route's real shapes, and `already_paused` is the one that
        // matters: it answers `monthly_cents` from the company mirror, so a
        // figure IS present while `eligible` is false. Sending null for every
        // reason would let the price check mask the eligibility check, and a
        // client that gated on "do we have a number" instead of on `eligible`
        // would pass this whole loop.
        monthly_cents: isPaused ? PAUSE_CENTS : null,
        // And it answers a `paused_at`, because that is what makes it
        // `already_paused`. Sending null here would have made this the one
        // fixture in the file that describes a state the route cannot produce —
        // and it is the exact state whose seasonal answer is different.
        paused_at: isPaused ? daysAgo(9) : null,
      });
      renderCard();
      pick("Quiet season, I'll be back");

      const copy = document.body.textContent ?? "";
      expect(copy, reason).toContain(
        offerFor({ reason: "seasonal", plan: "pro", paused: isPaused }).heading,
      );
      expect(copy, reason).not.toContain(reason);
      expect(
        screen.getAllByRole("button").map((b) => b.textContent?.trim()),
        reason,
      ).toEqual(QUIET_CARD_BUTTONS);
      cleanup();
    }
  });

  it("PAUSE-2: eligible REPLACES the hold answer, and quotes the real price", () => {
    // One answer to one reason. The shared seasonal offer describes the 30-day
    // hold — true, and the best we had — but it is the wrong answer to somebody
    // who has just said they will be back in the spring. Two notes stacked here
    // would be the retention funnel this card refuses to become.
    pause.data = offered();
    renderCard();
    pick("Quiet season, I'll be back");

    expect(screen.getByText(heading())).toBeTruthy();
    expect(screen.getByText(pauseOfferBody(PAUSE_CENTS))).toBeTruthy();
    expect(
      screen.queryByText(offerFor({ reason: "seasonal", plan: "pro" }).heading),
    ).toBeNull();

    // The amount is on the CONTROL, not only in the prose. Nobody agrees to a
    // recurring charge whose figure was a paragraph away from the button.
    expect(screen.getByRole("button", { name: action() })).toBeTruthy();
  });

  it("PAUSE-3: THE EXIT DOES NOT MOVE — one action, still, with the offer up", () => {
    // The constraint that outranks the feature. A previous round of this
    // regressed the exit from one action to two on all three clients and every
    // build report called it fine, so it is measured here from a plain arrival:
    // no expand, no dialog, no disabled state, and the offer strictly BELOW the
    // button that leaves.
    pause.data = offered();
    const leave = renderCard();
    pick("Quiet season, I'll be back");

    expect(
      leave.compareDocumentPosition(screen.getByText(heading())) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expectTheExitLeaves(leave, "with the pause offered");
    expect(portal.mutate).toHaveBeenCalledTimes(1);
    // And pressing the exit does not quietly pause anybody on the way out.
    expect(pausePlan.mutate).not.toHaveBeenCalled();
  });

  it("PAUSE-4: leaving is still the loudest thing in the card", () => {
    // An offer that out-shouts the exit is the dark pattern this whole screen is
    // built against. The pause is an outline, like every other answer's control.
    pause.data = offered();
    renderCard();
    pick("Quiet season, I'll be back");

    expect(screen.getByRole("button", { name: action() }).getAttribute("data-variant")).toBe(
      "outline",
    );
    expect(
      [...screen.getAllByRole("button"), ...screen.queryAllByRole("link")]
        .filter((node) => node.getAttribute("data-variant") === "default")
        .map((node) => node.textContent?.trim()),
    ).toEqual([CANCEL_ACTION]);
  });

  it("PAUSE-5: a pause we cannot quote is never offered", () => {
    // The route already reports `eligible: false` for a price it cannot read —
    // unset, archived, $0 or tiered. This is the belt to that braces: a response
    // that ever said yes without a figure renders NOTHING rather than a control
    // with a hole where the amount goes.
    pause.data = offered({ monthly_cents: null });
    renderCard();
    pick("Quiet season, I'll be back");

    expect(
      screen.getAllByRole("button").map((b) => b.textContent?.trim()),
    ).toEqual(QUIET_CARD_BUTTONS);
    // And no "$" with nothing after it, or "$NaN", anywhere on the card.
    expect(document.body.textContent).not.toMatch(/\$\s*(?![\d])/);
  });

  it("PAUSE-6: only the seasonal reader is offered it", () => {
    // The pause answers "quiet season". It is not a retention offer bolted onto
    // every reason: somebody leaving because a feature is missing gets the help
    // route, and somebody who says nothing gets nothing.
    pause.data = offered();
    for (const { label } of CANCELLATION_REASONS) {
      if (label === "Quiet season, I'll be back") continue;
      renderCard();
      pick(label);
      expect(screen.queryByText(heading()), label).toBeNull();
      cleanup();
    }

    // Including the case where no reason has been given at all.
    renderCard();
    expect(screen.queryByText(heading())).toBeNull();
  });

  it("PAUSE-7: pressing it sends ONE request and says so when it lands", () => {
    pausePlan.mutate.mockImplementation(
      (_input: undefined, options: { onSuccess: () => void }) =>
        options.onSuccess(),
    );
    pause.data = offered();
    renderCard();
    pick("Quiet season, I'll be back");
    fireEvent.click(screen.getByRole("button", { name: action() }));

    expect(pausePlan.mutate).toHaveBeenCalledTimes(1);
    // Said where the press happened. The paused state lands at the top of this
    // page, a scroll away from a button near the bottom of it.
    expect(toasted).toHaveBeenCalledWith(PAUSE_CONFIRMATION);
    // The handoff to Stripe was not touched: pausing is not leaving.
    expect(portal.mutate).not.toHaveBeenCalled();
  });

  it("PAUSE-8: a refusal is shown in the API's own words, and blocks nothing", () => {
    // Both pause routes re-read the database mirror after the Stripe swap and
    // 409 rather than reporting a success they cannot see. The message is
    // written for the customer, so it is shown as-is rather than replaced with
    // a house sentence that knows less.
    const refusal =
      "Your plan hasn't paused yet. If you resumed earlier today, try again " +
      "tomorrow — you won't be charged twice for pausing.";
    pausePlan.mutate.mockImplementation(
      (_input: undefined, options: { onError: (cause: unknown) => void }) =>
        options.onError(new ApiError("conflict", refusal, 409)),
    );
    pause.data = offered();
    const leave = renderCard();
    pick("Quiet season, I'll be back");
    fireEvent.click(screen.getByRole("button", { name: action() }));

    expect(screen.getByRole("alert").textContent).toBe(refusal);
    // And the way out is exactly where it was, still one press.
    expectTheExitLeaves(leave, "after the pause was refused");
    expect(portal.mutate).toHaveBeenCalledTimes(1);
  });

  it("PAUSE-9: not asked for on a card that could not render it", () => {
    // `GET /v1/billing/pause` round-trips to Stripe twice — the subscription,
    // then the price. The non-owner card has no cancel flow and no offer slot,
    // so it must not buy the answer.
    render(<CancelSubscriptionCard isOwner={false} company={company()} />);
    expect(pause.asked).toBe(false);
  });

  it("PAUSE-9a: nor on a workspace that has no plan to pause", () => {
    // The page and this card enable the SAME query key, and react-query fires
    // the request if either says yes — so the card's gate was quietly the whole
    // gate wherever it was wider. It was: the page asked only for a workspace
    // with a plan and a live subscription, this card asked for any owner, and an
    // owner who abandoned setup before checkout bought two Stripe round trips
    // for an answer that can only be `no_subscription`.
    render(<CancelSubscriptionCard isOwner company={company({ plan: null })} />);
    // The card itself is on screen — this is a gate that closed, not a card that
    // never rendered.
    expect(screen.getByRole("button", { name: new RegExp(CANCEL_ACTION) })).toBeTruthy();
    expect(pause.asked).toBe(false);
  });

  it("PAUSE-10: the price on the offer is the SERVER's figure, to the cent", () => {
    // Checked against a LITERAL, because every other price assertion in this
    // file is circular: `screen.getByText(pauseOfferHeading(500))` asks the
    // shipped function what to look for and then finds what the shipped
    // component rendered with the same function. Rewrite `pauseOfferAction` to
    // return "Pause your plan", or `monthly()` to return a constant, and all of
    // them still pass — while a customer agrees to a recurring charge whose
    // amount nothing checked.
    for (const [name, copy] of [
      ["heading", pauseOfferHeading(ODD_CENTS)],
      ["body", pauseOfferBody(ODD_CENTS)],
      ["action", pauseOfferAction(ODD_CENTS)],
    ] as const) {
      expect(copy.match(/\$[\d,]*\.?\d*/g) ?? [], name).toEqual([ODD_PRICE]);
    }

    // And at the RENDER SITE, which is where a fabricated fallback would live: a
    // component that ignored its prop and reached for a default would be invisible
    // to the three checks above.
    pause.data = offered({ monthly_cents: ODD_CENTS });
    renderCard();
    pick("Quiet season, I'll be back");

    expect(
      screen.getByRole("button", { name: `Pause for ${ODD_PRICE} a month` }),
    ).toBeTruthy();
    // Stated in the prose AND again on the control — nobody agrees to a
    // recurring charge whose figure was a paragraph away from the button — and
    // no other figure, no bare "$", anywhere on the card.
    expect(pricesShown().length).toBeGreaterThanOrEqual(3);
    expect([...new Set(pricesShown())]).toEqual([ODD_PRICE]);
  });

  it("PAUSE-11: the exit is one press in EVERY state this query can be in", () => {
    // THE CONSTRAINT THAT OUTRANKS THE FEATURE, checked against the shape most
    // likely to break it. `disabled={portal.isPending || pause.isPending}` is one
    // plausible-looking edit, it makes the way out wait on two Stripe round trips
    // that have nothing to do with leaving, and until the mock above grew the
    // query flags it passed every test in this file — no fixture could describe a
    // query that had not answered yet.
    //
    // So all five states the hook can be in, including the two that are not
    // data-shaped: the cold-start window, and a read that failed outright.
    const states: [name: string, apply: () => void][] = [
      ["not read yet", () => {}],
      [
        "read failed",
        () => {
          pause.error = new ApiError(
            "internal_error",
            "Couldn't reach Stripe.",
            502,
          );
        },
      ],
      [
        "eligible",
        () => {
          pause.data = offered();
        },
      ],
      [
        "ineligible",
        () => {
          pause.data = offered({
            eligible: false,
            reason: "not_provisioned",
            monthly_cents: null,
          });
        },
      ],
      [
        "already paused",
        () => {
          pause.data = offered({
            eligible: false,
            reason: "already_paused",
            paused_at: daysAgo(9),
          });
        },
      ],
    ];

    for (const [name, apply] of states) {
      pause.data = undefined;
      pause.error = null;
      apply();
      portal.mutate.mockClear();

      const leave = renderCard();
      expect(screen.queryByRole("dialog"), name).toBeNull();
      // Pressed, and required to have LANDED — see `expectTheExitLeaves`. The
      // question is never how a state took the exit away, only whether it did.
      expectTheExitLeaves(leave, name);
      expect(portal.mutate, name).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("PAUSE-12: the confirmation waits for the server, and a refusal is not one", () => {
    // "Your plan is paused" is a statement about somebody's money. Fired beside
    // `mutate` instead of inside `onSuccess` it is a guess about a Stripe call
    // that has not happened; fired in `onError` beside the 409 sentence it is a
    // contradiction — the card would say paused and not-paused at once. Both are
    // a one-line edit and both passed everything here, because PAUSE-7 settles
    // the mutation synchronously and never asks what happens when it does not.
    pause.data = offered();
    // Accepted and still in flight: no callback is ever invoked.
    pausePlan.mutate.mockImplementation(() => {});
    renderCard();
    pick("Quiet season, I'll be back");
    fireEvent.click(screen.getByRole("button", { name: action() }));

    expect(pausePlan.mutate).toHaveBeenCalledTimes(1);
    expect(toasted).not.toHaveBeenCalled();
    cleanup();

    const refusal = "Your plan hasn't paused yet.";
    pausePlan.mutate.mockImplementation(
      (_input: undefined, options: { onError: (cause: unknown) => void }) =>
        options.onError(new ApiError("conflict", refusal, 409)),
    );
    renderCard();
    pick("Quiet season, I'll be back");
    fireEvent.click(screen.getByRole("button", { name: action() }));

    expect(screen.getByRole("alert").textContent).toBe(refusal);
    expect(toasted).not.toHaveBeenCalled();
  });

  it("PAUSE-13: the offer says what stops and what does not, BEFORE the charge", () => {
    // The paused card makes these promises too, but this is the one somebody
    // reads before pressing a button that starts a recurring charge, and it is
    // the only one they can act on. Each clause is load-bearing: `runPreSendGates`
    // refuses with 402 `workspace_paused` so texting really does stop; inbound is
    // untouched and scheduled sends are HELD rather than failed, which is what
    // the fee buys; and there is no fuse, which is the whole difference from
    // cancelling. "Nothing comes in or out" is one edit, reads as tighter copy,
    // and is a lie the customer finds out about from a customer.
    const body = pauseOfferBody(ODD_CENTS).toLowerCase();
    expect(body).toContain("still arrive");
    expect(body).toContain("waits rather than fails");
    expect(body).toContain("cannot send");
    expect(body).toContain("nothing expires");
    for (const wrong of [
      "in or out",
      "nothing comes in",
      "nothing gets through",
      "stops receiving",
      "stop receiving",
      "no texts arrive",
    ]) {
      expect(body, `the offer must not say "${wrong}"`).not.toContain(wrong);
    }
  });
});

/**
 * #277 — the two answers that change once the workspace is ALREADY paused.
 *
 * The pause offer is over by then (`GET /v1/billing/pause` answers
 * `eligible: false, reason: already_paused`), so the cancel card falls through
 * to the shared `cancellationOffer` — which, until it was told about the pause,
 * answered a paused workspace with two things it could not have:
 *
 *   too_expensive  a "Switch to Starter" control. `POST /v1/billing/change-plan`
 *                  answers 409 while `companies.paused_at` is set and asks for
 *                  the two steps in order, so the only outcome of pressing it is
 *                  a refusal — reached through a button we drew, an inch under
 *                  an answer somebody volunteered.
 *   seasonal       the 30-day hold, whose whole argument is that a long quiet
 *                  season outruns it. That is false for somebody who has already
 *                  taken the option it exists to compare against, and it
 *                  contradicts the paused card twelve lines up.
 *
 * The fix is in `packages/shared/src/cancellation-offers.ts` so all three
 * clients inherit it; what these guard is that THIS client passes the fact, and
 * passes a fact it has actually read.
 */
describe("#277 the answers a paused workspace gets on the cancel card", () => {
  it("OFFER-P1: no plan switch is drawn for a workspace the API would refuse", () => {
    pause.data = pausedNow();
    renderCard();
    pick("Too expensive");

    const answer = offerFor({
      reason: "too_expensive",
      plan: "pro",
      paused: true,
    });
    // The WORDS stay: Starter is still the true answer to "this costs too much",
    // and dropping the answer entirely would leave somebody cancelling over $79
    // never hearing about the $29 plan they can have. What the API refuses is
    // the click, not the fact.
    expect(screen.getByText(answer.body)).toBeTruthy();
    expect(document.body.textContent).toContain(
      "resume first, then switch plans",
    );

    // And there is nothing to press. QUIET_CARD_BUTTONS is this card with an
    // answer given and no control on it.
    expect(screen.queryByRole("button", { name: "Switch to Starter" })).toBeNull();
    expect(
      screen.getAllByRole("button").map((b) => b.textContent?.trim()),
    ).toEqual(QUIET_CARD_BUTTONS);
  });

  it("OFFER-P2: the seasonal answer is the paused one, not the 30-day hold", () => {
    pause.data = pausedNow();
    renderCard();
    pick("Quiet season, I'll be back");

    const answer = offerFor({ reason: "seasonal", plan: "pro", paused: true });
    expect(screen.getByText(answer.heading)).toBeTruthy();
    expect(
      screen.queryByText(offerFor({ reason: "seasonal", plan: "pro" }).heading),
    ).toBeNull();

    const copy = document.body.textContent ?? "";
    // The clause that is false for them, named as a literal rather than by
    // asking the shared module what it says — that is the sentence a rewrite
    // would reintroduce, and comparing the module to itself would not notice.
    expect(copy).not.toContain("outruns the hold");
    // Every deadline this answer names belongs to CANCELLING. The pause has no
    // clock on it, which is the entire difference being described.
    expect(copy).toContain("nothing expires while your plan is paused");
    expect(copy).not.toMatch(HOLD_STATED_WITHOUT_ANCHOR);
    // Still no control: Resume is already on the paused card at the top of this
    // screen, and a second one here would be this card growing a funnel.
    expect(
      screen.getAllByRole("button").map((b) => b.textContent?.trim()),
    ).toEqual(QUIET_CARD_BUTTONS);
  });

  it("OFFER-P3: a pause we have not READ withholds the control, not the words", () => {
    // THE RESIDUAL THE SHARED MODULE CANNOT CLOSE. A single boolean cannot tell
    // "not paused" from "not read yet", so `paused: false` on a workspace whose
    // read is pending or failed puts "Switch to Starter" back in front of a 409
    // — the same defect as the Active badge, one layer down. The module answers
    // the unread case with the unpaused WORDS, which is right (most workspaces
    // are not paused, and those are the words they have always read); the
    // client withholds the CONTROL until the read answers.
    const unread: [name: string, apply: () => void][] = [
      ["not read yet", () => {}],
      [
        "read failed",
        () => {
          pause.error = new ApiError("internal_error", "Couldn't reach Stripe.", 502);
        },
      ],
    ];

    for (const [name, apply] of unread) {
      pause.data = undefined;
      pause.error = null;
      apply();
      const leave = renderCard();
      pick("Too expensive");

      expect(
        screen.getByText(offerFor({ reason: "too_expensive", plan: "pro" }).body),
        name,
      ).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Switch to Starter" }),
        name,
      ).toBeNull();
      // And none of this touches the way out, which is the rule that outranks
      // the whole feature.
      expectTheExitLeaves(leave, name);
      cleanup();
    }

    // The control WAITS rather than being removed: an answer that the plan is
    // running brings it straight back. Without this the test would pass on a
    // client that never drew the switch at all.
    pause.data = running();
    renderCard();
    pick("Too expensive");
    expect(screen.getByRole("button", { name: "Switch to Starter" })).toBeTruthy();
  });

  it("OFFER-P4: a slow pause read does not take the help route away", () => {
    // Only the control the pause can refuse is withheld. `open_help` is the same
    // /settings/help route whether the plan is paused, running or unread, so
    // taking it away would charge somebody a help link for our network being
    // slow — on the screen they came to leave from.
    const offer = offerFor({ reason: "missing_feature", plan: "pro" });
    for (const [name, apply] of [
      ["not read yet", () => {}],
      ["paused", () => { pause.data = pausedNow(); }],
    ] as [string, () => void][]) {
      pause.data = undefined;
      apply();
      renderCard();
      pick("Missing something I need");
      expect(
        screen.getByRole("link", { name: offer.actionLabel ?? "" }),
        name,
      ).toBeTruthy();
      cleanup();
    }
  });
});

/**
 * #277 — the paused state, on the billing screen.
 *
 * `subscription_status` stays genuinely `active` through a pause (it is a price
 * swap, not a status), so this card is the ONLY thing on the screen that says
 * texting is off. It has to say it plainly, say what still works, and offer the
 * way back.
 */
describe("#277 the paused state, on the billing screen", () => {
  const PAUSE_CENTS = 500;

  function paused(
    overrides: Partial<NonNullable<typeof pause.data>> = {},
  ): NonNullable<typeof pause.data> {
    return {
      eligible: false,
      reason: "already_paused",
      paused_at: daysAgo(9),
      monthly_cents: PAUSE_CENTS,
      resume_plan: "pro",
      ...overrides,
    };
  }

  it("PAUSED-1: says texting is off, that inbound still arrives, and the fee", () => {
    // The order somebody worries in: the first thing they need to know is that
    // texting really is off, and the very next is that nothing their customers
    // sent has been lost.
    pause.data = paused();
    render(<PausedPlanCard show />);
    const copy = (document.body.textContent ?? "").toLowerCase();

    expect(copy).toContain("texting is off");
    expect(copy).toContain("still arrive");
    expect(copy).toContain("message history");
    // The fee, from the API rather than from a guess about what a pause costs.
    expect(document.body.textContent).toContain(`$${PAUSE_CENTS / 100} a month`);
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("PAUSED-2: renders nothing at all unless this workspace IS paused", () => {
    // Three ways to not be paused, and none of them may leave a card behind.
    for (const [name, data] of [
      ["not paused", paused({ paused_at: null })],
      ["eligible to pause", { ...paused({ paused_at: null }), eligible: true }],
      ["nothing loaded", undefined],
    ] as const) {
      pause.data = data;
      render(<PausedPlanCard show />);
      expect(document.body.textContent, name).toBe("");
      cleanup();
    }

    // And the caller's gate is honoured, which is what stops two Stripe round
    // trips on a screen with nothing to show for them. `asked` accumulates
    // across every mount in this test, so it is cleared first — the three
    // renders above each asked, truthfully.
    pause.data = paused();
    pause.asked = undefined;
    render(<PausedPlanCard show={false} />);
    expect(document.body.textContent).toBe("");
    expect(pause.asked).toBe(false);
  });

  it("PAUSED-3: no price is invented when the mirror has no figure", () => {
    // `paused_price_cents` mirrors the item we swapped onto, and a response that
    // cannot name it gets a card with no sentence about money — not a rounded
    // one, and not the catalog price, which is last winter's fee.
    pause.data = paused({ monthly_cents: null });
    render(<PausedPlanCard show />);

    expect(document.body.textContent).not.toContain("$");
    // Everything that is still true is still said, and Resume still works.
    expect((document.body.textContent ?? "").toLowerCase()).toContain(
      "texting is off",
    );
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("PAUSED-4: Resume sends one request, and a refusal is the API's sentence", () => {
    const refusal =
      "Your plan hasn't come back yet. Give it a minute and try again — you " +
      "won't be charged twice for resuming.";
    resumePlan.mutate.mockImplementation(
      (_input: undefined, options: { onError: (cause: unknown) => void }) =>
        options.onError(new ApiError("conflict", refusal, 409)),
    );
    pause.data = paused();
    render(<PausedPlanCard show />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(resumePlan.mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe(refusal);
  });

  it("PAUSED-5: a resume that lands says so", () => {
    resumePlan.mutate.mockImplementation(
      (_input: undefined, options: { onSuccess: () => void }) =>
        options.onSuccess(),
    );
    pause.data = paused();
    render(<PausedPlanCard show />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(toasted).toHaveBeenCalledWith(RESUME_CONFIRMATION);
  });

  it("PAUSED-6: no guilt here either, and no deadline invented", () => {
    // The pause has no fuse — that is the whole difference from cancelling — so
    // nothing on this card may put a countdown on the number. OFFER-13's rule,
    // on the surface that would be most tempting to hurry somebody along from.
    pause.data = paused();
    render(<PausedPlanCard show />);
    const copy = (document.body.textContent ?? "").toLowerCase();
    for (const pitch of ["are you sure", "hurry", "expires", "before you lose"]) {
      expect(copy, pitch).not.toContain(pitch);
    }
    expect(document.body.textContent ?? "").not.toMatch(
      HOLD_STATED_WITHOUT_ANCHOR,
    );
  });

  it("PAUSED-7: the fee on the card is the mirror's figure, to the cent", () => {
    // PAUSED-1 reads `$${PAUSE_CENTS / 100} a month`, which is true of a card
    // that hardcodes "$5" as well as one that formats what it was given. This is
    // the same check with a figure no hardcode in this tree produces, so the
    // only way to pass it is to print the number the server sent.
    pause.data = paused({ monthly_cents: ODD_CENTS });
    render(<PausedPlanCard show />);

    expect(document.body.textContent).toContain(`${ODD_PRICE} a month`);
    expect([...new Set(pricesShown())]).toEqual([ODD_PRICE]);
  });

  it("PAUSED-8: scheduled sends are WAITING, which is what the API does to them", () => {
    // The fee buys a hold, not a wipe. `runPreSendGates` refuses a paused
    // workspace with 402 `workspace_paused` and the scheduled row stays where it
    // is — so a card that says those messages were cancelled describes a
    // different product, and the crew finds out in the spring when the follow-ups
    // they lined up in October never went. Same sentence in the same direction as
    // the offer's (PAUSE-13): inbound arrives, outbound waits.
    pause.data = paused();
    render(<PausedPlanCard show />);
    const copy = (document.body.textContent ?? "").toLowerCase();

    expect(copy).toContain("still arrive");
    expect(copy).toContain("waiting rather than failed");
    expect(copy).not.toMatch(/schedul\w*[^.]{0,60}(cancel|delet|discard|drop)/);
  });

  it("PAUSED-9: the plan they come back to is the one the SERVER named", () => {
    // `resume_plan` is what the pause parked, read back off the route. A card
    // that types "Pro" instead tells the Starter workspace beside it that
    // resuming costs a plan it never had — and nothing in this file noticed,
    // because every fixture here happened to be on Pro.
    for (const [plan, named, other] of [
      ["pro", PLAN_FACTS.pro.name, PLAN_FACTS.starter.name],
      ["starter", PLAN_FACTS.starter.name, PLAN_FACTS.pro.name],
    ] as const) {
      pause.data = paused({ resume_plan: plan });
      render(<PausedPlanCard show />);
      const copy = document.body.textContent ?? "";
      expect(copy, plan).toContain(`${named} starts again`);
      expect(copy, plan).not.toContain(other);
      cleanup();
    }

    // And a response with no plan on it names none, rather than guessing one.
    pause.data = paused({ resume_plan: null });
    render(<PausedPlanCard show />);
    expect(document.body.textContent).not.toContain("starts again");
  });

  it("PAUSED-10: 'you're back' waits for the server to say so", () => {
    // PAUSE-12's rule on the way out of a pause. Both routes re-read the mirror
    // after the Stripe swap and 409 rather than reporting a success they cannot
    // see, so a toast fired beside `mutate` claims the one thing the route
    // refuses to claim — and the customer stops waiting for texting to come back
    // on a workspace where it has not.
    pause.data = paused();
    resumePlan.mutate.mockImplementation(() => {});
    render(<PausedPlanCard show />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(resumePlan.mutate).toHaveBeenCalledTimes(1);
    expect(toasted).not.toHaveBeenCalled();
    cleanup();

    const refusal = "Your plan hasn't come back yet.";
    resumePlan.mutate.mockImplementation(
      (_input: undefined, options: { onError: (cause: unknown) => void }) =>
        options.onError(new ApiError("conflict", refusal, 409)),
    );
    render(<PausedPlanCard show />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(screen.getByRole("alert").textContent).toBe(refusal);
    expect(toasted).not.toHaveBeenCalled();
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

  it("BILL-5: the pause is asked for on the screen that renders it", () => {
    // Two Stripe round trips server-side, on a screen visited to check a plan.
    // A bookkeeper on a live subscription is exactly who it is for; a member
    // cannot read the route at all, and a canceled workspace has no pause to
    // take (the route answers `subscription_unhealthy`).
    renderPage("bookkeeper", { subscription_status: "active", canceled_at: null });
    expect(pause.asked).toBe(true);
    cleanup();

    pause.asked = undefined;
    renderPage("member", { subscription_status: "active", canceled_at: null });
    expect(pause.asked).toBe(false);
    cleanup();

    pause.asked = undefined;
    renderPage("owner");
    expect(pause.asked).toBe(false);
  });

  it("BILL-6: the page and the cancel card ask the SAME question about it", () => {
    // Two callers, one query key: react-query fires the request if EITHER
    // enables it, so the wider gate is the only gate and a disagreement between
    // them is invisible in both files. They disagreed — the page required a plan
    // and a live subscription, the card required an owner — and an owner who
    // never finished checkout paid for two Stripe round trips that could only
    // answer `no_subscription`. `pauseQueryEnabled` is now the one predicate;
    // this is what proves both callers still route through it.
    pause.asked = undefined;
    renderPage("owner", {
      subscription_status: "active",
      canceled_at: null,
      plan: null,
    });
    // The cancel card IS on this screen — the gate closed, rather than there
    // being nothing to ask on behalf of.
    expect(
      screen.getByRole("button", { name: new RegExp(CANCEL_ACTION) }),
    ).toBeTruthy();
    expect(pause.asked).toBe(false);
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

/**
 * #277 — the whole billing screen, on a paused workspace.
 *
 * A pause is a licensed-price swap, so `subscription_status` stays genuinely
 * `active` and every other card on this screen renders exactly as it does for a
 * paying customer. That is the hazard worth pinning: the page has to tell one
 * story about the account, and the exit has to survive the new card above it.
 */
describe("#277 the billing screen while paused", () => {
  function renderPaused(overrides: Partial<CompanyView> = {}) {
    activeRole.current = "owner";
    pause.data = {
      eligible: false,
      reason: "already_paused",
      paused_at: daysAgo(9),
      monthly_cents: 500,
      resume_plan: "pro",
    };
    companyQuery.data = company({
      subscription_status: "active",
      canceled_at: null,
      ...overrides,
    });
    render(<BillingSettingsPage />);
  }

  /**
   * The billing screen, with the pause read in a state we choose.
   *
   * The company is a live Pro workspace in every case, because that is the one
   * shape a paused workspace can have — the pause is a licensed-price swap, so
   * `subscription_status` stays genuinely `active`. Which means the ONLY thing
   * that can tell these four renders apart is what the pause read has answered.
   */
  function renderBilling(apply: () => void, overrides: Partial<CompanyView> = {}) {
    activeRole.current = "owner";
    pause.data = undefined;
    pause.error = null;
    apply();
    companyQuery.data = company({
      subscription_status: "active",
      canceled_at: null,
      ...overrides,
    });
    render(<BillingSettingsPage />);
  }

  /**
   * The four states this screen's pause read can be in.
   *
   * Only ONE of them is an answer that the plan is running, and that asymmetry
   * is the whole point: three of the four used to render as the fourth.
   */
  const READ_STATES: [name: string, apply: () => void][] = [
    ["not read yet", () => {}],
    [
      "read failed",
      () => {
        pause.error = new ApiError("internal_error", "Couldn't reach Stripe.", 502);
      },
    ],
    ["paused", () => { pause.data = pausedNow(); }],
    ["running", () => { pause.data = running(); }],
  ];

  it("PAGE-PAUSE-1: the screen claims a plan state only when it has READ one", () => {
    // The subscription really IS active in Stripe — that is the point of a price
    // swap — so this badge is the only thing on the screen that can contradict
    // the paused card above it, and it is the half a reader acts on.
    //
    // THIS TEST USED TO PIN THE DEFECT. It had two halves: a paused workspace
    // shows no Active badge, and then "the badge is not simply gone: an unpaused
    // workspace still gets it" — asserted with `pause.data = undefined`, which
    // is not an unpaused workspace at all. It is a read that has not landed. So
    // the second half REQUIRED the screen to call a workspace it had heard
    // nothing about Active, and the honest fix (gate the badge on the read
    // having answered) failed here rather than passing. The property that was
    // meant is below: the badge is not simply gone, it follows the ANSWER.
    for (const [name, apply] of READ_STATES) {
      renderBilling(apply);
      if (name === "running") {
        expect(screen.getByText("Active"), name).toBeTruthy();
      } else {
        expect(screen.queryByText("Active"), name).toBeNull();
      }
      cleanup();
    }

    // And each of the other three is itself rather than merely not-green: the
    // paused card and an amber badge on a workspace we were told is paused, a
    // neutral pill while we are still asking, and nothing at all after a read
    // that failed — because there is nothing to claim, in either direction.
    renderBilling(() => { pause.data = pausedNow(); });
    expect(screen.getByText("Your plan is paused")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.queryByText("Checking…")).toBeNull();
    cleanup();

    renderBilling(() => {});
    expect(screen.getByText("Checking…")).toBeTruthy();
    cleanup();

    renderBilling(() => {
      pause.error = new ApiError("internal_error", "Couldn't reach Stripe.", 502);
    });
    expect(screen.queryByText("Checking…")).toBeNull();
    expect(screen.queryByText("Paused")).toBeNull();
  });

  it("PAGE-PAUSE-1a: nothing that is only true of a RUNNING plan survives an unread pause", () => {
    // The badge is the loudest claim on this card but it is not the only one.
    // The allowance lines describe what a plan gives you, which is not what a
    // paused plan is giving anybody; and "Switch to Starter" is a control
    // `POST /v1/billing/change-plan` answers 409 to while `paused_at` is set
    // ("Your plan is paused. Resume it first, then switch plans"). Both were
    // rendered off "we have no pause in hand", which is true of a paused
    // workspace on a cold start.
    for (const [name, apply] of READ_STATES) {
      renderBilling(apply);
      const isRunning = name === "running";
      const copy = document.body.textContent ?? "";

      expect(copy.includes(PLAN_FACTS.pro.seats), `${name}: allowances`).toBe(
        isRunning,
      );
      expect(
        screen.queryByRole("button", { name: "Switch to Starter" }) !== null,
        `${name}: plan switch`,
      ).toBe(isRunning);
      // The plan and its price stay in every state: a pause changes what is
      // CHARGED, and the card above says so — it does not change which plan is
      // parked, and blanking it would leave a Plan card with no plan on it.
      expect(copy, name).toContain(PLAN_FACTS.pro.name);
      cleanup();
    }
  });

  it("PAGE-PAUSE-1c: the add-ons toggle waits for the read, like everything else", () => {
    // `POST /v1/billing/modules` refuses to turn an add-on ON while paused
    // (`apps/api/src/routes/billing.ts`, 409 "Resume it first"), and this card's
    // own promise — that changes prorate to today — is not true in that state.
    // So the toggle is a control the product answers 409 to, sitting under a
    // sentence that is false, and it was rendered off `subscription_status ===
    // "active"`, which a pause leaves genuinely true because a pause is a price
    // swap rather than a cancellation.
    //
    // Swept across every read state rather than only the paused one: "not read
    // yet" is the cold start every visit begins with, and it was the state that
    // made the plan switch wrong two rounds ago.
    for (const [name, apply] of READ_STATES) {
      renderBilling(apply);
      expect(
        screen.queryByText("Add-ons") !== null,
        `${name}: add-ons card`,
      ).toBe(name === "running");
      cleanup();
    }
  });

  it("PAGE-PAUSE-1b: a read that failed says so, and offers to ask again", () => {
    // The one state where silence would leave a card that has quietly dropped
    // half its contents with no reason given. It says what is NOT known and that
    // nothing changed, because the next thought after "couldn't check" is "did
    // something happen to my plan" — and it offers the retry, because a screen
    // that cannot answer and cannot be asked again is a dead end.
    renderBilling(() => {
      pause.error = new ApiError("internal_error", "Couldn't reach Stripe.", 502);
    });

    const copy = document.body.textContent ?? "";
    expect(copy).toContain("couldn't check this plan's status");
    expect(copy).toContain("untouched");
    // Never the transport's words. The thrown message is our plumbing, and
    // reading it back at somebody looking at their own plan explains nothing
    // they can act on.
    expect(copy).not.toContain("Couldn't reach Stripe");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pause.refetch).toHaveBeenCalledTimes(1);
  });

  it("PAGE-PAUSE-2: leaving is STILL one action from landing on this screen", () => {
    // The rule that outranks the feature, measured where it is actually spent:
    // on the page, with the paused card above everything. No expand, no dialog,
    // no disabled control — one press of the button that was always there.
    renderPaused();
    const leave = screen.getByRole("button", {
      name: new RegExp(CANCEL_ACTION),
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expectTheExitLeaves(leave, "on a paused workspace");
    expect(portal.mutate).toHaveBeenCalledTimes(1);
  });

  it("PAGE-PAUSE-3: the pause is not offered again to somebody already paused", () => {
    // `already_paused` is an ineligible reason, so no Pause control: a second
    // one on a paused workspace would be a button that 409s on click.
    //
    // AND THE WORDS UNDERNEATH ARE THE PAUSED ONES. The shared seasonal answer
    // written for an unpaused reader ends "a quiet season longer than that
    // outruns the hold and the number goes back to the phone company" — which
    // is the whole reason that answer is worth showing, and is false for
    // somebody whose hold has no clock on it. It would sit a dozen lines under
    // a card on this same screen saying nothing expires while they are paused,
    // with both sentences on screen at once, disagreeing.
    renderPaused();
    fireEvent.click(
      screen.getByRole("radio", { name: "Quiet season, I'll be back" }),
    );

    const pausedAnswer = offerFor({
      reason: "seasonal",
      plan: "pro",
      paused: true,
    });
    expect(screen.getByText(pausedAnswer.heading)).toBeTruthy();
    expect(
      screen.queryByText(offerFor({ reason: "seasonal", plan: "pro" }).heading),
    ).toBeNull();
    // Read off the rendered page rather than off the shared string, because the
    // contradiction this guards was between two sentences that were each
    // defensible on their own and were shown together.
    expect(document.body.textContent).not.toContain("outruns the hold");
    expect(screen.queryByText(/^Pause for /)).toBeNull();
  });

  it("PAGE-PAUSE-4: one press reaches Stripe from the PAGE, in every pause state", () => {
    // PAUSE-11's rule where the action is actually spent: from landing on
    // /settings/billing, not from a card rendered on its own. The pause put a new
    // card at the TOP of this screen — above the plan, above the payment card,
    // above the way out — so "nothing new above the exit costs a press" is a
    // property of the page rather than of the card, and the two states that would
    // break it are the ones no fixture could describe until now.
    const states: [name: string, apply: () => void][] = [
      ["not read yet", () => {}],
      [
        "read failed",
        () => {
          pause.error = new ApiError(
            "internal_error",
            "Couldn't reach Stripe.",
            502,
          );
        },
      ],
      [
        "eligible",
        () => {
          pause.data = {
            eligible: true,
            reason: null,
            paused_at: null,
            monthly_cents: ODD_CENTS,
            resume_plan: "pro",
          };
        },
      ],
      [
        "paused",
        () => {
          pause.data = {
            eligible: false,
            reason: "already_paused",
            paused_at: daysAgo(9),
            monthly_cents: ODD_CENTS,
            resume_plan: "pro",
          };
        },
      ],
    ];

    for (const [name, apply] of states) {
      activeRole.current = "owner";
      pause.data = undefined;
      pause.error = null;
      apply();
      companyQuery.data = company({
        subscription_status: "active",
        canceled_at: null,
      });
      portal.mutate.mockClear();
      render(<BillingSettingsPage />);

      const leave = screen.getByRole("button", {
        name: new RegExp(CANCEL_ACTION),
      });
      // Taken, from the page. However a state might have taken this control
      // away, the observable is the same one: nothing reached Stripe.
      expect(screen.queryByRole("dialog"), name).toBeNull();
      expectTheExitLeaves(leave, name);
      expect(portal.mutate, name).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("PAGE-PAUSE-6: a paused workspace is offered no plan switch ANYWHERE", () => {
    // TWO CONTROLS ON THIS PAGE OPEN THE SAME REFUSAL, and only one of them was
    // ever gated. The plan card has its own "Switch to Starter"; the
    // cancellation answer draws a second one an inch under the button that
    // leaves, from `cancellationOffer`'s `change_plan` action. `POST
    // /v1/billing/change-plan` answers 409 to both while `paused_at` is set. A
    // card-level test cannot see this, because the two controls live on
    // different cards — it is a property of the SCREEN.
    renderBilling(() => {
      pause.data = pausedNow();
    });
    fireEvent.click(screen.getByRole("radio", { name: "Too expensive" }));

    expect(
      screen.queryAllByRole("button", { name: "Switch to Starter" }),
    ).toHaveLength(0);
    // The answer is still there, and it names the order the refusal names, so
    // somebody who goes and does it reads the same sentence twice rather than a
    // contradiction.
    expect(document.body.textContent).toContain(
      "resume first, then switch plans",
    );
  });

  it("PAGE-PAUSE-7: nothing tells a PAUSED reader their texting is about to stop", () => {
    // #524 — THE SCREEN MAY NOT CLAIM A STATE IT HAS NOT READ.
    //
    // "Texting stops at the end of your billing period" is a claim that texting
    // is on. For a paused workspace it stopped the day they paused, and the
    // paused card at the top of this same screen says "texting is off" in as
    // many words. Two sentences, one screen, disagreeing — read by somebody
    // deciding whether to give up a phone number.
    //
    // MEASURED ON THE PAGE, because that is where the contradiction is. Each
    // sentence is defensible alone; what is wrong is the pair, and a card-level
    // test cannot see a pair that lives on two cards. Both surfaces that carry
    // the claim are swept: the cancel card's standing header, and the notice a
    // scheduled cancellation puts at the top (a pause is a price swap, so
    // `cancel_at_period_end` can be set on a workspace that is also paused).
    //
    // AND THE FIX IS NOT ALLOWED TO BE "BRANCH ON THE PAUSE READ". Both
    // sentences sit above the exit, and EXIT-R1/R2/R3 below require everything
    // down to the exit to be byte-for-byte identical whatever the read says —
    // a sentence that changes length when a Stripe round trip lands is an exit
    // that moves under somebody's thumb. So the copy is qualified instead, and
    // is true for either reader without asking anybody anything.
    const surfaces: [name: string, mount: () => void][] = [
      ["paused, owner", () => renderPaused()],
      [
        "paused, cancellation already scheduled",
        () => renderPaused({ cancel_at_period_end: true }),
      ],
      [
        "paused, a bookkeeper who cannot cancel",
        () => {
          renderPaused();
          cleanup();
          activeRole.current = "admin";
          render(<BillingSettingsPage />);
        },
      ],
    ];

    for (const [name, mount] of surfaces) {
      mount();
      const copy = document.body.textContent ?? "";

      // NOT VACUOUS. A screen that simply dropped the sentence would satisfy
      // the ban below while telling somebody nothing about what cancelling
      // costs them, so the claim has to be PRESENT and qualified rather than
      // absent. This half is what stops the guard passing for the wrong reason.
      expect(copy.toLowerCase(), `${name}: says nothing about texting at all`)
        .toContain("texting stops");
      expect(copy, name).not.toMatch(TEXTING_STOPS_UNQUALIFIED);
      cleanup();
    }
  });

  it("PAGE-PAUSE-5: the offer stays BELOW the exit on the page too", () => {
    // OFFER-2 and PAUSE-3 measure this inside the card, where the distance is a
    // few hundred pixels. On the page the exit already sits roughly two screens
    // down on a 375px phone, so an offer that moved up by one element in the card
    // is a third of a screen of extra scrolling added to leaving — charged to
    // somebody for having answered an optional question.
    activeRole.current = "owner";
    pause.data = {
      eligible: true,
      reason: null,
      paused_at: null,
      monthly_cents: ODD_CENTS,
      resume_plan: "pro",
    };
    companyQuery.data = company({
      subscription_status: "active",
      canceled_at: null,
    });
    render(<BillingSettingsPage />);

    const leave = screen.getByRole("button", {
      name: new RegExp(CANCEL_ACTION),
    });
    fireEvent.click(
      screen.getByRole("radio", { name: "Quiet season, I'll be back" }),
    );
    // Found by the literal price rather than by asking the shipped copy function
    // where to look — see PAUSE-10.
    const offer = screen.getByRole("button", {
      name: `Pause for ${ODD_PRICE} a month`,
    });

    expect(
      leave.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expectTheExitLeaves(leave, "with the pause offer on the page");
  });
});

/**
 * #524 — the exit, in one sentence, instead of a list of ways to break it.
 *
 * # The third of three, and what each one is for
 *
 * `expectTheExitLeaves` PRESSES the control and requires Stripe to have been
 * reached. That is the primary guard, it is blind to mechanism, and it is the
 * only one of the three that catches a gate on something other than the pause
 * — an export in flight, a guard inside `leave()`. Its blind spot is geometric:
 * happy-dom has no layout, so an element drawn ON TOP of the exit cannot be
 * detected by any click-based check.
 *
 * That blind spot is this describe block. Its sentence:
 *
 * EVERYTHING A READER PASSES ON THE WAY TO THE EXIT, THE EXIT INCLUDED, IS
 * BYTE-FOR-BYTE THE SAME WHATEVER THE PAUSE READ SAYS.
 *
 * No mechanism appears in that, and none appears below. A covering sibling that
 * arrives with a loading state changes those bytes, and so does the twelfth
 * escape nobody has invented: to have any effect on somebody trying to leave, it
 * has to change something about how the exit is drawn.
 *
 * # Why the region STOPS at the exit
 *
 * Below it is the per-reason answer, which is SUPPOSED to follow the read — the
 * plan switch waits for it (OFFER-P3), the paid pause replaces the hold answer
 * (PAUSE-2). That is the whole point of the exit being last: everything the
 * pause decides happens after somebody has already passed the way out. So the
 * region compared here is exactly the part that may not move.
 *
 * # What this cannot do, and what covers it
 *
 * It proves the property for the five states a fixture can describe. It cannot
 * prove there is no sixth. `exit-path.test.ts` beside this file reads the SOURCE
 * and proves the dependency does not exist at all — for every input, including
 * the ones nobody has written a fixture for. And neither of those two sees a
 * regression that has nothing to do with the pause, which is what the press is
 * for. No one of the three is the guarantee; together they are.
 */
describe("#524 the exit renders the same whatever the pause read says", () => {
  /**
   * Every answer `GET /v1/billing/pause` can leave a screen holding.
   *
   * Five, not four: the two that are not data-shaped are the ones that broke
   * this before (a cold start and a failed read both report `isPending`-ish
   * shapes that a naive gate reads as "wait"), and `eligible` is the one that
   * puts a second control on the card.
   */
  const EVERY_PAUSE_READ: [name: string, apply: () => void][] = [
    ["not read yet", () => {}],
    [
      "read failed",
      () => {
        pause.error = new ApiError(
          "internal_error",
          "Couldn't reach Stripe.",
          502,
        );
      },
    ],
    [
      "eligible",
      () => {
        pause.data = running({
          eligible: true,
          reason: null,
          monthly_cents: ODD_CENTS,
        });
      },
    ],
    ["running", () => { pause.data = running(); }],
    ["paused", () => { pause.data = pausedNow(); }],
  ];

  /**
   * One element's opening tag, attributes sorted.
   *
   * Sorted because attribute ORDER is React's business and not a property
   * anybody chose — a guard that failed on a reordered `class` and `style` would
   * be noise, and noise is what gets a guard deleted.
   */
  function openingTag(element: Element): string {
    const attributes = element
      .getAttributeNames()
      .map((name) => `${name}=${JSON.stringify(element.getAttribute(name))}`)
      .sort();
    return `<${element.tagName.toLowerCase()} ${attributes.join(" ")}>`;
  }

  /**
   * Everything under `root`, in the order a reader meets it — stopping at the
   * end of `stopAfter` when one is given.
   *
   * DOCUMENT ORDER rather than the ancestor chain, so a sibling drawn before the
   * exit — the covering overlay — is inside the region rather than beside it.
   * Stopping at the exit is what leaves the answer below it free to depend on
   * the read, which it is supposed to.
   *
   * One node per LINE, deliberately. `outerHTML` compares the same bytes but
   * fails as a single 12,000-character string, and a diff nobody can read is a
   * guard people learn to re-run rather than fix.
   */
  function regionOf(root: Element, stopAfter?: Element): string {
    const lines: string[] = [];
    let done = false;
    function visit(node: Node): void {
      if (done) return;
      if (node.nodeType === Node.TEXT_NODE) {
        lines.push(JSON.stringify(node.nodeValue));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node as Element;
      lines.push(openingTag(element));
      element.childNodes.forEach(visit);
      lines.push(`</${element.tagName.toLowerCase()}>`);
      if (element === stopAfter) done = true;
    }
    visit(root);
    if (stopAfter && !done) {
      throw new Error("the exit was not inside the region walked");
    }
    return lines.join("\n");
  }

  /** The exit, found the way somebody looking for the way out finds it. */
  function theExit(): HTMLElement {
    return screen.getByRole("button", { name: new RegExp(CANCEL_ACTION) });
  }

  /** The same `take` run once per state, each from a clean render. */
  function inEveryState(take: () => string): Map<string, string> {
    const shots = new Map<string, string>();
    for (const [name, apply] of EVERY_PAUSE_READ) {
      pause.data = undefined;
      pause.error = null;
      apply();
      shots.set(name, take());
      cleanup();
    }
    return shots;
  }

  function expectOneRendering(shots: Map<string, string>, what: string): void {
    const [[reference, expected]] = [...shots];
    for (const [name, actual] of shots) {
      expect(
        actual,
        `\n\n${what}: what a reader meets on the way to the exit is different ` +
          `when the pause read says "${name}" than when it says "${reference}".\n\n` +
          `The way out may not depend on GET /v1/billing/pause in any way at ` +
          `all — not disabled by it, not moved by it, not covered by it, not ` +
          `restyled by it. Whatever this read decides, decide it BELOW the exit.\n`,
      ).toBe(expected);
    }
  }

  it("EXIT-R1: on arrival the whole card is one card, five times over", () => {
    // Nothing has been answered, so nothing on this card is entitled to differ:
    // the per-reason answer needs a reason, and there is none. That makes the
    // comparable region the WHOLE card rather than a prefix of it — including
    // everything below the exit, which is the only state in which that is a
    // fair thing to demand.
    expectOneRendering(
      inEveryState(() => {
        const { container } = render(
          <CancelSubscriptionCard isOwner company={company()} />,
        );
        // Rendered at all, and findable as the way out. The crudest form of
        // this defect is an exit that simply is not there.
        theExit();
        return regionOf(container);
      }),
      "the cancel card on arrival",
    );
  });

  it("EXIT-R2: and with any of the six answered, everything down to it is", () => {
    for (const { label } of CANCELLATION_REASONS) {
      expectOneRendering(
        inEveryState(() => {
          const { container } = render(
            <CancelSubscriptionCard isOwner company={company()} />,
          );
          pick(label);
          return regionOf(container, theExit());
        }),
        `the cancel card with "${label}" answered`,
      );
    }
  });

  it("EXIT-R3: and on the page, where the pause put a card above everything", () => {
    // Measured where the action is actually spent. The card the pause added
    // sits at the TOP of this screen and IS supposed to appear and disappear
    // with the read — so the region here is the cancel card itself plus every
    // wrapper between it and the page, and deliberately not its neighbours.
    expectOneRendering(
      inEveryState(() => {
        activeRole.current = "owner";
        companyQuery.data = company({
          subscription_status: "active",
          canceled_at: null,
        });
        const { container } = render(<BillingSettingsPage />);
        const card = theExit().closest("section");
        if (card === null) throw new Error("the exit is not inside a card");
        const wrappers: string[] = [];
        for (
          let node = card.parentElement;
          node && node !== container;
          node = node.parentElement
        ) {
          wrappers.unshift(openingTag(node));
        }
        return [...wrappers, regionOf(card)].join("\n");
      }),
      "the billing page down to the cancel card",
    );
  });
});

/**
 * #529 — the root behind six of the thirteen escapes that survived #524.
 *
 * Every press and render guard on this card varies exactly ONE input: the pause
 * read. `PauseRead` is a sealed set so that parameterisation is genuinely
 * exhaustive — and `exportContacts.isPending` is `false` in all four of its
 * states, as is every other mutation this screen holds. So a gate keyed on any
 * OTHER state was invisible to 106 passing tests.
 *
 * Not hypothetically. The adversarial pass wrote
 * `disabled={portal.isPending || exportContacts.isPending}` on the exit — which
 * holds the door shut for as long as a CSV is downloading — and all 106 passed.
 *
 * THE PROPERTY, stated once so it does not have to be guessed per state: the
 * exit is disabled by its OWN pending state and by nothing else. `portal.isPending`
 * is a legitimate gate (you have pressed it; it is opening) and is asserted as one
 * below. Every other busy state on this screen is somebody else's work, and none
 * of it may stand between a customer and the way out.
 *
 * Parameterised over the states rather than the escapes, deliberately. A list of
 * escape shapes is a list somebody has to keep guessing at; a list of the inputs
 * the card can read is finite and comes from the mock table above.
 */
describe("CR-#529: no other busy state can hold the exit shut", () => {
  /**
   * Every mutation this billing screen holds, other than the exit's own.
   *
   * Scoped to what this component can actually READ — `portal`, `record`,
   * `exportContacts` and the pause query — and deliberately not padded with the
   * rest of the billing screen's mutations. A gate cannot be written against a
   * binding that is not in scope: `disabled={changePlan.isPending}` here is a
   * ReferenceError, which fails loudly on its own and needs no parameterisation.
   * Listing it anyway would be a guard that cannot fail, and this repository has
   * already found and deleted a shelf of those.
   */
  const OTHER_WORK: [name: string, busy: () => void][] = [
    // The escape the adversarial pass actually landed.
    ["a contact export is running", () => (exportContacts.isPending = true)],
    // And the one nothing could have caught: the real hook is a `useMutation`,
    // so it HAS an `isPending`, and this file's mock did not — a gate on it read
    // `undefined` forever. Adding the field to the fixture is half this fix.
    ["the reason is being recorded", () => (record.isPending = true)],
  ];

  it.each(OTHER_WORK)("the exit still leaves while %s", (name, busy) => {
    busy();
    const leave = renderCard();
    expectTheExitLeaves(leave, `while ${name}`);
  });

  it("the exit still leaves while BOTH other jobs run at once", () => {
    // The states are independent, so a per-state pass does not prove the
    // conjunction — and a real `disabled={a || b}` needs only one of them.
    for (const [, busy] of OTHER_WORK) busy();
    const leave = renderCard();
    expectTheExitLeaves(leave, "while every other job runs");
  });

  it("but its OWN pending state does disable it, which is the point", () => {
    // The positive control, and the reason this suite cannot be satisfied by
    // deleting the `disabled` attribute altogether. Pressing twice must not open
    // two Stripe sessions, so this one gate is correct and has to stay.
    portal.isPending = true;
    render(<CancelSubscriptionCard isOwner company={company()} />);
    const leave = screen.getByRole("button", { name: /Opening…/ });
    expect(leave).toBeTruthy();
    expect((leave as HTMLButtonElement).disabled).toBe(true);
  });

  it("the export button is disabled by ITS own work and not by the exit's", () => {
    // The mirror of the above, so neither button can end up gated on the other.
    // A customer who has pressed Leave should still be able to take their
    // contacts; a customer taking their contacts should still be able to leave.
    portal.isPending = true;
    render(<CancelSubscriptionCard isOwner company={company()} />);
    const exportButton = screen.getByRole("button", {
      name: new RegExp(CANCEL_EXPORT_ACTION),
    });
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
  });
});
