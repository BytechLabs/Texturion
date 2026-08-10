/**
 * @vitest-environment happy-dom
 *
 * #332 — the ownership card.
 *
 * These pin the parts that are about SAFETY rather than layout: a handover in
 * flight is shown to everybody (including the plain member who is neither
 * side of it), a workspace with no backup named says so where the owner will
 * see it, and no button that hands a business to somebody appears for a caller
 * the server did not authorise.
 *
 * #581/#7 added the second half, at the bottom: the card is where an owner hands
 * the business over, and the server now refuses to do it without proof of who is
 * asking. Those tests run in a real DOM because the thing that was broken is not
 * on screen at all — it is WHERE the six digits get sent.
 */
// `render` is already the name of this file's static-markup helper, so the DOM
// one comes in as `mount`.
import {
  act,
  cleanup,
  fireEvent,
  render as mount,
  screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ownership } from "@/lib/api/ownership";
import type { Member } from "@/lib/api/types";

const members: Member[] = [
  {
    id: "m-owner",
    user_id: "u-owner",
    role: "owner",
    deactivated_at: null,
    created_at: "2026-01-01T00:00:00Z",
    display_name: "Sam Founder",
  },
  {
    id: "m-partner",
    user_id: "u-partner",
    role: "admin",
    deactivated_at: null,
    created_at: "2026-02-01T00:00:00Z",
    display_name: "Riley Partner",
  },
];

let state: Ownership = {
  owner_member_id: "m-owner",
  backup_member_id: null,
  i_am_backup: false,
  i_am_owner: true,
  pending: null,
  can_offer: true,
  can_claim: false,
  can_cancel: false,
};

/** Every action the card fires. Driven per test, including its callbacks. */
const mutate = vi.fn();
/** "Email me a code" — the only thing the gate asks our API for up front. */
const requestCode = vi.fn();

// The hooks are replaced; `isGatedOwnershipAction` is NOT. Which actions the server
// demands proof for is the rule under test here, and a stub of it would be a second
// copy of the very thing that must exist once.
vi.mock("@/lib/api/ownership", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOwnership: () => ({
    isPending: false,
    isError: false,
    data: state,
  }),
  useOwnershipAction: () => ({ isPending: false, mutate }),
  useRequestHandoverCode: () => ({ isPending: false, mutate: requestCode }),
}));

/**
 * The browser Supabase client, narrowed to the two MFA calls the `reprove` path
 * makes. Both verified against `@supabase/auth-js`: `listFactors()` resolves
 * `{ data: { totp, … }, error }` with only VERIFIED factors in `totp`, and
 * `challengeAndVerify({ factorId, code })` resolves `{ data, error }` after it has
 * already saved the refreshed session.
 */
const listFactors = vi.fn();
const challengeAndVerify = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    auth: { mfa: { listFactors, challengeAndVerify } },
  }),
  // Needed because the real `@/lib/api/ownership` is loaded for its predicate, and
  // its fetch client reads the token from here. No request is made in this suite.
  getAccessToken: async () => "token",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ companyId: "c-1", role: "owner" }),
}));

import {
  HANDOVER_CONFIRM_FIELD,
  HANDOVER_CONFIRM_REJECTED,
  HANDOVER_CONFIRM_SUBMIT,
} from "@loonext/shared";

import { ApiError } from "@/lib/api/error";
import { toast } from "sonner";

import { OwnershipCard } from "./ownership-card";

const render = () => renderToStaticMarkup(<OwnershipCard members={members} />);

