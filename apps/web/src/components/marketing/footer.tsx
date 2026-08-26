import { LanguageSwitch } from "@/components/marketing/language-switch";
import Link from "next/link";

import { LEGAL_ENTITY_NAME, MAILING_ADDRESS } from "@/lib/marketing/business";
import {
  footerCopy,
  type MarketingLocale,
} from "@/i18n/marketing/footer";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { twinOf } from "@/lib/marketing/translated-pages";

/**
 * FOOTER (COPY-DECK v2 §F, DESIGN-DIRECTION v4 §4): the separate band,
 * "night outside the window", one of the site's two sanctioned dark
 * surfaces. Quiet links in four columns covering every route in the
 * coverage map (Product 7 · Who it's for 6 · Compare 2 · Company and legal
 * 10), the brand line, the conditional identity line, and the sign-off.
 * Server component, zero JS, shared by every marketing page.
 *
 * #362 phase 8: the band rides `--fr-inverse`, not `--fr-ink`. Ink is TEXT and
 * flips light in dark mode; this band is a surface and stays dark in both, so
 * sharing one token would have inverted the footer and left every white link on
 * near-white. The link colours come from `--fr-on-inverse*` for the same
 * reason — a literal white reads as a decision nobody has to re-check, and on
 * the dark band it is the wrong one.
 *
 * Law 1: no credits of any kind (no fonts, no framework, nothing about what
 * the site does or doesn't fake). Identity line renders ONLY when ops has
 * supplied the real legal entity and mailing address; until then, nothing
 * (never a placeholder sentence).
 */

/** The footer's words for whichever language the route is serving. */
type FooterCopy = ReturnType<typeof footerCopy>;

interface FooterLinkItem {
  label: string;
  href: string;
}

/* Deck §F column inventories, verbatim order. */
const PRODUCT = (copy: FooterCopy): FooterLinkItem[] => [
  { label: copy.sharedInbox, href: LIVE_ROUTES.featuresSharedInbox },
  { label: copy.calls, href: LIVE_ROUTES.featuresCalls },
  { label: copy.tasks, href: LIVE_ROUTES.featuresTasks },
  { label: copy.contacts, href: LIVE_ROUTES.featuresContacts },
  { label: copy.assistant, href: LIVE_ROUTES.featuresAssistant },
  { label: copy.businessNumber, href: LIVE_ROUTES.featuresBusinessNumber },
  { label: copy.compliance, href: LIVE_ROUTES.featuresCompliance },
  { label: copy.templatesAndTags, href: LIVE_ROUTES.featuresTemplatesAndTags },
  { label: copy.pricing, href: LIVE_ROUTES.pricing },
  { label: copy.security, href: LIVE_ROUTES.security },
  // #238/#285: a buyer asking "is it accessible" should not have to ask us.
  { label: copy.accessibility, href: LIVE_ROUTES.accessibility },
  // #285: a buyer with a compliance function asks for this by name.
  { label: copy.dpa, href: LIVE_ROUTES.dpa },
  // #285: the repository is public, so researchers read this code whether or
  // not we invite them. The difference between a coordinated report and a
  // public disclosure is often just having an obvious place to send it, and a
  // link nobody can find is the same as no link.
  {
    label: copy.vulnerability,
    href: LIVE_ROUTES.vulnerabilityDisclosure,
  },
  { label: copy.canada, href: LIVE_ROUTES.canada },
];

const WHO_ITS_FOR = (copy: FooterCopy): FooterLinkItem[] => [
  { label: copy.plumbers, href: LIVE_ROUTES.forPlumbers },
  { label: copy.landscapers, href: LIVE_ROUTES.forLandscapers },
  { label: copy.cleaners, href: LIVE_ROUTES.forCleaners },
  { label: copy.hvac, href: LIVE_ROUTES.forHvac },
  { label: copy.salons, href: LIVE_ROUTES.forSalons },
  { label: copy.contractors, href: LIVE_ROUTES.forContractors },
];

const COMPARE = (copy: FooterCopy): FooterLinkItem[] => [
  { label: copy.compareHeymarket, href: LIVE_ROUTES.compareHeymarket },
  { label: copy.compareQuo, href: LIVE_ROUTES.compareQuo },
];

const COMPANY_AND_LEGAL = (copy: FooterCopy): FooterLinkItem[] => [
  // #127: the blog joins the company column (the deck §F inventory predates
  // it; the nav bar stays deliberately lean, so the footer carries the link).
  { label: copy.blog, href: LIVE_ROUTES.blog },
  { label: copy.terms, href: LIVE_ROUTES.terms },
  { label: copy.privacy, href: LIVE_ROUTES.privacy },
  { label: copy.cookies, href: LIVE_ROUTES.cookies },
  { label: copy.aup, href: LIVE_ROUTES.aup },
  { label: copy.fairUse, href: LIVE_ROUTES.fairUse },
  { label: copy.messaging, href: LIVE_ROUTES.messaging },
  { label: copy.subprocessors, href: LIVE_ROUTES.subprocessors },
  // #227: a store reviewer, and anyone who has lost account access, has to be
  // able to find this without signing in.
  { label: copy.deleteData, href: LIVE_ROUTES.deleteMyData },
  { label: copy.guarantee, href: LIVE_ROUTES.refunds },
  { label: copy.security, href: LIVE_ROUTES.security },
  { label: copy.status, href: LIVE_ROUTES.status },
  { label: copy.contact, href: LIVE_ROUTES.contact },
];

