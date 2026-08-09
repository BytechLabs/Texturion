/**
 * @vitest-environment happy-dom
 *
 * /ownership (#515) — and #581/#7, which is why this file exists at all.
 *
 * This page is the ONLY web surface that can accept a workspace, and it used to
 * carry its own hand-rolled copy of the confirmation gate. Two copies of one rule
 * is how the rule drifted: this copy posted the six digits to our API for every
 * kind of demand, and `mfa_reprove_required` does not want them there. On that path
 * the server is not checking a code at all — it is checking how long ago this
 * session last proved a factor — so the identical refusal came back to every
 * correct code, forever. An owner reading "That code didn't work" about their own
 * working authenticator, with no way through, on the one page that hands a business
 * over.
 *
 * Nothing on screen distinguishes the two: `HANDOVER_CONFIRM_WHERE.reprove` is word
 * for word the authenticator sentence, deliberately, because the person really is
 * opening the same app and reading the same digits. So every assertion here is
 * about WHERE THE DIGITS GO. A test that pinned the copy, or merely that a retry
 * happened, would have passed for the entire life of the lockout — which is exactly
 * what the client suites did.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ownership } from "@/lib/api/ownership";

/** An offer waiting for the person reading the page. */
const OFFERED_TO_ME: Ownership = {
  owner_member_id: "m-owner",
  backup_member_id: "m-me",
  i_am_backup: true,
  i_am_owner: false,
  pending: {
    kind: "offer",
    to_member_id: "m-me",
    ripens_at: "2026-07-29T12:00:00Z",
    expires_at: "2026-08-05T12:00:00Z",
    created_at: "2026-07-29T12:00:00Z",
    mine: true,
    ready: true,
  },
  can_offer: false,
  can_claim: false,
  can_cancel: true,
};

/** The named backup, with nothing in flight — the page's other action. */
const BACKUP_STANDING: Ownership = {
  owner_member_id: "m-owner",
  backup_member_id: "m-me",
  i_am_backup: true,
  i_am_owner: false,
  pending: null,
  can_offer: false,
  can_claim: true,
  can_cancel: false,
};

let state: Ownership = OFFERED_TO_ME;

/** Every ownership action the page fires. Driven per test, callbacks and all. */
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
    refetch: vi.fn(),
  }),
  useOwnershipAction: () => ({ isPending: false, mutate }),
  useRequestHandoverCode: () => ({ isPending: false, mutate: requestCode }),
}));

/**
 * The browser Supabase client, narrowed to the two MFA calls the `reprove` path
 * makes. Both verified against `@supabase/auth-js`: `listFactors()` resolves
 * `{ data: { totp, … }, error }` with only VERIFIED factors in `totp`, and
 * `challengeAndVerify({ factorId, code })` resolves `{ data, error }` after it has
 * already saved the refreshed session — which is what stamps a new proof time.
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({
    companyId: "c-1",
    membership: { name: "Alvarez Plumbing" },
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { HANDOVER_CONFIRM_FIELD, HANDOVER_CONFIRM_REJECTED } from "@loonext/shared";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/error";

import { OwnershipView } from "./ownership-view";

const FACTOR = "totp-factor-id";

/**
 * Refuse the first attempt the way the server does, then let the retry through.
 *
 * The retry is the interesting call: what it carries is the difference between a
 * handover that completes and a dialog that can never be satisfied.
 */
function refuseOnce(errorCode: string) {
  let refused = false;
  mutate.mockImplementation(
    (
      _input: unknown,
      handlers?: {
        onSuccess?: (data: unknown) => void;
        onError?: (error: unknown) => void;
      },
    ) => {
      if (!refused) {
        refused = true;
        handlers?.onError?.(new ApiError(errorCode as never, "nope", 403));
        return;
      }
      handlers?.onSuccess?.(state);
    },
  );
}

/** Type six digits into the confirmation dialog and press Confirm. */
async function answer(digits: string) {
  fireEvent.change(screen.getByLabelText(HANDOVER_CONFIRM_FIELD), {
    target: { value: digits },
  });
  // Awaited: the `reprove` path talks to Supabase before it retries, and every
  // assertion is about what happened by the time that answer came back.
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  });
}

/** The input the action was retried with, or an empty object if it never was. */
function retriedWith(): { action?: string; code?: string } {
  return mutate.mock.calls[1]?.[0] ?? {};
}

/** Press the button that accepts the offer sitting on the page. */
function acceptTheOffer() {
  render(<OwnershipView />);
  fireEvent.click(screen.getByRole("button", { name: "Accept ownership" }));
}

