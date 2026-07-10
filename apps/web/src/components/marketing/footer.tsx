import Link from "next/link";

import { LEGAL_ENTITY_NAME, MAILING_ADDRESS } from "@/lib/marketing/business";
import { LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * FOOTER (COPY-DECK v2 §F, DESIGN-DIRECTION v4 §4): the Dispatch Ink band,
 * "night outside the window", one of the site's two sanctioned dark
 * surfaces. White-at-70% links in four columns covering every route in the
 * coverage map (Product 7 · Who it's for 6 · Compare 2 · Company and legal
 * 10), the brand line, the conditional identity line, and the sign-off.
 * Server component, zero JS, shared by every marketing page.
 *
 * Law 1: no credits of any kind (no fonts, no framework, nothing about what
 * the site does or doesn't fake). Identity line renders ONLY when ops has
 * supplied the real legal entity and mailing address; until then, nothing
 * (never a placeholder sentence).
 */

interface FooterLinkItem {
  label: string;
  href: string;
}

/* Deck §F column inventories, verbatim order. */
const PRODUCT: FooterLinkItem[] = [
  { label: "Shared inbox", href: LIVE_ROUTES.featuresSharedInbox },
  { label: "Your business number", href: LIVE_ROUTES.featuresBusinessNumber },
  { label: "Compliance built in", href: LIVE_ROUTES.featuresCompliance },
  { label: "Templates and tags", href: LIVE_ROUTES.featuresTemplatesAndTags },
  { label: "Pricing", href: LIVE_ROUTES.pricing },
  { label: "Security", href: LIVE_ROUTES.security },
  { label: "Loonext in Canada", href: LIVE_ROUTES.canada },
];

const WHO_ITS_FOR: FooterLinkItem[] = [
  { label: "Plumbers", href: LIVE_ROUTES.forPlumbers },
  { label: "Landscapers", href: LIVE_ROUTES.forLandscapers },
  { label: "Cleaners", href: LIVE_ROUTES.forCleaners },
  { label: "HVAC", href: LIVE_ROUTES.forHvac },
  { label: "Salons", href: LIVE_ROUTES.forSalons },
  { label: "Contractors", href: LIVE_ROUTES.forContractors },
];

const COMPARE: FooterLinkItem[] = [
  { label: "Loonext vs Heymarket", href: LIVE_ROUTES.compareHeymarket },
  { label: "Loonext vs Quo", href: LIVE_ROUTES.compareQuo },
];

const COMPANY_AND_LEGAL: FooterLinkItem[] = [
  // #127: the blog joins the company column (the deck §F inventory predates
  // it; the nav bar stays deliberately lean, so the footer carries the link).
  { label: "Blog", href: LIVE_ROUTES.blog },
  { label: "Terms of service", href: LIVE_ROUTES.terms },
  { label: "Privacy policy", href: LIVE_ROUTES.privacy },
  { label: "Cookies", href: LIVE_ROUTES.cookies },
  { label: "Acceptable use", href: LIVE_ROUTES.aup },
  { label: "Fair use", href: LIVE_ROUTES.fairUse },
  { label: "SMS messaging policy", href: LIVE_ROUTES.messaging },
  { label: "Sub-processors", href: LIVE_ROUTES.subprocessors },
  { label: "30-day guarantee", href: LIVE_ROUTES.refunds },
  { label: "Security", href: LIVE_ROUTES.security },
  { label: "Status", href: LIVE_ROUTES.status },
  { label: "Contact us", href: LIVE_ROUTES.contact },
];

/* Footer CSS, prefix "frf-". ONE inert style block, unlayered so the base
   declarations beat Tailwind utilities. On the ink ground: links white at
   70%, hover white; focus = 2px white outline (cobalt vanishes on ink). The
   only transition (link color) is reduced-motion gated. */
const CSS = `
.frf-root {
  background-color: var(--fr-ink);
  color: #ffffff;
}
.frf-link {
  color: rgba(255, 255, 255, 0.7);
}
.frf-link:hover {
  color: #ffffff;
}
.frf-link:focus-visible,
.frf-mark:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
  border-radius: 2px;
}
@media (prefers-reduced-motion: no-preference) {
  .frf-link {
    transition: color 200ms ease-out;
  }
}
`;

function LinkList({ links }: { links: FooterLinkItem[] }) {
  return (
    <ul className="mt-4 space-y-2.5">
      {links.map((link) => (
        <li key={`${link.label}-${link.href}`}>
          <Link href={link.href} className="frf-link font-body-mkt text-sm">
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="fr-eyebrow text-white/55">
      {children}
    </h2>
  );
}

export function Footer() {
  const year = new Date().getFullYear();
  const hasIdentity = LEGAL_ENTITY_NAME !== null && MAILING_ADDRESS !== null;

  return (
    <footer className="frf-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mx-auto w-full max-w-[72rem] px-6 py-16 md:px-8 md:py-20">
        <div className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
          {/* Brand block: wordmark in Bricolage 800 + the deck brand line. */}
          <div className="lg:col-span-3">
            <Link
              href="/"
              aria-label="Loonext home"
              className="frf-mark font-display text-2xl font-extrabold tracking-tight text-white"
            >
              Loonext
            </Link>
            <p className="font-body-mkt mt-3 max-w-xs text-sm leading-relaxed text-white/70">
              The shared text inbox for your crew.
            </p>
          </div>

          <nav aria-label="Product" className="lg:col-span-3">
            <ColumnHeading>Product</ColumnHeading>
            <LinkList links={PRODUCT} />
          </nav>

          <nav aria-label="Who it's for" className="lg:col-span-2">
            <ColumnHeading>Who it&apos;s for</ColumnHeading>
            <LinkList links={WHO_ITS_FOR} />
          </nav>

          <nav aria-label="Compare" className="lg:col-span-2">
            <ColumnHeading>Compare</ColumnHeading>
            <LinkList links={COMPARE} />
          </nav>

          <nav aria-label="Company and legal" className="lg:col-span-2">
            <ColumnHeading>Company and legal</ColumnHeading>
            <LinkList links={COMPANY_AND_LEGAL} />
          </nav>
        </div>

        {/* Sign-off (deck §F). Identity line only when ops supplies it;
            until then, nothing renders (Law 1: never a placeholder). */}
        <div className="font-body-mkt mt-14 space-y-3 text-sm leading-relaxed">
          {hasIdentity ? (
            <p className="text-white/70">
              {LEGAL_ENTITY_NAME} · {MAILING_ADDRESS}
            </p>
          ) : null}
          <p className="text-white/70">Month to month. No sales calls, ever.</p>
          <p className="text-white/55">
            © {year} Loonext. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
