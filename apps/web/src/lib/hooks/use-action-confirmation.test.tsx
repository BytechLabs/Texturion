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
/**
 * `isPending` is a live field, not the literal `false` this stub used to hand back.
 *
 * `requesting` is an OR of two things — a code being emailed, and a factor being
 * proved — and every caller feeds it straight into the dialog's `pending`. A stub that
 * can never be pending leaves the emailing half of that OR unreachable from any test,
 * which is exactly the half that has to disable Confirm while a code is being minted.
 */
// Hoisted for the same reason as the destination map below: the factory reads it the
// moment `@/lib/api/ownership` is first imported.
const { codeRequest } = vi.hoisted(() => ({ codeRequest: { isPending: false } }));
vi.mock("@/lib/api/ownership", () => ({
  useRequestHandoverCode: () => ({
    isPending: codeRequest.isPending,
    mutate: requestCode,
  }),
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
  codeRequest.isPending = false;
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
    // For the action being confirmed, not merely one more of something. Counting
    // the calls and not reading them left the argument free: a code minted against
    // a different action is scoped to that action on our side, so it comes back
    // refused every time — on the one button offered as the way out of a refusal.
    expect(requestCode).toHaveBeenLastCalledWith("release_number");
    // Asking for another clears the complaint about the last one.
    expect(result.current.rejected).toBe(false);
  });

  it("answers the newest demand, not the one the dialog opened for", () => {
    /**
     * Two irreversible actions refused one after the other, with nothing dismissed
     * in between — the second while the first was still on screen.
     *
     * The hook keeps ONE held demand, so the digits settle the newest one. Nothing
     * pinned that until now, and every part of it is separately reversible: retrying
     * the older call would close the workspace for somebody who had moved on to
     * releasing a number, and Resend would mint a code against an action nobody is
     * confirming.
     */
    const closing = vi.fn();
    const releasing = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    const gate = result.current;
    act(() => {
      gate.demanded(
        refusal("confirmation_code_required"),
        "close_workspace",
        closing,
      );
    });
    expect(requestCode).toHaveBeenLastCalledWith("close_workspace");

    // Same stale `gate`, as a component has. Already open, so nothing new is minted
    // on its own — but what is held has changed underneath.
    act(() => {
      gate.demanded(
        refusal("confirmation_code_required"),
        "release_number",
        releasing,
      );
    });
    expect(requestCode).toHaveBeenCalledTimes(1);

    act(() => result.current.resend());
    expect(requestCode).toHaveBeenLastCalledWith("release_number");

    act(() => result.current.confirm("123456"));
    expect(releasing.mock.calls).toEqual([["123456"]]);
    expect(closing).not.toHaveBeenCalled();
  });

  it("mints nothing once the prompt has been put away", () => {
    // Resend is only reachable from inside the dialog, so this is the closed one:
    // an in-flight press landing after the dialog went away. It has to be a no-op
    // rather than a code minted against an action nobody is confirming — that code
    // is charged for, lands in somebody's inbox unexplained, and invalidates the
    // one before it.
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "release_number",
        () => {},
      );
    });
    expect(requestCode).toHaveBeenCalledTimes(1);

    act(() => result.current.dismiss());
    act(() => result.current.resend());
    expect(requestCode).toHaveBeenCalledTimes(1);
  });

  it("reports itself busy while our server is still minting the emailed code", () => {
    /**
     * The OTHER half of `requesting`.
     *
     * Every caller ORs this into the dialog's `pending`, and the verify half is
     * pinned all through the section below. This is the half nothing reached while
     * the stub could only ever say `isPending: false`: the seconds between the
     * dialog opening and the code existing. Confirm live in that window is a
     * guaranteed refusal — there is nothing yet for the digits to match — spending
     * one of the five attempts on a code our own server had not finished sending.
     */
    codeRequest.isPending = true;
    const { result, rerender } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "offer",
        () => {},
      );
    });
    expect(result.current.kind).toBe("email");
    expect(result.current.requesting).toBe(true);

    // And it goes quiet again once the code is on its way.
    codeRequest.isPending = false;
    rerender();
    expect(result.current.requesting).toBe(false);
  });

  it("closes on dismiss, and forgets the action with it", () => {
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    const gate = result.current;
    act(() => {
      gate.demanded(refusal("confirmation_code_required"), "offer", retry);
    });
    // Refuse a code first, so `rejected` is genuinely true going into the dismiss.
    // Asserting it false afterwards proved nothing while it had never been true:
    // dismiss could stop clearing it altogether and this test still passed.
    act(() => {
      gate.demanded(refusal("confirmation_code_required"), "offer", retry);
    });
    expect(result.current.rejected).toBe(true);

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

  it("follows the server when the second refusal asks for something else", async () => {
    /**
     * The kind is not decided once when the dialog opens.
     *
     * The emailed code was right, but by the time it was found and typed the
     * session's last proof had aged past the five-minute window, so the retry came
     * back asking for the factor instead. Every other test here opens a prompt and
     * keeps it; nothing pinned that a SECOND refusal can change what is being asked
     * for. Holding the first kind would send the next six digits to our API, which
     * is not checking a code on that path — the identical refusal comes back every
     * time, and the workspace can never be closed from this screen again.
     */
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    const gate = result.current;
    act(() => {
      gate.demanded(
        refusal("confirmation_code_required"),
        "close_workspace",
        retry,
      );
    });
    expect(result.current.kind).toBe("email");

    act(() => {
      gate.demanded(refusal("mfa_reprove_required"), "close_workspace", retry);
    });
    expect(result.current.kind).toBe("reprove");

    await act(async () => {
      result.current.confirm("123456");
    });

    // Followed all the way to the destination, not just in the copy: the digits
    // go to Supabase and the action is retried carrying nothing.
    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    expect(retry.mock.calls).toEqual([[undefined]]);
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

  it("clears the last complaint the moment new digits are submitted", async () => {
    // The refusal belongs to the code that earned it. A TOTP code expires every
    // thirty seconds, so the second attempt here is the normal one, not the
    // exception — and leaving "that code didn't work" on screen over digits nobody
    // has judged yet reads as a verdict on the new ones.
    const pending: Array<(value: unknown) => void> = [];
    challengeAndVerify
      .mockResolvedValueOnce({ data: null, error: new Error("invalid totp") })
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            pending.push(resolve);
          }),
      );
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(refusal("mfa_reprove_required"), "offer", retry);
    });

    await act(async () => {
      result.current.confirm("000000");
    });
    expect(result.current.rejected).toBe(true);

    // They read the next code off the app and press Confirm again.
    await act(async () => {
      result.current.confirm("111111");
    });
    expect(pending).toHaveLength(1);
    expect(result.current.rejected).toBe(false);

    await act(async () => pending[0]({ data: {}, error: null }));
    expect(retry.mock.calls).toEqual([[undefined]]);
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

    // Let the factor lookup resolve, then press again — and let THAT press get as
    // far as it is going to get before looking. Asserting the moment the handler
    // returned, as this test used to, only proved a second challenge had not been
    // opened YET: the second press is asynchronous too, and its own factor lookup
    // had not resolved at the point the count was read. The guard could be deleted
    // outright and this still passed.
    await act(async () => {});
    await act(async () => {
      result.current.confirm("123456");
    });
    // A second challenge would burn the same code against a new one and tell
    // somebody their correct digits were wrong.
    expect(listFactors).toHaveBeenCalledTimes(1);
    expect(challengeAndVerify).toHaveBeenCalledTimes(1);

    await act(async () => settle({ data: {}, error: null }));
    expect(retry.mock.calls).toEqual([[undefined]]);
    expect(result.current.requesting).toBe(false);
  });

  it("refuses a second submit fired in the SAME tick as the first", async () => {
    /**
     * The case `requesting` cannot cover, and the reason the ref exists at all.
     *
     * `verifying` is React state: it is set during the first submit and readable on
     * the NEXT render. A double-click, or Enter landing on top of a click, runs both
     * handlers out of one render against one hook object — so the second handler
     * reads the same `requesting: false` the first one did, and every caller's
     * disabled-button defence is a render too late. Only the ref, written
     * synchronously, is current inside that tick.
     *
     * Two challenges here means the first burns the code and the second is told the
     * digits are wrong — somebody's own correct code, refused, because they pressed
     * twice.
     */
    const pending: Array<(value: unknown) => void> = [];
    challengeAndVerify.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
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

    // ONE hook object for both presses, which is what a component has: React has not
    // re-rendered between the two handlers, so neither can see the other's state.
    const gate = result.current;
    await act(async () => {
      gate.confirm("123456");
      gate.confirm("123456");
    });

    // Refused before it reached Supabase at all — not merely deduplicated after.
    expect(listFactors).toHaveBeenCalledTimes(1);
    expect(challengeAndVerify).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);

    await act(async () => pending[0]({ data: {}, error: null }));
    // And the action still runs exactly once, carrying nothing.
    expect(retry.mock.calls).toEqual([[undefined]]);
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

  /**
   * Backing out and being asked again — the case dismissing alone does not reach.
   *
   * The test above proves an abandoned verify does not fire into an EMPTY screen,
   * and it passes just as well if the check were "is anything in flight" rather than
   * "is THIS one still the one", because dismiss leaves nothing in flight. What tells
   * those two apart is a second prompt opened behind the first: the abandoned verify
   * now lands while something else is genuinely in flight, and everything it touches
   * belongs to a different action.
   */
  async function abandonThenAskAgain(pending: Array<(value: unknown) => void>) {
    challengeAndVerify.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(() => useActionConfirmation());
    const { result } = hook;
    act(() => {
      result.current.demanded(
        refusal("mfa_reprove_required"),
        "close_workspace",
        first,
      );
    });
    act(() => {
      result.current.confirm("111111");
    });
    await act(async () => {});
    act(() => result.current.dismiss());
    return { hook, first, second };
  }

  it("does not blame a fresh prompt for a verify abandoned before it", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { hook, first, second } = await abandonThenAskAgain(pending);
    const { result } = hook;

    // They backed out, then tried something else and were asked again.
    act(() => {
      result.current.demanded(
        refusal("mfa_reprove_required"),
        "release_number",
        second,
      );
    });
    expect(result.current.rejected).toBe(false);

    // Now the challenge they walked away from comes back refused.
    await act(async () =>
      pending[0]({ data: null, error: new Error("invalid totp") }),
    );

    // The new prompt must not open already accusing them of a wrong code. It is the
    // same six-word complaint either way, so nothing on screen would say which
    // submission it was about — and there has not been one yet.
    expect(result.current.rejected).toBe(false);
    expect(result.current.kind).toBe("reprove");
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("lets an abandoned verify finish without disarming the one that replaced it", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const { hook, first, second } = await abandonThenAskAgain(pending);
    const { result } = hook;

    // A different action, refused, answered — a second challenge is genuinely open.
    act(() => {
      result.current.demanded(
        refusal("mfa_reprove_required"),
        "release_number",
        second,
      );
    });
    await act(async () => {
      result.current.confirm("222222");
    });
    expect(pending).toHaveLength(2);
    expect(result.current.requesting).toBe(true);

    // The FIRST challenge, long abandoned, now succeeds.
    await act(async () => pending[0]({ data: {}, error: null }));

    // It does not fire the call it was holding. Closing the workspace, once the
    // person backed out of closing the workspace and went to release a number.
    expect(first).not.toHaveBeenCalled();
    // And it does not clear the flag belonging to the verify that replaced it —
    // which would report the dialog idle while Supabase is still deciding, and
    // re-arm the double submit the ref exists to refuse.
    expect(result.current.requesting).toBe(true);
    const gate = result.current;
    await act(async () => {
      gate.confirm("222222");
    });
    expect(challengeAndVerify).toHaveBeenCalledTimes(2);

    await act(async () => pending[1]({ data: {}, error: null }));
    expect(second.mock.calls).toEqual([[undefined]]);
    expect(result.current.requesting).toBe(false);
  });
});

