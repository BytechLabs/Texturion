import Link from "next/link";

import { businessIdentityLine } from "@/lib/marketing/business";

import { Container } from "./ui/container";
import { FOOTER_COLUMNS } from "./footer-links";
import { Wordmark } from "./wordmark";

/**
 * Marketing footer (BLUEPRINT §12, COPY §F, VISUALS §5b): a designed, branded
 * footer, not a raw sitemap. A brand block (wordmark mark + one-line statement +
 * a "Made in Canada 🇨🇦" badge), five tidy grouped columns with adequate spacing
 * (Product / For trades / Compare / Company / Legal), then an identity row with
 * the honest sign-off, the legal-identity line (honest "pending" placeholder
 * until ops supplies it), and copyright. Every link resolves this iteration
 * (footer-links.ts). No phone, no chat widget (§12).
 *
 * No theme toggle: the marketing surface is a LIGHT painted-panel identity
 * (DESIGN-DIRECTION §3) with no dark mode, so a System/Light/Dark control here
 * would set `<html>.dark` without changing the (force-light) marketing pages, a
 * control that doesn't do what it says. Theme lives in the signed-in app's
 * Profile settings (DESIGN G8), where it applies.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-y-10 gap-x-8 md:grid-cols-2 lg:grid-cols-[1.6fr_repeat(5,1fr)]">
          {/* Brand block */}
          <div className="max-w-xs md:col-span-2 lg:col-span-1">
            <Wordmark />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              The shared text inbox for your crew, one local number, one inbox
              everyone can see, one flat price.
            </p>
            <p className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[13px] font-medium text-foreground/90">
              <span aria-hidden="true">🇨🇦</span>
              Made in Canada
              <span className="sr-only">(Canada)</span>
            </p>
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              Your data is processed in the United States, we say where plainly
              on our{" "}
              <Link
                href="/legal/privacy"
                className="text-foreground/80 underline underline-offset-2 hover:text-foreground"
              >
                privacy page
              </Link>
              .
            </p>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="text-xs font-semibold tracking-wide text-foreground uppercase">
                {col.heading}
              </h2>
              <ul className="mt-3.5 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Identity + sign-off row */}
        <div className="mt-12 flex flex-col gap-5 border-t border-border pt-8 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium text-foreground/90">
              Month to month. No sales calls, ever.
            </p>
            <p>{businessIdentityLine()}</p>
            <p>© {year} JobText. All rights reserved.</p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
