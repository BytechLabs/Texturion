/**
 * @vitest-environment happy-dom
 *
 * #594 — the release dialog, when the server asks who is doing this.
 *
 * `number-card.release.test.tsx` already pins who gets offered the control and
 * what the paragraph behind it says. Nothing pinned the half that happens AFTER
 * the owner has typed their own number back and pressed the red button: the
 * server refuses on a role check alone (#537) and asks for proof, and the six
 * digits that answer it have two possible destinations.
 *
 * Which one they take is invisible on screen. `HANDOVER_CONFIRM_WHERE.reprove`
 * is word for word the authenticator sentence, because the person really is
 * opening the same app — so every assertion here is about WHERE the digits went
 * and what the retry carried, never about the wording. A test that pinned the
 * copy would have passed throughout the #581/#7 lockout.
 *
 * Releasing a number is the one act on this screen with no undo: the line goes
 * back to the carrier and whoever rents it next receives the texts this
 * business's customers send it. So the gate in front of it has to be answerable
 * from here, exactly once, and a refusal that no code could fix has to arrive as
 * itself rather than as a code prompt.
 */
import {
  act,
  cleanup,
  fireEvent,
  render as mount,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PhoneNumberSummary } from "@/lib/api/types";

/** The release mutation, driven per test — including its callbacks. */
const mutate = vi.fn();
/** "Email me a code" — the only thing the gate asks our API for up front. */
const requestCode = vi.fn();

vi.mock("@/lib/api/numbers", () => ({
  useReleaseNumber: () => ({ isPending: false, mutate }),
}));

// The hook is replaced; `handoverConfirmationKind` (in `@loonext/shared`) is NOT.
// Which refusals mean "prove yourself" is the rule under test, and a stub of it
// would be a second copy of the thing that has to exist once. `importOriginal`
// keeps everything else in the ownership module real for the same reason.
vi.mock("@/lib/api/ownership", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRequestHandoverCode: () => ({ isPending: false, mutate: requestCode }),
}));

/**
 * The browser Supabase client, narrowed to the two MFA calls the `reprove` path
 * makes. Both verified against `@supabase/auth-js`: `listFactors()` resolves
 * `{ data: { totp, … }, error }` with only VERIFIED factors in `totp`, and
 * `challengeAndVerify({ factorId, code })` resolves `{ data, error }` after it
 * has already saved the refreshed session.
 */
const listFactors = vi.fn();
const challengeAndVerify = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    auth: { mfa: { listFactors, challengeAndVerify } },
  }),
  // Needed because the real `@/lib/api/ownership` is loaded, and its fetch
  // client reads the token from here. No request is made in this suite.
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

import { ReleaseNumberDialog } from "./release-number-dialog";

const FACTOR = "totp-factor-id";
const E164 = "+14155550142";

const NUMBER = {
  id: "n1",
  status: "active",
  country: "US",
  number_e164: E164,
  requested_area_code: null,
  created_at: "2026-07-01T00:00:00Z",
  source: "provisioned",
} as unknown as PhoneNumberSummary;

/**
 * The dialog as the card actually mounts it: `open` is the card's state, so a
 * `close(false)` really closes it. Faking that with a constant would leave the
 * release dialog standing over a number that has already gone.
 */
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <ReleaseNumberDialog number={NUMBER} open={open} onOpenChange={setOpen} />
  );
}

/**
 * Refuse the first attempt the way the server does, then let the retry through.
 *
 * The retry is the interesting call: what it carries is the difference between a
 * number that is released and a dialog that can never be satisfied.
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
      handlers?.onSuccess?.(NUMBER);
    },
  );
}

/**
 * Refuse the first attempt and leave every later one in flight.
 *
 * For the refused-code test, whose second refusal has to arrive through the
 * handler the component passed on the RETRY — not through a fresh read of the
 * hook, and not through a retry that was allowed to succeed.
 */
function refuseThenHold(errorCode: string) {
  let refused = false;
  mutate.mockImplementation(
    (_input: unknown, handlers?: { onError?: (error: unknown) => void }) => {
      if (!refused) {
        refused = true;
        handlers?.onError?.(new ApiError(errorCode as never, "nope", 403));
      }
    },
  );
}

/** Type the number back and press the red button — the G8 friction, then the act. */
function attemptRelease() {
  mount(<Harness />);
  fireEvent.change(screen.getByLabelText(/to confirm/), {
    target: { value: E164 },
  });
  fireEvent.click(screen.getByRole("button", { name: "Release number" }));
}

/** Type six digits into the confirmation dialog and press Confirm. */
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

/** The input the release was retried with, or `{}` if it never was. */
function retriedWith(): { numberId?: string; code?: string } {
  return mutate.mock.calls[1]?.[0] ?? {};
}

