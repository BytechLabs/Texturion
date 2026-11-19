import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const { verifyOtp } = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServer: async () => ({ auth: { verifyOtp } }),
}));

const ORIGIN = "https://app.loonext.test";
const INVITE_PATH = "/invite/25e4f67a-8a48-4e7f-a549-f0547ee4989e";

function confirm(type: string, next: string) {
  const query = new URLSearchParams({ type, next, token_hash: "test-token-hash" });
  return GET(new NextRequest(`${ORIGIN}/auth/confirm?${query}`));
}

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ data: { session: {} }, error: null });
});

describe("email link confirmation", () => {
  it("confirms a signup without a browser PKCE verifier and preserves the plan", async () => {
    const next = "/onboarding?plan=pro&modules=regions_ca";
    const result = await confirm("signup", `${ORIGIN}${next}`);
    expect(result.headers.get("location")).toBe(`${ORIGIN}${next}`);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: "test-token-hash",
      type: "signup",
    });
  });

  it("confirms an invite and redirects to its acceptance page", async () => {
    const result = await confirm("invite", INVITE_PATH);
    expect(result.headers.get("location")).toBe(`${ORIGIN}${INVITE_PATH}?setup=password`);
    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: "test-token-hash",
      type: "invite",
    });
  });

  it("retains the acceptance destination after an expired invite", async () => {
    verifyOtp.mockResolvedValue({ data: { session: null }, error: {} });
    const result = await confirm("invite", INVITE_PATH);
    const redirect = new URL(result.headers.get("location")!);
    expect(redirect.pathname).toBe("/login");
    expect(Object.fromEntries(redirect.searchParams)).toEqual({
      error: "verification",
      next: INVITE_PATH,
    });
  });

  it("ignores an external signup destination", async () => {
    const result = await confirm("signup", "https://elsewhere.test/onboarding");
    expect(result.headers.get("location")).toBe(`${ORIGIN}/onboarding`);
  });

  it("does not consume invite tokens with an unrelated destination", async () => {
    const result = await confirm("invite", "//elsewhere.test" + INVITE_PATH);
    expect(result.headers.get("location")).toBe(`${ORIGIN}/login?error=verification`);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
