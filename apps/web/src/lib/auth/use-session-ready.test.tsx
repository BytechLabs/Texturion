/**
 * @vitest-environment happy-dom
 *
 * The session state the app's gates read. The Supabase client is the boundary:
 * a fake that answers getSession() and hands back the auth listener.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthListener = (
  event: string,
  session: { user: { id: string } } | null,
) => void;

const { auth } = vi.hoisted(() => ({
  auth: {
    session: null as { user: { id: string } } | null,
    listener: null as AuthListener | null,
  },
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    auth: {
      getSession: async () => ({ data: { session: auth.session }, error: null }),
      onAuthStateChange: (cb: AuthListener) => {
        auth.listener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

import { useSession, whileEndingSessionHere } from "./use-session-ready";

beforeEach(() => {
  auth.session = { user: { id: "user-1" } };
  auth.listener = null;
});

afterEach(() => {
  cleanup();
});

describe("useSession", () => {
  it("is ready with the user's id once getSession() has one", async () => {
    const { result } = renderHook(() => useSession());
    await waitFor(() =>
      expect(result.current).toEqual({ state: "ready", userId: "user-1" }),
    );
  });

  it("settles signed-out at once on SIGNED_OUT, without waiting out the grace window", async () => {
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state).toBe("ready"));

    act(() => auth.listener?.("SIGNED_OUT", null));
    expect(result.current).toEqual({ state: "signed-out", userId: null });

    act(() => auth.listener?.("SIGNED_IN", { user: { id: "user-2" } }));
    expect(result.current).toEqual({ state: "ready", userId: "user-2" });
  });

  it("does not report this tab's own sign-out, which goes to /login itself", async () => {
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    const before = result.current;

    await act(async () => {
      const outcome = await whileEndingSessionHere(async () => {
        auth.listener?.("SIGNED_OUT", null);
        return { error: null };
      });
      expect(outcome).toEqual({ error: null });
    });
    expect(result.current).toBe(before);

    // A sign-out that arrives afterwards, from another tab, still ends it.
    act(() => auth.listener?.("SIGNED_OUT", null));
    expect(result.current).toEqual({ state: "signed-out", userId: null });
  });

  it("keeps the same value through a token refresh", async () => {
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    const before = result.current;

    act(() => auth.listener?.("TOKEN_REFRESHED", { user: { id: "user-1" } }));
    expect(result.current).toBe(before);
  });
});