describe("ReleaseNumberDialog — answering the proof the server asks for", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mutate.mockReset();
    requestCode.mockReset();
    listFactors
      .mockReset()
      .mockResolvedValue({ data: { totp: [{ id: FACTOR }] }, error: null });
    challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it("spends a stale-proof code on Supabase and retries with NO code", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. `mfa_reprove_required` is not checking a
    // code at all — it is checking how long ago this session proved a factor — so
    // the digits are proved against Supabase in this browser, which refreshes the
    // session, and the release is retried carrying nothing.
    refuseOnce("mfa_reprove_required");
    attemptRelease();

    await answer("123456");

    // Challenged against the account's own factor, in this browser. That is what
    // stamps a new proof time on the session.
    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    // And the retry carries nothing. `code: "123456"` here is the infinite loop:
    // the identical refusal would come back to every correct code, forever, and
    // the owner could never give the number up from the only screen that offers it.
    expect(retriedWith().numberId).toBe("n1");
    expect(retriedWith().code).toBeUndefined();
    // Retried ONCE. The refusal and the retry are the whole flow, and a second
    // retry is a second DELETE of a line that is already back with the carrier —
    // this is the one act on the screen with no undo, so "how many times" is part
    // of the contract, not a detail. It also cannot be seen from the dialog: the
    // first answer succeeds and closes it, and the extra release goes out behind
    // a screen that has already said the number is gone.
    expect(mutate).toHaveBeenCalledTimes(2);
    // Nothing was emailed either: their app makes the codes.
    expect(requestCode).not.toHaveBeenCalled();
    // The prompt is gone rather than left standing over a release that happened.
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
  });

  it("posts an emailed code to OUR API, and asks for one on open", async () => {
    refuseOnce("confirmation_code_required");
    attemptRelease();

    // A dialog whose only working control is "Send it again" has wasted a trip.
    expect(requestCode).toHaveBeenCalledWith("release_number");
    await answer("123456");

    // This path IS checking a code, and the retry is the only request that
    // carries it — `useReleaseNumber` puts it in the DELETE body.
    expect(retriedWith().code).toBe("123456");
    expect(retriedWith().numberId).toBe("n1");
    // And nothing was proved against Supabase: there is no factor in play here.
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("says a refused code was refused — once, and without minting another", async () => {
    // The defect this whole file is aimed at, and it is a CALL-SITE property the
    // hook's own suite cannot see. `demanded` runs from the `onError` this
    // component wrote in ONE render, so it re-runs against that render's hook
    // object — where `held` is still null. Read off state, both of its decisions
    // got the wrong answer on precisely the attempt that matters: a refused code
    // said nothing at all, and a NEW code was emailed behind the one the owner
    // was reading off their screen, so their correct digits became wrong ones.
    //
    // So this presses Confirm for real and then refuses the RETRY through the
    // handlers the component itself passed on that second call — the ones built
    // inside the render-1 closure the gate stored as `held.retry`, which is the
    // stale-closure path. Re-reading the hook between attempts is what hides the
    // bug, and is how the hook's own suite passed for months.
    refuseThenHold("confirmation_code_required");
    attemptRelease();
    expect(requestCode).toHaveBeenCalledTimes(1);
    await answer("123456");

    // No `?.`: if the digits never produced a retry there is nothing to refuse,
    // and this test would otherwise pass by proving something about the first
    // attempt instead.
    const retryHandlers = mutate.mock.calls[1][1] as {
      onError?: (error: unknown) => void;
    };

    // The retry coming back refused, exactly the way the component delivers it.
    await act(async () => {
      retryHandlers.onError?.(
        new ApiError("confirmation_code_required" as never, "nope", 403),
      );
    });

    // Still open, still asking — a code prompt that vanishes on a refusal leaves
    // the number un-released with nothing on screen to say why.
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).not.toBeNull();
    // Said once. Not zero times (the defect), not twice.
    expect(screen.getAllByText(HANDOVER_CONFIRM_REJECTED)).toHaveLength(1);
    // And no second code minted behind the one being read.
    expect(requestCode).toHaveBeenCalledTimes(1);
  });

  it("still reports a refusal no code could fix", async () => {
    // A number already released, or one the workspace cannot give up yet. A code
    // prompt in front of either hides the real reason behind digits that could
    // not have helped — and this dialog's report is an inline alert, not a toast,
    // because the sentence belongs beside the number it is about.
    mutate.mockImplementation(
      (_input: unknown, handlers?: { onError?: (error: unknown) => void }) => {
        handlers?.onError?.(
          new ApiError("conflict" as never, "That number is already gone.", 409),
        );
      },
    );
    attemptRelease();

    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(
      "That number is already gone.",
    );
    // Nothing was retried, and no code was minted for a refusal that is not
    // about proof.
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(requestCode).not.toHaveBeenCalled();
  });
});
