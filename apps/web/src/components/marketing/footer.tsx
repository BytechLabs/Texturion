import Link from "next/link";

import { businessIdentityLine, SUPPORT_EMAIL } from "@/lib/marketing/business";
import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";

import { Container } from "./ui/container";

/**
 * S8 — Footer ("Quiet daylight" v3 spec §6 S8, copy deck S8). Light ground
 * (the scope's porcelain paper), one hairline top rule, the existing
 * columns/links, --day-ink headings, --ink-55 body, petrol link hovers, the
 * honesty fine print at FULL neighbor size (it is never smaller than the
 * text around it), and the colophon verbatim. Body face throughout (v3 §3:
 * mono is figures-only). Server component, zero JS, shared by every
 * marketing page.
 *
 * ROUTE PRESERVATION (task rule: do not drop routes, do not invent routes):
 * every href the previous footer carried survives, remapped into the copy
 * deck's three columns. The deck's Product / Company / Legal headings hold;
 * the old "For trades" and "Compare" groups live on as quiet sub-lists inside
 * the Product column so their ten routes keep a home. "Support" resolves to
 * the ops-owned SUPPORT_EMAIL (business.ts, the one support channel), never an
 * invented /support route. "FAQ" anchors to the S6.5 FAQ section (/#faq).
 */

interface FooterLinkItem {
  label: string;
  href: string;
}

/* Copy deck order first (Pricing · Start · FAQ), then the preserved product
   routes from the old footer inventory. */
const PRODUCT: FooterLinkItem[] = [
  { label: "Pricing", href: LIVE_ROUTES.pricing },
  { label: "Start", href: APP_LINKS.signup },
  { label: "FAQ", href: "/#faq" },
  { label: "Shared inbox", href: LIVE_ROUTES.featuresSharedInbox },
  { label: "Your business number", href: LIVE_ROUTES.featuresBusinessNumber },
  { label: "Compliance built in", href: LIVE_ROUTES.featuresCompliance },
  { label: "Templates & tags", href: LIVE_ROUTES.featuresTemplatesAndTags },
  { label: "JobText in Canada", href: LIVE_ROUTES.canada },
];

const TRADES: FooterLinkItem[] = [
  { label: "Plumbers", href: LIVE_ROUTES.forPlumbers },
  { label: "Landscapers", href: LIVE_ROUTES.forLandscapers },
  { label: "Cleaners", href: LIVE_ROUTES.forCleaners },
  { label: "HVAC", href: LIVE_ROUTES.forHvac },
  { label: "Salons", href: LIVE_ROUTES.forSalons },
  { label: "Contractors", href: LIVE_ROUTES.forContractors },
];

const COMPARE: FooterLinkItem[] = [
  { label: "All comparisons", href: LIVE_ROUTES.compareIndex },
  { label: "JobText vs Podium", href: LIVE_ROUTES.comparePodium },
  { label: "JobText vs Heymarket", href: LIVE_ROUTES.compareHeymarket },
  { label: "JobText vs Quo", href: LIVE_ROUTES.compareQuo },
];

const COMPANY: FooterLinkItem[] = [
  { label: "Support", href: `mailto:${SUPPORT_EMAIL}` },
  { label: "Contact", href: LIVE_ROUTES.contact },
  { label: "Status", href: LIVE_ROUTES.status },
  { label: "Security", href: LIVE_ROUTES.security },
];

const LEGAL: FooterLinkItem[] = [
  { label: "Terms of service", href: LIVE_ROUTES.terms },
  { label: "Privacy policy", href: LIVE_ROUTES.privacy },
  { label: "Acceptable use", href: LIVE_ROUTES.aup },
  { label: "SMS messaging policy", href: LIVE_ROUTES.messaging },
  { label: "Sub-processors", href: LIVE_ROUTES.subprocessors },
  { label: "30-day guarantee", href: LIVE_ROUTES.refunds },
];

/* Footer CSS, prefix "nxft-". ONE inert style block (ledger-css pattern),
   unlayered so the base declarations beat Tailwind utilities. The only
   transition (link color) is reduced-motion gated; without it the hover
   still swaps, just instantly. */
