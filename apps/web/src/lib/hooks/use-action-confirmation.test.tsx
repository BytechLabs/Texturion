/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #537 audit — the fork four screens depend on.
 *
 * Three surfaces (release a number, close the workspace, turn the crew's two-factor
 * requirement off) plus the handover all route their refusals through this. What
 * matters most is the NEGATIVE case: a refusal that is not about proof must come
 * back false, or "a transfer is already in flight" gets hidden behind a code prompt
 * that could never have helped.
 */

const requestCode = vi.fn();
vi.mock("@/lib/api/ownership", () => ({
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
}));

/**
 * The shared destination map, as a mutable object the hook holds a reference to.
 *
 * Starts as the real thing, so every other test in this file sees production values.
 * One test flips an entry to prove the hook READS this rule rather than restating it
 * in its own words — the only way to tell those two apart from outside, and the
 * distinction that matters, because the same decision is made on three clients and it
 * was wrong on all of them when each wrote it out for itself.
 */
// Hoisted with the mock itself: the factory below reads this the moment
// `@loonext/shared` is first imported, which is before a plain `const` at this
// position would have been initialised.
const { destinations } = vi.hoisted(() => ({
  destinations: {
    authenticator: "supabase",
    reprove: "supabase",
    email: "api",
  } as Record<string, string>,
}));
vi.mock("@loonext/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HANDOVER_CODE_DESTINATION: destinations,
}));

import { ApiError } from "@/lib/api/error";

import { useActionConfirmation } from "./use-action-confirmation";

const FACTOR = "totp-factor-id";

afterEach(cleanup);
beforeEach(() => {
  requestCode.mockClear();
  listFactors
    .mockReset()
    .mockResolvedValue({ data: { totp: [{ id: FACTOR }] }, error: null });
  challengeAndVerify.mockReset().mockResolvedValue({ data: {}, error: null });
});

function refusal(code: string, status = 403) {
  return new ApiError(code as never, "nope", status);
}

describe("which refusals ask for proof", () => {
  it("opens the authenticator prompt for somebody who holds a factor", () => {
    const { result } = renderHook(() => useActionConfirmation());
    let handled = false;
    act(() => {
      handled = result.current.demanded(
        refusal("mfa_challenge_required"),
        "close_workspace",
        () => {},
      );
    });
    expect(handled).toBe(true);
    expect(result.current.kind).toBe("authenticator");
    // Nothing is emailed to somebody whose app makes its own codes.
    expect(requestCode).not.toHaveBeenCalled();
  });

  it("emails a code, unprompted, for somebody who holds none", () => {
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "release_number",
        () => {},
      );
    });
    expect(result.current.kind).toBe("email");
    // A dialog whose only working control is "Send it again" has wasted a trip.
    expect(requestCode).toHaveBeenCalledWith("release_number");
  });

  it("leaves every other refusal to the caller", () => {
    // THE CASE THAT MATTERS. A code prompt in front of "somebody else is already
    // taking this over" is a prompt that cannot succeed, hiding the real reason.
    const { result } = renderHook(() => useActionConfirmation());
    for (const code of ["conflict", "forbidden", "validation_failed", "not_found"]) {
      let handled = true;
      act(() => {
        handled = result.current.demanded(refusal(code, 409), "relax_mfa", () => {});
      });
      expect(handled, code).toBe(false);
      expect(result.current.kind, code).toBeNull();
    }
    // And a failure that is not an API error at all — a dropped connection.
    let handled = true;
    act(() => {
      handled = result.current.demanded(new Error("offline"), "relax_mfa", () => {});
    });
    expect(handled).toBe(false);
    expect(requestCode).not.toHaveBeenCalled();
  });
});

