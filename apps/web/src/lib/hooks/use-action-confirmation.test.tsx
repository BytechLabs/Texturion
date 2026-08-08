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

import { ApiError } from "@/lib/api/error";

import { useActionConfirmation } from "./use-action-confirmation";

afterEach(cleanup);
beforeEach(() => requestCode.mockClear());

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
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "close_workspace",
        () => {},
      );
    });
    expect(result.current.rejected).toBe(false);

    // The retry was refused too.
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "close_workspace",
        () => {},
      );
    });
    expect(result.current.rejected).toBe(true);
    expect(result.current.kind).toBe("email");
    // And NO second code was minted behind the person still looking at the first.
    expect(requestCode).toHaveBeenCalledTimes(1);
  });

  it("mints a new one only when asked", () => {
    const { result } = renderHook(() => useActionConfirmation());
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "release_number",
        () => {},
      );
    });
    act(() => {
      result.current.demanded(
        refusal("confirmation_code_required"),
        "release_number",
        () => {},
      );
    });
    expect(result.current.rejected).toBe(true);

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
