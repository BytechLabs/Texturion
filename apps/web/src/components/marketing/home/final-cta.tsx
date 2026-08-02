import Link from "next/link";

import { ConvergedField, CtaButton, FrSection } from "@/components/marketing/fr";
import { PRIMARY_CTA_LABEL, SIGNUP_HREF } from "@/components/marketing/nav-links";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import { LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * S12 · FINAL CTA (COPY-DECK v2): the ONE cobalt band on the site (Law 3 /
 * §2). Conversion job: close. One promise, one button, reassurance only,
 * nothing new.
 *
 * Backdrop: the STATIC converged Arrival Field derivative (currentColor
 * paths, no second canvas anywhere, Law 3). The primary CTA inverts on
 * the band: label-coloured pill, band-coloured text. Founder line ships
 * nameless until ops supplies real names (never invent); the security strip
 * links /security.
 *
 * #362 phase 8: every line here rides the band's own three-step label ramp
 * (`--fr-on-olive`, `-70`, `-55`) rather than white at four ad-hoc alphas. The
 * ramp inverts with the theme — paper-on-olive in light, ink-on-lime in dark —
 * so the hierarchy survives the flip that a literal white would not.
 */
export function FinalCta() {
  return (
    <FrSection ground="cobalt" id="start" className="relative overflow-hidden">
      <ConvergedField
        variant="backdrop"
        className="absolute inset-0 h-full w-full text-[color:var(--fr-on-olive)]"
      />

      <div className="relative mx-auto max-w-3xl text-center">
        <h2 className="fr-h2 text-[color:var(--fr-on-olive)]">
          One inbox for the whole crew. No strings attached.
        </h2>
        <p className="fr-body mt-5 text-[color:var(--fr-on-olive-70)]">
          See the price, pay, and start answering customers today, with a full refund in
          your first 30 days if it&apos;s not for you. Month to month, the
          whole time.
        </p>

        <div className="mt-8">
          <CtaButton href={SIGNUP_HREF} variant="on-cobalt" size="lg">
            {PRIMARY_CTA_LABEL}
          </CtaButton>
        </div>
        {/* #328: the closing reassurance line is the last figure on the page,
            and a price stated at the moment of the decision is the worst one to
            state in the wrong currency. */}
        <p className="fr-eyebrow mt-5 text-[color:var(--fr-on-olive-70)]">
          <PlanPrice plan="starter" />
          /MO FLAT · MONTH TO MONTH · 30-DAY MONEY-BACK
        </p>

        <p className="font-body-mkt mx-auto mt-12 max-w-[62ch] text-[15px] leading-[1.7] text-[color:var(--fr-on-olive-70)]">
          We built Loonext because we watched small shops run the whole
          business off one person&apos;s cell. No sales team, no investors
          leaning on us to upsell you.{" "}
          <Link
            href={LIVE_ROUTES.contact}
            className="font-semibold text-[color:var(--fr-on-olive)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-on-olive)]"
          >
            Email us anytime
          </Link>
          ; we answer.
        </p>

        <p className="font-body-mkt mx-auto mt-6 max-w-[62ch] text-[13px] leading-[1.7] text-[color:var(--fr-on-olive-55)]">
          Your data is encrypted in transit and at rest, we keep message
          content out of our analytics and error logs, and it&apos;s stored in
          the United States. The details are on our{" "}
          <Link
            href={LIVE_ROUTES.security}
            className="text-[color:var(--fr-on-olive-70)] underline underline-offset-4 hover:text-[color:var(--fr-on-olive)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-on-olive)]"
          >
            security page
          </Link>
          .
        </p>
      </div>
    </FrSection>
  );
}