describe("retrying with the digits", () => {
  it("re-runs the very call that was refused", () => {
    // Held rather than rebuilt: rebuilding an offer would be a chance to hand the
    // business to somebody other than the person named the first time.
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(refusal("confirmation_code_required"), "offer", retry);
    });
    act(() => result.current.confirm("123456"));
    expect(retry).toHaveBeenCalledWith("123456");
  });

  it("says so once when the code comes back refused, and stays open", () => {
    const { result } = renderHook(() => useActionConfirmation());
    /**
     * THROUGH A CAPTURED HOOK OBJECT, which is the only honest shape for this.
     *
     * Every caller writes its `onError` inside a function defined in one render, so
     * the retry re-runs that handler against THAT render's `gate` — not a freshly
     * read one. Reading `result.current` again between the two calls, as this test
     * used to, hands the hook a currency no component has and passed while the real
     * behaviour was wrong both ways: nothing said on a refused code, and a brand new
     * code emailed behind somebody still reading the first.
     */
    const gate = result.current;
    act(() => {
      gate.demanded(refusal("confirmation_code_required"), "close_workspace", () => {});
    });
    expect(result.current.rejected).toBe(false);

    // The retry was refused too — same stale `gate`, as a component would.
    act(() => {
      gate.demanded(refusal("confirmation_code_required"), "close_workspace", () => {});
    });
    expect(result.current.rejected).toBe(true);
    expect(result.current.kind).toBe("email");
    // And NO second code was minted behind the person still looking at the first.
    expect(requestCode).toHaveBeenCalledTimes(1);
  });

  it("mints a new one only when asked", () => {
    const { result } = renderHook(() => useActionConfirmation());
    const gate = result.current;
    act(() => {
      gate.demanded(refusal("confirmation_code_required"), "release_number", () => {});
    });
    act(() => {
      gate.demanded(refusal("confirmation_code_required"), "release_number", () => {});
    });
    expect(result.current.rejected).toBe(true);
    expect(requestCode).toHaveBeenCalledTimes(1);

    act(() => result.current.resend());
    expect(requestCode).toHaveBeenCalledTimes(2);
    // Asking for another clears the complaint about the last one.
    expect(result.current.rejected).toBe(false);
  });

  it("closes on dismiss, and forgets the action with it", () => {
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(refusal("confirmation_code_required"), "offer", retry);
    });
    act(() => result.current.dismiss());
    expect(result.current.kind).toBeNull();
    expect(result.current.rejected).toBe(false);
    // Nothing to retry into: a dismissed prompt must not still be able to fire.
    act(() => result.current.confirm("123456"));
    expect(retry).not.toHaveBeenCalled();
  });
});

/**
 * #581/#7 — where the six digits actually GO.
 *
 * The copy for `reprove` is word for word the authenticator prompt, so nothing on
 * screen distinguishes them and no screenshot ever will. The difference is entirely
 * here, and getting it wrong is not a cosmetic bug: our API is not checking a code
 * on this path, it is checking how long ago the session last proved a factor. Post
 * the digits at it and the identical refusal comes back, forever — a hard lockout
 * out of ownership transfer and workspace closure, worse than the freshness gap the
 * change exists to close.
 */