const CSS = `
.nxft-root {
  border-top: 1px solid var(--rule-light);
}
/* Links: --ink-55 at rest, petrol on hover (the accent that means "link" in
   v3); light-ground focus = 2px petrol outline, 2px offset. */
.nxft-link {
  color: var(--ink-55);
}
.nxft-link:hover {
  color: var(--petrol);
}
.nxft-link:focus-visible,
.nxft-mark:focus-visible {
  outline: 2px solid var(--petrol);
  outline-offset: 2px;
  border-radius: 2px;
}
.nxft-fine {
  border-top: 1px solid var(--rule-light);
}
@media (prefers-reduced-motion: no-preference) {
  .nxft-link {
    transition: color 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
}
`;

/** Footer link; internal routes go through next/link, mailto stays <a>. */
function FooterLink({ label, href }: FooterLinkItem) {
  const cls = "nxft-link font-body-mkt text-sm";
  return href.startsWith("/") ? (
    <Link href={href} className={cls}>
      {label}
    </Link>
  ) : (
    <a href={href} className={cls}>
      {label}
    </a>
  );
}

function LinkList({ links }: { links: FooterLinkItem[] }) {
  return (
    <ul className="mt-3.5 space-y-2.5">
      {links.map((link) => (
        <li key={link.label}>
          <FooterLink {...link} />
        </li>
      ))}
    </ul>
  );
}

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="nxft-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <Container className="py-14 sm:py-16">
        <div className="grid gap-x-8 gap-y-10 lg:grid-cols-12">
          {/* Brand block: wordmark in Besley 700 (v3 §3) + the deck tagline. */}
          <div className="lg:col-span-3">
            <Link
              href="/"
              aria-label="JobText home"
              className="nxft-mark font-display text-2xl font-bold tracking-tight text-[color:var(--day-ink)]"
            >
              JobText
            </Link>
            <p className="font-body-mkt mt-3 max-w-xs text-sm leading-relaxed text-[color:var(--ink-55)]">
              The shared text inbox for small service crews.
            </p>
          </div>

          {/* Product column, with the preserved trade + comparison routes as
              quiet sub-lists (their labels are the old footer's headings, not
              new copy). */}
          <nav aria-label="Product" className="lg:col-span-5">
            <h2 className="font-body-mkt text-[0.8125rem] font-semibold text-[color:var(--day-ink)]">
              Product
            </h2>
            <div className="mt-0 grid gap-x-8 gap-y-8 sm:grid-cols-2">
              <LinkList links={PRODUCT} />
              <div className="space-y-7 sm:mt-3.5">
                <div>
                  <h3 className="font-body-mkt text-xs font-semibold text-[color:var(--ink-55)]">
                    For trades
                  </h3>
                  <LinkList links={TRADES} />
                </div>
                <div>
                  <h3 className="font-body-mkt text-xs font-semibold text-[color:var(--ink-55)]">
                    Compare
                  </h3>
                  <LinkList links={COMPARE} />
                </div>
              </div>
            </div>
          </nav>

          <nav aria-label="Company" className="lg:col-span-2">
            <h2 className="font-body-mkt text-[0.8125rem] font-semibold text-[color:var(--day-ink)]">
              Company
            </h2>
            <LinkList links={COMPANY} />
          </nav>

          <nav aria-label="Legal" className="lg:col-span-2">
            <h2 className="font-body-mkt text-[0.8125rem] font-semibold text-[color:var(--day-ink)]">
              Legal
            </h2>
            <LinkList links={LEGAL} />
          </nav>
        </div>

        {/* Fine print. Every line the SAME text-sm: the honesty print may
            never render smaller than its neighbors, so nothing here gets a
            smaller size to hide behind. */}
        <div className="nxft-fine font-body-mkt mt-12 space-y-3 pt-8 text-sm leading-relaxed">
          <p className="text-[color:var(--ink-70)]">
            Canada texts right away. US texting turns on in about a week once
            carriers approve. The $29 US carrier registration is one time.
          </p>
          {/* Colophon, verbatim: showing sources is the brand. */}
          <p className="text-[color:var(--ink-55)]">
            Set in Besley by Owen Earl, Public Sans by USWDS, and Martian Mono by
            Evil Martians. Built with Next.js. No stock photos, no fake reviews.
          </p>
          {/* CASL sender identification (BLUEPRINT §9): the legal-identity line
              stays through the redesign; honest "pending" until ops fills
              business.ts. Not deck copy, but compliance is not optional. */}
          <p className="text-[color:var(--ink-55)]">{businessIdentityLine()}</p>
          <p className="text-[color:var(--ink-55)]">
            © {year} JobText. Month to month, like we said.
          </p>
        </div>
      </Container>
    </footer>
  );
}