describe("OwnershipCard", () => {
  it("tells an owner with no backup that nobody is named", () => {
    state = { ...state, i_am_owner: true, backup_member_id: null };
    const html = render();
    expect(html).toContain("Nobody named");
    // And says what that costs them, rather than just flagging a gap.
    expect(html).toContain("this is the one person who can ask to take over");
  });

  it("offers no handover controls to somebody who is not the owner", () => {
    state = {
      ...state,
      i_am_owner: false,
      can_offer: false,
      can_claim: false,
      can_cancel: false,
    };
    const html = render();
    expect(html).not.toContain("Hand it over");
    expect(html).not.toContain("Ask to take over");
    expect(html).not.toContain("Backup owner");
    // They still see who owns the place. It is their workspace too.
    expect(html).toContain("Sam Founder");
  });

  it("shows the claim button only to the named backup", () => {
    state = { ...state, i_am_owner: false, i_am_backup: true, can_claim: true };
    expect(render()).toContain("Ask to take over");
  });

  it("shows a claim in flight to a member who is neither side of it", () => {
    state = {
      ...state,
      i_am_owner: false,
      i_am_backup: false,
      can_claim: false,
      can_cancel: false,
      pending: {
        kind: "claim",
        to_member_id: "m-partner",
        ripens_at: "2026-08-05T12:00:00Z",
        expires_at: "2027-08-05T12:00:00Z",
        created_at: "2026-07-29T12:00:00Z",
        mine: false,
        ready: false,
      },
    };
    const html = render();
    // The whole reason everybody sees this: a colleague who knows the owner
    // is on holiday is the alarm.
    expect(html).toContain("has asked to take over this workspace");
    expect(html).toContain("unless the owner stops it");
    // No buttons for them — seeing is not acting.
    expect(html).not.toContain("Stop this");
  });

  it("gives the owner a veto for the whole waiting period", () => {
    state = { ...state, i_am_owner: true, can_cancel: true };
    expect(render()).toContain("Stop this");
  });

  it("does not offer to complete a claim before its waiting period is over", () => {
    state = {
      ...state,
      i_am_owner: false,
      can_cancel: true,
      pending: {
        kind: "claim",
        to_member_id: "m-partner",
        ripens_at: "2026-08-05T12:00:00Z",
        expires_at: "2027-08-05T12:00:00Z",
        created_at: "2026-07-29T12:00:00Z",
        mine: true,
        ready: false,
      },
    };
    const html = render();
    expect(html).not.toContain("Complete the takeover");
    // The claimant can still abandon their own claim.
    expect(html).toContain("Decline");
  });

  it("offers acceptance once the server says it is ready", () => {
    state = {
      ...state,
      i_am_owner: false,
      pending: {
        kind: "offer",
        to_member_id: "m-partner",
        ripens_at: "2026-07-29T12:00:00Z",
        expires_at: "2026-08-05T12:00:00Z",
        created_at: "2026-07-29T12:00:00Z",
        mine: true,
        ready: true,
      },
    };
    expect(render()).toContain("Accept ownership");
  });
});

/**
 * #581/#7 — the card can now be asked to prove who is asking, and these pin WHERE
 * the six digits end up.
 *
 * Two things were wrong here and only one of them was visible. The card had no code
 * field at all, so an enrolled owner read a toast about a code with nowhere to type
 * one and could not hand their business over from the only screen that offers it.
 * The invisible half is the one that matters more: `mfa_reprove_required` does not
 * want its digits posted to our API. The server is not checking a code on that path,
 * it is checking how long ago this session last proved a factor — so the digits are
 * proved against SUPABASE in this browser, which refreshes the session, and the
 * action is retried carrying nothing. Post them to us instead and the identical
 * refusal comes back to every correct code, forever.
 *
 * Nothing on screen tells the two apart: `HANDOVER_CONFIRM_WHERE.reprove` is word
 * for word the authenticator sentence, because the person really is opening the same
 * app. So every assertion below is about the destination, never the wording — a test
 * that pinned the copy here would have passed throughout the lockout.
 */
const FACTOR = "totp-factor-id";

/** An offer sitting in front of the person reading the card. */
const OFFER_TO_ME: Ownership = {
  owner_member_id: "m-owner",
  backup_member_id: null,
  i_am_backup: false,
  i_am_owner: false,
  pending: {
    kind: "offer",
    to_member_id: "m-partner",
    ripens_at: "2026-07-29T12:00:00Z",
    expires_at: "2026-08-05T12:00:00Z",
    created_at: "2026-07-29T12:00:00Z",
    mine: true,
    ready: true,
  },
  can_offer: false,
  can_claim: false,
  can_cancel: false,
};

/**
 * Refuse the first attempt the way the server does, then let the retry through.
 *
 * The retry is the interesting call: what it carries is the difference between a
 * handover that completes and a dialog that can never be satisfied.
 */
