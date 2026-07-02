import { redirect } from "next/navigation";

/**
 * Stripe Checkout return target. The API composes checkout sessions with
 * success_url `/dashboard?checkout=success` and cancel_url
 * `/dashboard?checkout=canceled` (apps/api/src/routes/billing.ts), so this
 * route maps those returns onto the onboarding surfaces:
 *
 * - success  → the realtime setting-up checklist (provisioning is triggered
 *              by the webhook, never by this redirect — SPEC §4.1 step 5)
 * - canceled → back to the plan step with a calm "nothing was charged" note
 * - anything else → the inbox
 */
export default async function DashboardRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  if (checkout === "success") redirect("/onboarding/setting-up?checkout=success");
  if (checkout === "canceled") redirect("/onboarding/plan?checkout=canceled");
  redirect("/inbox");
}
