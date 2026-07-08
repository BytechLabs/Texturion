import { describe, expect, it, vi } from "vitest";

// next/navigation.redirect throws a special control-flow error in the real
// runtime; here we record the target and throw so the function stops, exactly
// like the framework does.
const redirected = vi.fn<(url: string) => never>(() => {
  throw new Error("NEXT_REDIRECT");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirected(url),
}));

import DashboardRedirectPage from "./page";

async function run(
  params: { checkout?: string; session_id?: string },
): Promise<string> {
  redirected.mockClear();
  await DashboardRedirectPage({
    searchParams: Promise.resolve(params),
  }).catch(() => {});
  expect(redirected).toHaveBeenCalledTimes(1);
  return redirected.mock.calls[0]![0];
}

/**
 * /dashboard is a legacy Stripe Checkout return alias (finding 3). The live
 * success_url now lands on /onboarding/setting-up directly; this route only
 * catches stale/bookmarked old-format returns and must forward them WITHOUT
 * dropping the session id the setting-up poller confirms payment against.
 */
describe("/dashboard legacy checkout redirect", () => {
  it("forwards a success return to setting-up, preserving the Stripe session id", async () => {
    const target = await run({ checkout: "success", session_id: "cs_test_123" });
    expect(target).toBe(
      "/onboarding/setting-up?checkout=success&session_id=cs_test_123",
    );
  });

  it("URL-encodes a session id that carries reserved characters", async () => {
    const target = await run({ checkout: "success", session_id: "cs/test 123" });
    expect(target).toBe(
      "/onboarding/setting-up?checkout=success&session_id=cs%2Ftest+123",
    );
  });

  it("still sends success to setting-up when no session id is present", async () => {
    const target = await run({ checkout: "success" });
    expect(target).toBe("/onboarding/setting-up?checkout=success");
  });

  it("routes a canceled return back to the plan step with a calm note", async () => {
    const target = await run({ checkout: "canceled" });
    expect(target).toBe("/onboarding/plan?checkout=canceled");
  });

  it("sends a bare/legacy-bookmark visit to the app home, not a broken page", async () => {
    expect(await run({})).toBe("/for-you");
    expect(await run({ checkout: "other" })).toBe("/for-you");
  });

  it("never routes back to /dashboard (the old success_url is gone)", async () => {
    for (const params of [
      { checkout: "success", session_id: "cs_1" },
      { checkout: "canceled" },
      {},
    ]) {
      expect(await run(params)).not.toContain("/dashboard");
    }
  });
});
