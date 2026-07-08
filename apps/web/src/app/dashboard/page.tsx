import { redirect } from "next/navigation";

/**
 * Legacy Stripe Checkout return alias. The live checkout session now sends the
 * browser DIRECTLY to /onboarding/setting-up (success) and /onboarding/plan
 * (cancel) — success_url is
 * `/onboarding/setting-up?checkout=success&session_id={CHECKOUT_SESSION_ID}`
 * (apps/api/src/routes/billing.ts, createCheckoutSession), so no new traffic is
 * routed through /dashboard.
 *
 * This route survives only to catch a stale or bookmarked old-format return
 * (`/dashboard?checkout=success&session_id=…`) and forward it onto the real
 * surfaces WITH the Stripe session id intact — the setting-up poller confirms
 * payment against that id, so it must never be dropped. Any other visit is a
 * legacy bookmark and lands on the app home.
 */
export default async function DashboardRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const { checkout, session_id } = await searchParams;
  if (checkout === "success") {
    const query = new URLSearchParams({ checkout: "success" });
    if (session_id) query.set("session_id", session_id);
    redirect(`/onboarding/setting-up?${query.toString()}`);
  }
  if (checkout === "canceled") redirect("/onboarding/plan?checkout=canceled");
  redirect("/for-you");
}
