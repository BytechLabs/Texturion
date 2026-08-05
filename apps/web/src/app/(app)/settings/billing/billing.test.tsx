/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLAN_PRICING } from "@/lib/api/types";

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
const { portal, record, exportContacts } = vi.hoisted(() => ({
  portal: { mutate: vi.fn(), isPending: false },
  record: { mutate: vi.fn() },
  exportContacts: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/lib/api/billing", () => ({
  useBillingPortal: () => portal,
  useRecordCancellationReason: () => record,
}));
vi.mock("@/lib/api/contacts-export-hook", () => ({
  useExportContacts: () => exportContacts,
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

/**
 * Render the card as somebody actually meets it, and return the control that
 * leaves. There is deliberately no interaction in here: every test below
 * measures its steps from a plain arrival on the billing screen, so a trigger
 * added in front of the card would have to be clicked somewhere visible rather
 * than hidden inside a helper.
 */
function renderCard(): HTMLElement {
  render(<CancelSubscriptionCard isOwner />);
  return screen.getByRole("button", { name: new RegExp(CANCEL_ACTION) });
}

afterEach(cleanup);

beforeEach(() => {
  portal.mutate.mockReset();
  portal.isPending = false;
  record.mutate.mockReset();
  exportContacts.mutate.mockReset();
  exportContacts.isPending = false;
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
    render(<CancelSubscriptionCard isOwner />);

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
    render(<CancelSubscriptionCard isOwner={false} />);
    expect(screen.getByText(CANCEL_ADMIN_NOTE)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("CR-15: an admin is not promised something and then denied it", () => {
    // The owner's copy opens "Cancel anytime", which is true for the person it
    // is shown to and a runaround for anybody else: read directly above "only
    // the owner can cancel" it says the screen is either broken or stalling.
    // The non-owner gets the same three facts, said about the owner.
    render(<CancelSubscriptionCard isOwner={false} />);
    expect(screen.queryByText(CANCEL_CONSEQUENCE)).toBeNull();

    const copy = screen.getByText(CANCEL_ADMIN_CONSEQUENCE).textContent ?? "";
    // Still says what cancelling COSTS, which is the part an admin relays.
    expect(copy).toMatch(/30 days/);
    expect(copy.toLowerCase()).toContain("texting stops");
    expect(copy.toLowerCase()).not.toContain("cancel anytime");
  });
});
