/**
 * @vitest-environment happy-dom
 *
 * #525 — the screen where somebody agrees to the one-time US registration fee,
 * read by a workspace whose plan is paused.
 *
 * `us-registration-timing.test.ts` pins the rules and the words. This file is
 * the half that cannot be faked: it renders the real card, opens the real
 * dialog, and asserts the SHIPPED CONSTANTS land in the document. A copy module
 * nobody imports and a branch nobody reaches both pass a pure test.
 *
 * ENUS-4 is the one that would have caught the original defect, and ENUS-5 is
 * the one that keeps the fix from becoming the thing #525 forbids: there is no
 * state in which the Enable control is missing, disabled, or waiting on our
 * network request. Pausing does not cost somebody the purchase.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PauseOffer } from "@/lib/api/billing";
import type { CompanyView } from "@/lib/api/types";

import {
  US_REGISTRATION_PAUSED_HEADING,
  US_REGISTRATION_PAUSED_NOTE,
  US_REGISTRATION_RUNNING_TAIL,
  usRegistrationFee,
  usRegistrationPausedTerms,
  usRegistrationTerms,
} from "./us-registration-timing";

const { pauseRef } = vi.hoisted(() => ({
  pauseRef: {
    data: undefined as PauseOffer | undefined,
    isError: false,
  },
}));

/**
 * react-query, stubbed at the boundary the way `my-access-card.test.tsx` does.
 *
 * `enabled` IS HONOURED rather than ignored, because a disabled query reporting
 * data would hide the exact bug this card can have: reading a pause the gate
 * never asked for. The pause query is picked out by its shipped key, so the
 * registration query beside it keeps answering "nothing yet".
 */
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: {
    queryKey: unknown[];
    enabled?: boolean;
  }): { data: unknown; isError: boolean; isPending: boolean } => {
    const isPause =
      Array.isArray(options.queryKey) &&
      options.queryKey.includes("billing-pause");
    if (!isPause || options.enabled === false) {
      return { data: undefined, isError: false, isPending: true };
    }
    return {
      data: pauseRef.data,
      isError: pauseRef.isError,
      isPending: pauseRef.data === undefined,
    };
  },
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Imported by the section but never rendered on this branch; stubbed so the
// test's dependency surface is the card, not everything the rejected-state
// form happens to pull in.
vi.mock("@/components/settings/registration-fix-form", () => ({
  RegistrationFixForm: () => null,
}));
vi.mock("@/components/settings/rejection-notice", () => ({
  RejectionNotice: () => null,
}));

const { roleRef } = vi.hoisted(() => ({ roleRef: { current: "owner" } }));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: roleRef.current }),
  useCompanyId: () => "c-1",
}));

const { RegistrationSection } = await import("./registration-section");

/** A Canadian workspace that has not enabled US texting — the only shape that
 *  draws this card. Billed in CAD, so a US figure on screen is a visible bug. */
function company(over: Partial<CompanyView> = {}): CompanyView {
  return {
    id: "c-1",
    name: "Winter Crew",
    country: "CA",
    billing_currency: "cad",
    us_texting_enabled: false,
    plan: "pro",
    subscription_status: "active",
    ...over,
  } as CompanyView;
}

/** The route's answer for a paused workspace; `paused_at` is the whole fact. */
const PAUSED: PauseOffer = {
  eligible: false,
  reason: "already_paused",
  paused_at: "2026-01-14T00:00:00.000Z",
  monthly_cents: 1275,
  resume_plan: "pro",
};
const RUNNING: PauseOffer = { ...PAUSED, paused_at: null, eligible: true };

function show(
  pause: { data?: PauseOffer; isError?: boolean },
  over: Partial<CompanyView> = {},
): void {
  pauseRef.data = pause.data;
  pauseRef.isError = pause.isError ?? false;
  render(<RegistrationSection company={company(over)} />);
}

/** Everything on screen, dialog included — Radix portals to `document.body`. */
function text(): string {
  return document.body.textContent ?? "";
}

function openTheDialog(): void {
  fireEvent.click(
    screen.getByRole("button", { name: /Enable US texting: .+ one-time/ }),
  );
}

afterEach(cleanup);
beforeEach(() => {
  roleRef.current = "owner";
  pauseRef.data = undefined;
  pauseRef.isError = false;
});

describe("#525 enabling US texting while the plan is paused", () => {
  it("ENUS-1: a paused owner is told the wait runs now, before the control", () => {
    show({ data: PAUSED });
    expect(text()).toContain(US_REGISTRATION_PAUSED_HEADING);
    expect(text()).toContain(US_REGISTRATION_PAUSED_NOTE);
  });

  it("ENUS-2: the dialog states the paused terms and drops the 'it's live' promise", () => {
    show({ data: PAUSED });
    openTheDialog();

    const seen = text();
    expect(seen).toContain(usRegistrationTerms("cad"));
    for (const term of usRegistrationPausedTerms("cad")) {
      expect(seen, `paused term missing: ${term}`).toContain(term);
    }
    // The sentence a pause makes misleading. Approval does not switch sending
    // back on — `runPreSendGates` refuses with `workspace_paused` whatever the
    // carriers say — so promising a live inbox here would mislead somebody at
    // the exact moment we take their money.
    expect(seen).not.toContain(US_REGISTRATION_RUNNING_TAIL);
  });

  it("ENUS-3: a running plan sees the card and the dialog it always saw", () => {
    show({ data: RUNNING });
    expect(text()).not.toContain(US_REGISTRATION_PAUSED_HEADING);

    openTheDialog();
    expect(text()).toContain(US_REGISTRATION_RUNNING_TAIL);
    for (const term of usRegistrationPausedTerms("cad")) {
      expect(text(), `unpaused reader must not see: ${term}`).not.toContain(
        term,
      );
    }
  });

  it("ENUS-4: a pause we could not read is claimed in neither direction", () => {
    // The three states that used to render as "not paused": still loading, and
    // the ask having failed. Neither may promise a live inbox, and neither may
    // announce a pause nobody confirmed.
    for (const pause of [{}, { isError: true }]) {
      show(pause);
      openTheDialog();
      const seen = text();
      expect(seen).not.toContain(US_REGISTRATION_PAUSED_HEADING);
      expect(seen).not.toContain(US_REGISTRATION_RUNNING_TAIL);
      // The terms that are true in every state still stand, so the reader is
      // never left agreeing to a charge with nothing said about it.
      expect(seen).toContain(usRegistrationTerms("cad"));
      cleanup();
    }
  });

  it("ENUS-5: the purchase is never gated, delayed, or hidden by the pause", () => {
    // #525 rule 1, at the surface. Refusing was the option that costs the
    // customer: carrier review takes days to weeks, and a quiet winter is when
    // that wait is free. Whatever we know or fail to learn about the pause, the
    // control is drawn and it is live.
    for (const pause of [{ data: PAUSED }, { data: RUNNING }, {}, { isError: true }]) {
      show(pause);
      const button = screen.getByRole("button", {
        name: /Enable US texting: .+ one-time/,
      });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      openTheDialog();
      expect(
        (screen.getByRole("button", { name: "Enable US texting" }) as
          HTMLButtonElement).disabled,
      ).toBe(false);
      cleanup();
    }
  });

  it("ENUS-6: the money on screen is the workspace's own, in every state", () => {
    // #328: this workspace is billed in CAD. The paused branch names the fee a
    // second time, which is a second place for a US figure to leak in.
    show({ data: PAUSED });
    openTheDialog();
    expect(text()).toContain(usRegistrationFee("cad"));
    expect(text()).not.toContain(usRegistrationFee("usd"));
  });
});