afterEach(cleanup);
beforeEach(() => {
  state = OFFERED_TO_ME;
  mutate.mockReset();
  requestCode.mockReset();
  listFactors
    .mockReset()
    .mockResolvedValue({ data: { totp: [{ id: FACTOR }] }, error: null });
  challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe("accepting a workspace when the server asks who is asking", () => {
  it("spends a stale-proof code on SUPABASE and retries with NO code", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR.
    refuseOnce("mfa_reprove_required");
    acceptTheOffer();

    await answer("123456");

    // Challenged and verified against the account's own factor, in this browser.
    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    // And the retry carries nothing. `code: "123456"` here is the infinite loop —
    // the server would answer `mfa_reprove_required` again, and again.
    expect(retriedWith().action).toBe("accept");
    expect(retriedWith().code).toBeUndefined();
    // Nothing was emailed: their app makes the codes, which is also why the dialog
    // keeps Resend hidden for this kind.
    expect(requestCode).not.toHaveBeenCalled();
  });

  it("proves the enrolment wall at Supabase as well, and retries with no code", async () => {
    // `mfa_challenge_required` says this session never presented a factor — a property
    // of the SESSION, which a code in a request body cannot change, and the route it
    // would be posted to does not read one. So these digits go where the stale-factor
    // digits go. These stay two kinds because they are two refusals raised by different
    // code, one of which also wants the retry inside five minutes.
    refuseOnce("mfa_challenge_required");
    acceptTheOffer();

    await answer("123456");

    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    expect(retriedWith().code).toBeUndefined();
  });

  it("posts an emailed code to OUR API, and asks for one on open", async () => {
    refuseOnce("confirmation_code_required");
    acceptTheOffer();

    // A dialog whose only working control is "Send it again" has wasted a trip.
    expect(requestCode).toHaveBeenCalledWith("accept");
    await answer("123456");

    expect(retriedWith().code).toBe("123456");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("does not tell somebody their correct code was wrong", async () => {
    // What the lockout looked like from the outside: the right six digits refused,
    // every single time, with the same sentence.
    refuseOnce("mfa_reprove_required");
    acceptTheOffer();

    await answer("123456");

    expect(screen.queryByText(HANDOVER_CONFIRM_REJECTED)).toBeNull();
    // And the prompt is gone, rather than left standing over a workspace that has
    // already changed hands.
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("You now own this workspace.");
  });

  it("says so once when the digits really were wrong, and stays open", async () => {
    challengeAndVerify.mockResolvedValue({
      data: null,
      error: new Error("invalid totp"),
    });
    refuseOnce("mfa_reprove_required");
    acceptTheOffer();

    await answer("000000");

    expect(screen.queryByText(HANDOVER_CONFIRM_REJECTED)).not.toBeNull();
    // Still open, because the next code the app shows will work.
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).not.toBeNull();
    // And the action was NOT retried on a proof that never landed.
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("refuses a second press while Supabase is still deciding", async () => {
    // The page's own `pending` had no term for a verify in flight, so the dialog
    // stayed live through it. A second submit opens a second challenge against a
    // code the first already burned — and the person is told their correct digits
    // were wrong.
    let settle!: (value: unknown) => void;
    challengeAndVerify.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    refuseOnce("mfa_reprove_required");
    acceptTheOffer();

    fireEvent.change(screen.getByLabelText(HANDOVER_CONFIRM_FIELD), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await act(async () => {});

    expect(
      (screen.getByRole("button", { name: "Confirming…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => settle({ data: {}, error: null }));
    expect(challengeAndVerify).toHaveBeenCalledTimes(1);
    expect(retriedWith().code).toBeUndefined();
  });

  it("still reports a refusal no code could fix", async () => {
    // Someone else is already taking this over, or the caller is not who they need
    // to be. A code prompt in front of either hides the real reason behind digits
    // that could never have helped.
    mutate.mockImplementation(
      (_input: unknown, handlers?: { onError?: (error: unknown) => void }) => {
        handlers?.onError?.(
          new ApiError("conflict" as never, "Somebody else is taking this over.", 409),
        );
      },
    );
    acceptTheOffer();

    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      "Somebody else is taking this over.",
    );
  });
});

describe("asking to take over, behind the pause that page already had", () => {
  it("stacks the code prompt over the consequences, and retries with NO code", async () => {
    // The claim keeps its own dialog — the ethical friction of starting a takeover —
    // and the code prompt has to be reachable ON TOP of it, or the gate is a wall
    // for the one action the page asks somebody to think hardest about.
    state = BACKUP_STANDING;
    refuseOnce("mfa_reprove_required");
    render(<OwnershipView />);

    fireEvent.click(screen.getByRole("button", { name: "Ask to take over" }));
    const pause = screen.getByRole("dialog");
    expect(pause.textContent).toContain("Only do this if the owner genuinely");
    fireEvent.click(
      within(pause).getByRole("button", { name: "Ask to take over" }),
    );

    await answer("123456");

    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    expect(retriedWith().action).toBe("claim");
    expect(retriedWith().code).toBeUndefined();
    // Both dialogs are put away by the retry's success, not just the code prompt.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith(
      "Asked. The owner has 7 days to stop it.",
    );
  });
});

describe("stopping one is never gated", () => {
  it("asks for no code to withdraw or decline", async () => {
    // `cancel` is ungated end to end: `useOwnershipAction` strips a code off it, and
    // somebody who has lost their authenticator has to be able to stop a handover of
    // their own business. So even a server that demanded proof for one must not make
    // this collect digits it would then throw away.
    refuseOnce("mfa_reprove_required");
    render(<OwnershipView />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });
});
