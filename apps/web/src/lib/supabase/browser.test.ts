/**
 * #581 — the attributes the Supabase auth cookies are actually written with.
 *
 * The value in these cookies is the serialized session (the refresh token), and
 * @supabase/ssr's defaults mark it `Path=/; SameSite=Lax` with no `Secure`. The
 * flag is not part of a cookie's identity, so ONE writer that omits it undoes
 * the others — which is why the options are a single shared object and why this
 * suite checks the server client from here as well as the browser one.
 *
 * @supabase/ssr is the boundary those options cross, so it is mocked: the real
 * factories reach the network and (in the browser case) `document`, and neither
 * says anything about what was passed in.
 */
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it, vi, type Mock } from "vitest";

/** Both @supabase/ssr factories, narrowed to the argument this suite reads. */
type ClientFactory = (
  url: string,
  key: string,
  options?: { cookieOptions?: Record<string, unknown> },
) => unknown;

/** What the browser client's `auth.getSession()` answers. */
interface SessionRead {
  data: { session: { access_token: string } | null };
  error: Error | null;
}

const { browserFactory, serverFactory, sessionRead } = vi.hoisted(() => {
  const sessionRead: { current: SessionRead } = {
    current: { data: { session: null }, error: null },
  };
  return {
    sessionRead,
    browserFactory: vi.fn<ClientFactory>(() => ({
      auth: { getSession: async () => sessionRead.current },
    })),
    serverFactory: vi.fn<ClientFactory>(() => ({})),
  };
});

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: browserFactory,
  createServerClient: serverFactory,
}));

// getSupabaseServer awaits next/headers `cookies()`, which throws outside a
// request. An empty jar is enough — this suite never reads a session.
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

import { getAccessToken, getSupabaseBrowser } from "./browser";
import { SUPABASE_COOKIE_OPTIONS } from "./cookie-options";
import { getSupabaseServer } from "./server";

/** The `cookieOptions` a mocked factory was constructed with. */
function cookieOptionsOf(
  factory: Mock<ClientFactory>,
): Record<string, unknown> | undefined {
  return factory.mock.calls[0]?.[2]?.cookieOptions;
}

describe("Supabase auth cookie options (#581)", () => {
  it("marks the browser client's session cookie Secure", () => {
    getSupabaseBrowser();
    expect(browserFactory).toHaveBeenCalledTimes(1);
    expect(cookieOptionsOf(browserFactory)?.secure).toBe(true);
  });

  it("marks the server client's session cookie Secure too", async () => {
    await getSupabaseServer();
    expect(serverFactory).toHaveBeenCalledTimes(1);
    expect(cookieOptionsOf(serverFactory)?.secure).toBe(true);
  });

  it("carries no maxAge and no name", () => {
    // Both are traps rather than tuning knobs: @supabase/ssr re-pins maxAge to
    // its own 400-day default after spreading ours (so a shorter lifetime here
    // is a comment, not a change), and `name` becomes the auth storageKey,
    // renaming the cookie and signing every live session out.
    expect(SUPABASE_COOKIE_OPTIONS.maxAge).toBeUndefined();
    expect("name" in SUPABASE_COOKIE_OPTIONS).toBe(false);
  });
});

describe("getAccessToken", () => {
  it("throws getSession()'s error when a refresh was lost to the network, so it is retried", async () => {
    const error = new AuthRetryableFetchError("Failed to fetch", 0);
    sessionRead.current = { data: { session: null }, error };
    await expect(getAccessToken()).rejects.toBe(error);

    // A refresh the server refused ends the session: that is a sign-out.
    sessionRead.current = {
      data: { session: null },
      error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found"),
    };
    await expect(getAccessToken()).resolves.toBeNull();

    sessionRead.current = {
      data: { session: { access_token: "access-1" } },
      error: null,
    };
    await expect(getAccessToken()).resolves.toBe("access-1");
  });
});