function refuseOnce(errorCode: string) {
  let refused = false;
  mutate.mockImplementation((_input: unknown, handlers?: {
    onSuccess?: (data: unknown) => void;
    onError?: (error: unknown) => void;
  }) => {
    if (!refused) {
      refused = true;
      handlers?.onError?.(new ApiError(errorCode as never, "nope", 403));
      return;
    }
    handlers?.onSuccess?.(state);
  });
}

/**
 * Type six digits into the confirmation dialog and press Confirm.
 *
 * Both the field and the button are named by their shared constant, never by a
 * retyped copy of it: `getByLabelText`/`getByRole` match the accessible name
 * exactly, so a hand-written "Confirm" here would red every handover suite the
 * day somebody reworded the button — a failure with no customer behind it. This
 * file is the one the other handover suites are copied from, so the habit
 * spreads either way.
 */
async function answer(digits: string) {
  fireEvent.change(screen.getByLabelText(HANDOVER_CONFIRM_FIELD), {
    target: { value: digits },
  });
  // Awaited: the `reprove` path talks to Supabase before it retries, and the
  // assertions are all about what happens after that answer comes back.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: HANDOVER_CONFIRM_SUBMIT }));
  });
}

/**
 * The input the action was retried with. THROWS if it never was.
 *
 * That is the whole point of it, and the version this replaced did the opposite:
 * `mutate.mock.calls[1]?.[0] ?? {}` handed back an empty object when the retry had
 * not happened, so `expect(retriedWith().code).toBeUndefined()` — the assertion this
 * file is copied from, in three suites — passed identically whether the retry
 * carried no code or the action was silently dropped on the floor. Deleting
 * `holding.retry(undefined)` out of `useActionConfirmation` (the owner types their
 * correct digits, the prompt closes, the transfer never happens) left every one of
 * them green.
 *
 * A helper that answers a question it was not asked is the defect, not the tests
 * that trusted it — this file is the template the other handover suites are copied
 * from, so the next copy inherits whichever of the two this is.
 */
function retriedWith(): { action?: string; code?: string; memberId?: string } {
  if (mutate.mock.calls.length < 2) {
    throw new Error(
      "the action was never retried: mutate was called " +
        `${mutate.mock.calls.length} time(s), so there is no retry to inspect`,
    );
  }
  // And exactly one retry, checked here rather than at each call site so no copy
  // of this file can inherit the gap. Answering the prompt twice would hand the
  // workspace over twice, which is the same irreversible double-fire the gate
  // exists to prevent — and reading `calls[1]` alone cannot see a `calls[2]`.
  if (mutate.mock.calls.length > 2) {
    throw new Error(
      `the action was retried ${mutate.mock.calls.length - 1} times, not once: ` +
        "one answered prompt must produce one attempt",
    );
  }
  return mutate.mock.calls[1][0] as {
    action?: string;
    code?: string;
    memberId?: string;
  };
}