describe("proving a factor again, in the browser", () => {
  it("opens the prompt without emailing anything", () => {
    const { result } = renderHook(() => useActionConfirmation());
    let handled = false;
    act(() => {
      handled = result.current.demanded(
        refusal("mfa_reprove_required"),
        "offer",
        () => {},
      );
    });
    expect(handled).toBe(true);
    expect(result.current.kind).toBe("reprove");
    // Their app makes the codes. There is nothing for us to send, which is also
    // why the dialog keeps Resend hidden for this kind.
    expect(requestCode).not.toHaveBeenCalled();
  });

  it("spends the digits on Supabase and retries with NO code", async () => {
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("mfa_reprove_required"),
        "close_workspace",
        retry,
      );
    });

    await act(async () => {
      result.current.confirm("123456");
    });

    // Challenged and verified against the account's own TOTP factor, in this
    // browser. That is what refreshes the session and stamps a new proof time.
    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    // THE ASSERTION THIS WHOLE FILE EXISTS FOR. One retry, carrying nothing.
    // `[["123456"]]` here is the infinite loop; `[]` is a dialog that swallowed
    // the confirmation.
    expect(retry.mock.calls).toEqual([[undefined]]);
  });

  it("still posts the digits to our API for the code we emailed", async () => {
    // The contrast case, and the only one there is: the emailed code is the single
    // thing our server has to check, because it is the one our server sent.
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "offer",
        retry,
      );
    });

    await act(async () => {
      result.current.confirm("123456");
    });

    expect(retry.mock.calls).toEqual([["123456"]]);
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("proves the enrolment wall at Supabase too, and retries with no code", async () => {
    // `mfa_challenge_required` says this session never presented a factor. That is a
    // property of the SESSION, and a code in a request body does not change it — the
    // route it would be posted to does not read one. Only a Supabase challenge lifts
    // the session, so these digits go where the reprove digits go.
    //
    // Unreachable from this dialog today, because the sign-in wall catches that code
    // before any screen sees it. Pinned anyway: the first fix for this issue declared
    // this path safe to post at, which is the same falsehood one kind earlier.
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(refusal("mfa_challenge_required"), "offer", retry);
    });

    await act(async () => {
      result.current.confirm("123456");
    });

    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    expect(retry.mock.calls).toEqual([[undefined]]);
  });

  it("asks the shared rule where the digits go, rather than deciding for itself", async () => {
    /**
     * THE DRIFT TEST. Every other assertion here would pass just as well if the hook
     * hard-coded a kind name, because the map happens to agree with those literals
     * today. So this moves the map underneath it: the EMAILED code — the one case whose
     * digits really are ours to check — is declared to belong to Supabase, and the hook
     * must send them there instead.
     *
     * Chosen deliberately as the direction no hard-coded literal could fake. It is not
     * describing a state production has; nothing flips this at runtime. It pins that
     * the rule lives in ONE place. Three clients answer this question, and the reason
     * an owner could not hand over their business was three answers.
     */
    const restore = destinations.email;
    destinations.email = "supabase";
    try {
      const retry = vi.fn();
      const { result } = renderHook(() => useActionConfirmation());
      act(() => {
        result.current.demanded(
          refusal("confirmation_code_required"),
          "offer",
          retry,
        );
      });

      await act(async () => {
        result.current.confirm("123456");
      });

      expect(challengeAndVerify).toHaveBeenCalledWith({
        factorId: FACTOR,
        code: "123456",
      });
      expect(retry.mock.calls).toEqual([[undefined]]);
    } finally {
      destinations.email = restore;
    }
  });

  it("reads a wrong six digits the same as a code we refused", async () => {
    challengeAndVerify.mockResolvedValue({
      data: null,
      error: new Error("invalid totp"),
    });
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(refusal("mfa_reprove_required"), "relax_mfa", retry);
    });

    await act(async () => {
      result.current.confirm("000000");
    });

    // Same complaint, same place, wherever the code was typed.
    expect(result.current.rejected).toBe(true);
    // And the dialog stays up, because the next code from the app will work.
    expect(result.current.kind).toBe("reprove");
    expect(retry).not.toHaveBeenCalled();
  });

  it("refuses out loud when there is no authenticator to challenge", async () => {
    // A factor removed on another device between the refusal and the submit. Left
    // unhandled this is a dialog that does nothing at all when pressed.
    listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("mfa_reprove_required"),
        "release_number",
        retry,
      );
    });

    await act(async () => {
      result.current.confirm("123456");
    });

    expect(result.current.rejected).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });

  it("will not open a second challenge while the first is in flight", async () => {
    let settle!: (value: unknown) => void;
    challengeAndVerify.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(refusal("mfa_reprove_required"), "accept", retry);
    });

    act(() => {
      result.current.confirm("123456");
    });
    // Every caller ORs this into the dialog's `pending`, so the Confirm button is
    // already disabled by the time the click handler returns.
    expect(result.current.requesting).toBe(true);

    // Let the factor lookup resolve, then press again.
    await act(async () => {});
    act(() => {
      result.current.confirm("123456");
    });
    // A second challenge would burn the same code against a new one and tell
    // somebody their correct digits were wrong.
    expect(challengeAndVerify).toHaveBeenCalledTimes(1);

    await act(async () => settle({ data: {}, error: null }));
    expect(retry.mock.calls).toEqual([[undefined]]);
    expect(result.current.requesting).toBe(false);
  });

  it("drops a verify that lands after the prompt was dismissed", async () => {
    let settle!: (value: unknown) => void;
    challengeAndVerify.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("mfa_reprove_required"),
        "close_workspace",
        retry,
      );
    });
    act(() => {
      result.current.confirm("123456");
    });
    await act(async () => {});

    act(() => result.current.dismiss());
    await act(async () => settle({ data: {}, error: null }));

    // The existing invariant — a dismissed prompt cannot still fire — and an await
    // must not be the way around it. Closing a workspace after the person backed
    // out is the one that cannot be undone.
    expect(retry).not.toHaveBeenCalled();
    expect(result.current.kind).toBeNull();
    // And nothing is left mid-submit: dismiss clears the flag the verify owns.
    expect(result.current.requesting).toBe(false);
  });
});