/* Footer CSS, prefix "frf-". ONE inert style block, unlayered so the base
   declarations beat Tailwind utilities. On the separate band: links at the
   quiet step, hover to full; focus = 2px outline in the on-band ink (the olive
   accent vanishes against this surface in both modes). The only transition
   (link color) is reduced-motion gated. */
const CSS = `
.frf-root {
  background-color: var(--fr-inverse);
  color: var(--fr-on-inverse);
}
.frf-link {
  color: var(--fr-on-inverse-70);
}
.frf-link:hover {
  color: var(--fr-on-inverse);
}
.frf-link:focus-visible,
.frf-mark:focus-visible {
  outline: 2px solid var(--fr-on-inverse);
  outline-offset: 2px;
  border-radius: 2px;
}
@media (prefers-reduced-motion: no-preference) {
  .frf-link {
    transition: color 200ms ease-out;
  }
}
`;

function LinkList({
  links,
  locale,
}: {
  links: FooterLinkItem[];
  locale: MarketingLocale;
}) {
  return (
    <ul className="mt-4 space-y-2.5">
      {links.map((link) => {
        const twin = locale === "fr-CA" ? twinOf(link.href) : undefined;
        const href = twin?.locale === "fr-CA" ? twin.path : link.href;
        return (
          <li key={`${link.label}-${href}`}>
            <Link href={href} className="frf-link font-body-mkt text-sm">
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ColumnHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="fr-eyebrow text-[color:var(--fr-on-inverse-55)]">
      {children}
    </h2>
  );
}

export function Footer({ locale = "en" }: { locale?: MarketingLocale } = {}) {
  const copy = footerCopy(locale);
  const home = locale === "fr-CA" ? "/fr" : "/";
  const year = new Date().getFullYear();
  const hasIdentity = LEGAL_ENTITY_NAME !== null && MAILING_ADDRESS !== null;

  return (
    <footer className="frf-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="mx-auto w-full max-w-[72rem] px-6 py-16 md:px-8 md:py-20">
        <div className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
          {/* Brand block: the wordmark rule (#206, brand/README.md) — Golos
              Text SemiBold (var mounted by the marketing layout), second o in
              lime (the dark-surface accent on this ink band) — + the deck
              brand line. */}
          <div className="lg:col-span-3">
            <Link
              href={home}
              aria-label={copy.homeAria}
              className="frf-mark text-2xl font-semibold tracking-tight text-[color:var(--fr-on-inverse)] [font-family:var(--font-golos),system-ui,sans-serif]"
            >
              Lo<span className="text-[#B9CF57]">o</span>next
            </Link>
            <p className="font-body-mkt mt-3 max-w-xs text-sm leading-relaxed text-[color:var(--fr-on-inverse-70)]">
              {copy.brandLine}
            </p>
          </div>

          <nav aria-label={copy.headingProduct} className="lg:col-span-3">
            <ColumnHeading>{copy.headingProduct}</ColumnHeading>
            <LinkList links={PRODUCT(copy)} locale={locale} />
          </nav>

          <nav aria-label={copy.headingWhoItsFor} className="lg:col-span-2">
            <ColumnHeading>{copy.headingWhoItsFor}</ColumnHeading>
            <LinkList links={WHO_ITS_FOR(copy)} locale={locale} />
          </nav>

          <nav aria-label={copy.headingCompare} className="lg:col-span-2">
            <ColumnHeading>{copy.headingCompare}</ColumnHeading>
            <LinkList links={COMPARE(copy)} locale={locale} />
          </nav>

          <nav aria-label={copy.headingCompanyLegal} className="lg:col-span-2">
            <ColumnHeading>{copy.headingCompanyLegal}</ColumnHeading>
            <LinkList links={COMPANY_AND_LEGAL(copy)} locale={locale} />
          </nav>
        </div>

        {/* Sign-off (deck §F). Identity line only when ops supplies it;
            until then, nothing renders (Law 1: never a placeholder). */}
        <div className="font-body-mkt mt-14 space-y-3 text-sm leading-relaxed">
          {hasIdentity ? (
            <p className="text-[color:var(--fr-on-inverse-70)]">
              {LEGAL_ENTITY_NAME} · {MAILING_ADDRESS}
            </p>
          ) : null}
          <p className="text-[color:var(--fr-on-inverse-70)]">
            {copy.monthToMonth}
          </p>
          {/* D138 Rule 6 — renders nothing on a page with no French twin. */}
          <LanguageSwitch />
          <p className="text-[color:var(--fr-on-inverse-55)]">
            {copy.rights.replace("{year}", String(year))}
          </p>
        </div>
      </div>
    </footer>
  );
}
