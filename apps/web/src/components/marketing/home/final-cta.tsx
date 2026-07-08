import Link from "next/link";

import { ConvergedField, CtaButton, FrSection } from "@/components/marketing/fr";
import { PRIMARY_CTA_LABEL, SIGNUP_HREF } from "@/components/marketing/nav-links";
import { LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * S12 · FINAL CTA (COPY-DECK v2): the ONE cobalt band on the site (Law 3 /
 * §2). Conversion job: close. One promise, one button, reassurance only,
 * nothing new.
 *
 * Backdrop: the STATIC converged Arrival Field derivative (currentColor
 * paths, no second canvas anywhere, Law 3). The primary CTA inverts on
 * cobalt: white pill, ink text. Founder line ships nameless until ops
 * supplies real names (never invent); the security strip links /security.
 */
export function FinalCta() {
  return (
    <FrSection ground="cobalt" id="start" className="relative overflow-hidden">
      <ConvergedField
        variant="backdrop"
        className="absolute inset-0 h-full w-full text-white"
      />

      <div className="relative mx-auto max-w-3xl text-center">
        <h2 className="fr-h2 text-white">
          One number for the whole crew. No strings attached.
        </h2>
        <p className="fr-body mt-5 text-white/80">
          See the price, pay, and start texting today, with a full refund in
          your first 30 days if it&apos;s not for you. Month to month, the
          whole time.
        </p>

        <div className="mt-8">
          <CtaButton href={SIGNUP_HREF} variant="on-cobalt" size="lg">
            {PRIMARY_CTA_LABEL}
          </CtaButton>
        </div>
        <p className="fr-eyebrow mt-5 text-white/70">
          $29/MO FLAT · MONTH TO MONTH · 30-DAY MONEY-BACK
        </p>

        <p className="font-body-mkt mx-auto mt-12 max-w-[62ch] text-[15px] leading-[1.7] text-white/80">
          We built Loonext because we watched small shops run the whole
          business off one person&apos;s cell. No sales team, no investors
          leaning on us to upsell you.{" "}
          <Link
            href={LIVE_ROUTES.contact}
            className="font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Email us anytime
          </Link>
          ; a real person answers.
        </p>

        <p className="font-body-mkt mx-auto mt-6 max-w-[62ch] text-[13px] leading-[1.7] text-white/60">
          Your data is encrypted in transit and at rest, we keep message
          content out of our analytics and error logs, and it&apos;s stored in
          the United States. The details are on our{" "}
          <Link
            href={LIVE_ROUTES.security}
            className="text-white/80 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            security page
          </Link>
          .
        </p>
      </div>
    </FrSection>
  );
}
