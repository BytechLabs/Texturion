/**
 * @vitest-environment happy-dom
 *
 * #594 — the confirmation gate in front of closing the workspace.
 *
 * This card ends a business's account: everyone is signed out now, the number
 * goes back to the phone company now, and after 30 days nobody can undo any of
 * it. Being the owner is what a stolen session already is, so the server refuses
 * on a role check alone and asks who is actually pressing this (#537). These
 * tests run in a real DOM because the thing that can be wrong is not on screen at
 * all — it is WHERE the six digits get sent, and whether a refused code says so
 * without quietly minting a second one.
 *
 * Every assertion below is about destinations and counts, never about wording:
 * `HANDOVER_CONFIRM_WHERE.reprove` is word for word the authenticator sentence,
 * so a test that pinned the copy would have passed throughout the lockout that
 * #581/#7 fixed on the sibling surface.
 */
import {
  act,
  cleanup,
  fireEvent,
  render as mount,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyView } from "@/lib/api/types";

/** DELETE /v1/company. Driven per test, including its callbacks. */
const mutate = vi.fn();
/** "Email me a code" — the only thing the gate asks our API for up front. */
const requestCode = vi.fn();
/** Where the browser is sent once the workspace is gone. */
const replace = vi.fn();
/**
 * Signing this browser out. Stubbed because it is a real sequence of network
 * calls — push release, session revoke, GoTrue sign-out — and none of it is what
 * this file is about.
 *
 * Nothing here covers it, and the comment that used to sit in this spot said it
 * "has its own tests", which is false: `@/lib/auth/end-session` has no test file
 * anywhere in the repo, and no assertion below reads this mock. What it is here
 * for is the await — `onSuccess` waits on it before redirecting, and that wait is
 * the whole window the code prompt used to stay open in.
 */
const endSession = vi.fn(async (_companyId: string | null) => ({ error: null }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

// Wrapped in an arrow rather than passed straight through: `vi.mock` is hoisted
// above the `const` above it, so a factory that reads `endSession` while the
// module is being linked dies on the temporal dead zone. Reading it inside the
// call defers that to the click.
vi.mock("@/lib/auth/end-session", () => ({
  endSessionOnThisDevice: (companyId: string | null) => endSession(companyId),
}));

// Only the mutation hooks are replaced. `importOriginal` keeps everything else in
// both modules real — a stub of a predicate would be a second copy of the very
// rule under test.
vi.mock("@/lib/api/companies", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCloseWorkspace: () => ({ isPending: false, mutate }),
}));