/**
 * The code as it arrives out of an email client, and the one place it is cleaned.
 *
 * `isHandoverCode` trims before it decides whether Confirm is enabled, so a paste
 * carrying a leading or trailing space gets all the way to being submitted — the
 * button looked live because the digits under the whitespace were valid. From there
 * the two destinations disagree unless the trim happens ONCE, above the fork, and the
 * fix that made it happen once had nothing holding it in place.
 *
 * Both legs are pinned because both can regress, and only one of them announces it.
 */
describe("a code pasted with the whitespace still on it", () => {
  it("reaches Supabase trimmed", async () => {
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(refusal("mfa_reprove_required"), "offer", retry);
    });

    await act(async () => {
      result.current.confirm("  123456  ");
    });

    // Supabase compares the string it is handed against the generated digits, so
    // " 123456 " is simply not the code. The failure would surface as the same flat
    // "that didn't work" every other wrong code gets — indistinguishable, from the
    // outside, from an authenticator whose clock has drifted.
    expect(challengeAndVerify).toHaveBeenCalledWith({
      factorId: FACTOR,
      code: "123456",
    });
    expect(retry.mock.calls).toEqual([[undefined]]);
  });

  it("reaches our API trimmed too — the leg that regressed", async () => {
    // THE ONE THE COMMENT IS ABOUT. Only the Supabase branch used to clean the code
    // up, so this leg posted the padded string. Our own server hashes what it is
    // given: a correct code came back "that code didn't work", and it spent one of
    // the five attempts to say so. Five pastes out of the same email and the code is
    // burnt — with no way to tell that the space was the problem.
    const retry = vi.fn();
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "close_workspace",
        retry,
      );
    });

    await act(async () => {
      result.current.confirm(" 123456\n");
    });

    expect(retry.mock.calls).toEqual([["123456"]]);
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });
});
