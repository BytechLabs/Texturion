import Link from "next/link";

import { businessIdentityLine } from "@/lib/marketing/business";

import { Container } from "./ui/container";
import { FOOTER_COLUMNS } from "./footer-links";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

/**
 * Marketing footer (BLUEPRINT §12, COPY §F): four link columns + a brand block
 * carrying the one-line restatement, the legal-identity line, the honesty
 * "Made in Canada" note, the sign-off, copyright, and the theme toggle. Every
 * link resolves this iteration (footer-links.ts). No phone, no chat widget (§12).
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background">
      <Container className="py-12 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          {/* Brand block */}
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-3 text-sm text-muted-foreground">
              JobText — the shared text inbox for your crew.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Made in Canada{" "}
              <span aria-hidden="true">🇨🇦</span>
              <span className="sr-only">Canadian flag</span>. Your data is
              processed in the United States — we say where plainly on our
              privacy page.
            </p>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="text-xs font-semibold text-foreground">
                {col.heading}
              </h2>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
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
        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium text-foreground/90">
              Month to month. No sales calls, ever.
            </p>
            <p>{businessIdentityLine()}</p>
            <p>© {year} JobText. All rights reserved.</p>
          </div>
          <ThemeToggle />
        </div>
      </Container>
    </footer>
  );
}