vi.mock("@/lib/api/ownership", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
  // Needed because the real `@/lib/api/ownership` and `@/lib/api/companies` are
  // loaded for everything the tests did not replace, and their fetch client reads
  // the token from here. No request is made in this suite.
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

import { CloseWorkspaceCard } from "./close-workspace-card";

const FACTOR = "totp-factor-id";

const COMPANY = {
  id: "c-1",
  name: "Alvarez Plumbing",
  plan: "pro",
} as unknown as CompanyView;

/** What the server answers with once the closure actually happens. */
const CLOSED = {
  already_closed: false,
  purge_after: "2026-09-09T12:00:00Z",
  sessions_ended: 3,
  push_devices_removed: 2,
  numbers_released: 1,
  subscription_cancelled: true,
  receipt_emailed: true,
};

interface Handlers {
  onSuccess?: (data: unknown) => void;
  onError?: (error: unknown) => void;
}

/**
 * Refuse the first attempt the way the server does, then let the retry through.
 *
 * The retry is the interesting call: what it carries is the difference between a
 * workspace that closes and a dialog that can never be satisfied.
 */
function refuseOnce(errorCode: string) {
  let refused = false;
  mutate.mockImplementation((_code: string | undefined, handlers?: Handlers) => {
    if (!refused) {
      refused = true;
      handlers?.onError?.(new ApiError(errorCode as never, "nope", 403));
      return;
    }
    handlers?.onSuccess?.(CLOSED);
  });
}

/**
 * Record every attempt instead of answering it, so the test decides when — and
 * through WHICH captured handler — the server refuses.
 */
const attempts: Array<{ code: string | undefined; handlers?: Handlers }> = [];
function captureAttempts() {
  attempts.length = 0;
  mutate.mockImplementation((code: string | undefined, handlers?: Handlers) => {
    attempts.push({ code, handlers });
  });
}

/**
 * Mount, type the workspace name, and press the destructive button. What the
 * server does about it is whatever the test told `mutate` to do.
 */
function pressClose() {
  mount(<CloseWorkspaceCard company={COMPANY} />);
  fireEvent.click(screen.getByRole("button", { name: "Close this workspace" }));
  fireEvent.change(screen.getByLabelText(/to confirm/i), {
    target: { value: COMPANY.name },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close workspace" }));
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

/**
 * The input the action was retried with, or `{}` if it never was.
 *
 * `useCloseWorkspace` takes the code as its whole input rather than a field on an
 * object — there is nothing else to send — so this reshapes the bare argument
 * into the `code` the assertions are about. Callers that care whether a retry
 * happened at all check `mutate` was called twice, because an absent retry and a
 * retry with no code both read as `undefined` here.
 */
function retriedWith(): { code?: string } {
  const second = mutate.mock.calls[1];
  return second ? { code: second[0] as string | undefined } : {};
}

describe("CloseWorkspaceCard, when the server asks who is doing this", () => {
  afterEach(() => {
    cleanup();
    // Both dialogs render through a Radix portal onto `document.body` rather than
    // into the container `cleanup` unmounts, so anything a portal leaves behind
    // outlives the test that opened it — and every query in this file is a
    // whole-body search for a code field. Cleared rather than trusted; no leak
    // was observed, and this is here so one cannot start being tolerated.
    document.body.innerHTML = "";
  });
  beforeEach(() => {
    mutate.mockReset();
    requestCode.mockReset();
    replace.mockReset();
    endSession.mockClear();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    listFactors
      .mockReset()
      .mockResolvedValue({ data: { totp: [{ id: FACTOR }] }, error: null });
    challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null });
  });

  it("gives the digits somewhere to be typed", () => {
    // A refusal about a code, on a screen with no field in it, is not a missing
    // feature: it is a workspace that cannot be closed from the only screen that
    // offers to close it.
    refuseOnce("mfa_reprove_required");
    pressClose();
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).not.toBeNull();
    // And it does not open already accusing them. "That code didn't work" on a
    // prompt nobody has typed into yet is not just wrong copy: the dialog clears
    // the field every time `rejected` flips, so a prompt stuck on rejected wipes
    // the correct digits as they are entered and the workspace can never close.
    // The refusal being SHOWN is proven below; this is the other direction, and
    // without it `rejected={true}` passes the whole file.
    expect(screen.queryByText(HANDOVER_CONFIRM_REJECTED)).toBeNull();
  });

  it("spends a stale-proof code on Supabase and retries with NO code", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. `mfa_reprove_required` is not a check on
    // a code — it is a check on how long ago this session proved a factor. So the
    // digits are proved against Supabase in this browser, which refreshes the
    // session, and the retry carries nothing.
    refuseOnce("mfa_reprove_required");
    pressClose();

    await answer("123456");

    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    // Both halves. `code: "123456"` on the retry is the infinite loop: the same
    // refusal comes back to every correct code, forever.
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(retriedWith().code).toBeUndefined();
    // Nothing was emailed either: their app makes the codes.
    expect(requestCode).not.toHaveBeenCalled();
    // And it went through — the closure completed rather than sitting behind a
    // prompt that had already been answered. The last line is the one that was
    // false when this comment was first written: `onSuccess` never told the gate,
    // so the six digits stayed on screen over a workspace that was already gone.
    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
  });

  it("leaves nothing to press once the workspace is closed", async () => {
    // The regression `gate.dismiss()` exists to prevent, stated the way somebody
    // would hit it. `onSuccess` awaits a real round trip before the redirect —
    // push release, session revoke, GoTrue sign-out — and for that whole window
    // the code prompt used to still be standing, the digits still in it and
    // Confirm still lit over a workspace that had already been closed. Pressing
    // it ran the gate a second time: another Supabase challenge, and a THIRD
    // `close.mutate`. Closing a workspace is the one thing nobody can undo after
    // 30 days, so a second trigger for it is not a cosmetic problem.
    refuseOnce("mfa_reprove_required");
    pressClose();

    await answer("123456");

    // Both buttons that fire the closure, captured before anything is clicked so
    // the presses below actually happen when the fix is missing.
    const survivors = [HANDOVER_CONFIRM_SUBMIT, "Close workspace"].map((name) =>
      screen.queryByRole("button", { name }),
    );
    for (const survivor of survivors) {
      if (survivor) {
        await act(async () => {
          fireEvent.click(survivor);
        });
      }
    }

    // One object rather than three assertions, so all three numbers are read on
    // every run: separate `expect`s would stop at the first and the other two
    // would never have been seen to move.
    expect({
      closeAttempts: mutate.mock.calls.length,
      supabaseChallenges: challengeAndVerify.mock.calls.length,
      buttonsStillLive: survivors.filter(Boolean).length,
    }).toEqual({
      // One refusal, one retry. A third is a second closure of a business.
      closeAttempts: 2,
      // And one challenge — a second one burns another of the account's codes.
      supabaseChallenges: 1,
      // Which holds because there was nothing left to press in the first place.
      buttonsStillLive: 0,
    });
  });

  it("posts an emailed code to OUR API, and asks for one on open", async () => {
    refuseOnce("confirmation_code_required");
    pressClose();

    // A dialog whose only working control is "Send it again" has wasted a trip.
    expect(requestCode).toHaveBeenCalledWith("close_workspace");
    await answer("123456");

    expect(retriedWith().code).toBe("123456");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("says a refused code was refused, once, without minting another", async () => {
    // Driven through the handler the component itself passed, because that is the
    // shape of the defect this cannot be allowed to regress into. `demanded` decides
    // "first attempt or refused code" from a value the call site captures a render
    // early; re-reading the hook between attempts hides it. When it got this wrong a
    // refused code produced NO message at all, and every attempt posted a NEW code —
    // invalidating the one being read off the screen.
    captureAttempts();
    pressClose();

    act(() => {
      attempts[0].handlers?.onError?.(
        new ApiError("confirmation_code_required" as never, "nope", 403),
      );
    });
    expect(requestCode).toHaveBeenCalledTimes(1);

    await answer("123456");
    expect(attempts[1]?.code).toBe("123456");

    // The server refuses the digits. Same handler the component handed over with
    // the retry, called the way the component calls it.
    act(() => {
      attempts[1].handlers?.onError?.(
        new ApiError("confirmation_code_required" as never, "nope", 403),
      );
    });

    // The refusal minted nothing behind the code they are still reading. Asserted
    // before the copy below because it is the failure a person cannot see: a
    // second email invalidates the first, so the correct digits they are looking
    // at become wrong ones and every attempt after that is refused.
    expect(requestCode).toHaveBeenCalledTimes(1);
    // And it said so. The dialog renders that line at most once by construction,
    // so counting the node proves nothing; what can actually go wrong is silence,
    // which somebody answering a code prompt reads as "nothing happened" and
    // answers by pressing it again.
    expect(screen.queryByText(HANDOVER_CONFIRM_REJECTED)).not.toBeNull();
    // Still askable — the prompt stays up so the next code has somewhere to go.
    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).not.toBeNull();
    // Nothing was retried off the back of the refusal either.
    expect(attempts).toHaveLength(2);
  });

  it("still reports a refusal no code could fix", () => {
    // A workspace already closed, or a caller the server will not accept as the
    // owner. A code prompt in front of either hides the real reason behind digits
    // that cannot help — and the person types six correct ones to no effect.
    mutate.mockImplementation((_code: string | undefined, handlers?: Handlers) => {
      handlers?.onError?.(
        new ApiError("conflict" as never, "This workspace is already closed.", 409),
      );
    });
    pressClose();

    expect(screen.queryByLabelText(HANDOVER_CONFIRM_FIELD)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("This workspace is already closed.");
  });
});
