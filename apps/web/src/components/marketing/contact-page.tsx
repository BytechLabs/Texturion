import {
  ConvergedField,
  Dateline,
  FrCard,
  FrSection,
} from "@/components/marketing/fr";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { contactCopy } from "@/i18n/marketing/contact";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import {
  HAS_BUSINESS_IDENTITY,
  LEGAL_ENTITY_NAME,
  MAILING_ADDRESS,
  SECURITY_EMAIL,
  SUPPORT_EMAIL,
} from "@/lib/marketing/business";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

import { ContactForm } from "@/app/(marketing)/contact/contact-form";

/** Inline cobalt link (the marketing link voice). */
function ContactLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="font-medium text-[color:var(--fr-olive)] underline decoration-[color:var(--fr-olive)]/35 underline-offset-4 transition-colors duration-200 ease-out hover:decoration-[color:var(--fr-olive)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
    >
      {children}
    </a>
  );
}

/**
 * CONTACT (DESIGN-DIRECTION v4 §6, COPY-DECK v2): the short work-order form
 * plus the founder reply promise. The form POSTs to the PUBLIC POST /contact
 * endpoint (apps/api/src/routes/contact.ts), which forwards the message to the
 * support inbox and acknowledges the sender, so the reply promise stays
 * literally true. A pre-filled mailto remains as a fallback for people who
 * prefer their own mail client.
 *
 * ## D138 — one body, two routes
 *
 * `/contact` and `/fr/contact` are separate route files because a Next layout
 * cannot read the pathname and the language has to come from somewhere. They
 * render THIS, with a different locale and a different `metadata` export.
 * Duplicating the markup instead would be how the two pages come to differ by
 * a card nobody meant to move.
 *
 * The links stay on their English targets: `/security` and `/status` have no
 * French twin yet, and D138 Rule 4 says a `/fr` URL with no translation 404s
 * rather than serving English. Sending a French reader to the English page
 * that exists is the honest option; sending them to one that does not is not.
 */
export function ContactPageBody({ locale = "en" }: { locale?: MarketingLocale }) {
  const copy = contactCopy(locale);
  const french = locale === "fr-CA";

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
          { name: copy.breadcrumbSelf, path: french ? "/fr/contact" : "/contact" },
        ])}
      />
      <FrSection ground="white">
        <div className="max-w-3xl">
          <ConvergedField variant="mark" className="h-9 w-auto" />
          <div className="mt-6">
            <Dateline>{copy.dateline}</Dateline>
          </div>
          <h1 className="fr-h1 mt-5 text-[color:var(--fr-ink)]">{copy.title}</h1>
          <p className="fr-body mt-5 max-w-[58ch] text-[color:var(--fr-ink-70)]">
            {copy.intro}
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <FrCard className="p-6 sm:p-8">
            <ContactForm locale={locale} />
          </FrCard>

          <div className="space-y-6">
            <FrCard well className="p-6">
              <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                {copy.supportHeading}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                {copy.supportBody}
              </p>
              <p className="mt-2">
                <ContactLink href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </ContactLink>
              </p>
            </FrCard>

            <FrCard well className="p-6">
              <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                {copy.securityHeading}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                {copy.securityBodyBefore}{" "}
                <ContactLink href="/security">{copy.securityPageLink}</ContactLink>
                {copy.securityBodyAfter}
              </p>
              <p className="mt-2">
                <ContactLink href={`mailto:${SECURITY_EMAIL}`}>
                  {SECURITY_EMAIL}
                </ContactLink>
              </p>
            </FrCard>

            <FrCard well className="p-6">
              <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                {copy.statusHeading}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                {copy.statusBodyBefore}{" "}
                <ContactLink href="/status">{copy.statusPageLink}</ContactLink>.
              </p>
            </FrCard>

            {/* Identity renders only once ops supplies the real legal entity
                and mailing address; never a placeholder (purge 7). */}
            {HAS_BUSINESS_IDENTITY && (
              <FrCard well className="p-6">
                <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                  {copy.addressHeading}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                  {LEGAL_ENTITY_NAME}
                  <br />
                  {MAILING_ADDRESS}
                </p>
              </FrCard>
            )}
          </div>
        </div>
      </FrSection>
    </>
  );
}