describe("…and when the server asks who is doing this", () => {
  afterEach(cleanup);
  beforeEach(() => {
    state = OFFER_TO_ME;
    mutate.mockReset();
    requestCode.mockReset();
    listFactors
      .mockReset()
      .mockResolvedValue({ data: { totp: [{ id: FACTOR }] }, error: null });
    challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it("gives the digits somewhere to be typed", () => {
    // The visible half of the defect. Before this the refusal was a toast about a
    // code and the card had no field anywhere in it.
    refuseOnce("mfa_reprove_required");
    mount(<OwnershipCard members={members} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept ownership" }));
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).not.toBeNull();
  });

  it("spends a stale-proof code on Supabase and retries with NO code", async () => {
    // THE ASSERTION THIS BLOCK EXISTS FOR.
    refuseOnce("mfa_reprove_required");
    mount(<OwnershipCard members={members} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept ownership" }));

    await answer("123456");

    // Challenged and verified against the account's own factor, in this browser.
    // That is what stamps a new proof time on the session.
    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    // And the retry carries nothing. `code: "123456"` here is the infinite loop.
    expect(retriedWith().action).toBe("accept");
    expect(retriedWith().code).toBeUndefined();
    // Nothing was emailed either: their app makes the codes.
    expect(requestCode).not.toHaveBeenCalled();
  });

  it("proves the enrolment wall at Supabase as well, and retries with no code", async () => {
    // `mfa_challenge_required` says this session never presented a factor — a property
    // of the SESSION, which a code in a request body cannot change, and the route it
    // would be posted to does not read one. So these digits go where the stale-factor
    // digits go. These stay two kinds because they are two refusals raised by different
    // code, one of which also wants the retry inside five minutes.
    refuseOnce("mfa_challenge_required");
    mount(<OwnershipCard members={members} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept ownership" }));

    await answer("123456");

    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    // The retry HAPPENED. Without this line the one below it is vacuous: "no code"
    // and "no retry" read the same off a missing call, and "no retry" is the owner
    // watching the prompt close over a handover that did not occur.
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(retriedWith().action).toBe("accept");
    expect(retriedWith().code).toBeUndefined();
  });

  it("posts an emailed code to OUR API, and asks for one on open", async () => {
    refuseOnce("confirmation_code_required");
    mount(<OwnershipCard members={members} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept ownership" }));

    // A dialog whose only working control is "Send it again" has wasted a trip.
    expect(requestCode).toHaveBeenCalledWith("accept");
    await answer("123456");

    expect(retriedWith().code).toBe("123456");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("does not tell somebody their correct code was wrong", async () => {
    // What the lockout looked like from the outside: the right six digits, refused,
    // every time. Asserted on the `reprove` path because that is the one where the
    // digits never reach our API at all.
    refuseOnce("mfa_reprove_required");
    mount(<OwnershipCard members={members} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept ownership" }));

    await answer("123456");

    expect(screen.queryByText(HANDOVER_CONFIRM_REJECTED)).toBeNull();
    // The prompt is gone too, rather than left standing over a handover that has
    // already happened.
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
  });

  it("still reports a refusal no code could fix", async () => {
    // A handover already in flight, or a caller who is not the owner. A code prompt
    // in front of either hides the real reason behind digits that cannot help.
    mutate.mockImplementation((_input: unknown, handlers?: {
      onError?: (error: unknown) => void;
    }) => {
      handlers?.onError?.(new ApiError("conflict" as never, "Already in flight", 409));
    });
    mount(<OwnershipCard members={members} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept ownership" }));

    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Already in flight");
  });

  it("retries an offer at the teammate who was named, carrying no code", async () => {
    // `offer` is the card's whole reason to exist and the only place on the web an
    // owner can start one. Two things are pinned: the retry still goes to Riley
    // rather than to whoever the dropdown might say by then, and it goes with the
    // digits spent on Supabase rather than posted to us.
    state = {
      owner_member_id: "m-owner",
      backup_member_id: null,
      i_am_backup: false,
      i_am_owner: true,
      pending: null,
      can_offer: true,
      can_claim: false,
      can_cancel: false,
    };
    refuseOnce("mfa_reprove_required");
    mount(<OwnershipCard members={members} />);

    // Name the teammate, then read the consequences, then press it — the card's
    // deliberate three steps.
    fireEvent.keyDown(screen.getByText("Choose a teammate").closest("button")!, {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Riley Partner" }));
    fireEvent.click(screen.getByRole("button", { name: "Hand it over" }));
    fireEvent.click(screen.getByRole("button", { name: "Offer it" }));

    await answer("123456");

    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    expect(retriedWith().action).toBe("offer");
    expect(retriedWith().memberId).toBe("m-partner");
    expect(retriedWith().code).toBeUndefined();
  });

  it("never asks for a code to STOP a handover", async () => {
    // `cancel` is deliberately ungated end to end: `useOwnershipAction` strips a
    // code off it, and an owner who has lost their authenticator has to be able to
    // stop a takeover of their own business. So even if the server demanded proof
    // for one, this must not collect digits it would then throw away.
    state = { ...OFFER_TO_ME, can_cancel: true };
    refuseOnce("mfa_reprove_required");
    mount(<OwnershipCard members={members} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });
});
