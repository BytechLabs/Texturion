import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { RegistrationFee } from "@/components/marketing/pricing/plan-price";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalRefundsCopy } from "@/i18n/marketing/legal-refunds";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { localizedPath } from "@/lib/marketing/translated-pages";

const PATH = "/legal/refunds";
const LAST_UPDATED_ISO = "2026-07-03";

/**
 * The 30-day guarantee, composed once for both languages.
 *
 * #328 — the one figure here is the registration fee, and it is the figure a
 * refund promise is measured against. `<RegistrationFee />` follows the
 * site-wide country, so a Canadian workspace that turned on US texting reads
 * the CAD amount it actually paid.
 *
 * The links to `/legal/terms` follow the reader's language: since D157 the
 * Terms have a French twin, and `localizedPath` sends a French reader to it.
 */
export function RefundsPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = legalRefundsCopy(locale);
  const french = locale === "fr-CA";
  const lastUpdated = french ? "3 juillet 2026" : "July 3, 2026";

  const sections = [
    { id: "guarantee", number: "1", heading: copy.sectionGuarantee },
    { id: "request", number: "2", heading: copy.sectionRequest },
    { id: "after", number: "3", heading: copy.sectionAfter },
    { id: "contact", number: "4", heading: copy.sectionContact },
  ];

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={lastUpdated}
      lastUpdatedIso={LAST_UPDATED_ISO}
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? "/fr/remboursements" : PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="guarantee" number="1" heading={copy.sectionGuarantee}>
        <p>
          {copy.guaranteeBefore} <RegistrationFee /> {copy.guaranteeAfter}{" "}
          <LegalLink href={localizedPath("/legal/terms", locale)}>{copy.guaranteeTermsLink}</LegalLink>
          {copy.guaranteeEnd}
        </p>
        <p>{copy.guaranteeYear}</p>
        <p>{copy.guaranteeAfterThirty}</p>
      </LegalSectionBlock>

      <LegalSectionBlock id="request" number="2" heading={copy.sectionRequest}>
        <p>
          {copy.requestBefore}{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>{" "}
          {copy.requestAfter}
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="after" number="3" heading={copy.sectionAfter}>
        <p>{copy.afterRefund}</p>
        <p>
          {copy.afterNumberBefore}{" "}
          <LegalLink href={localizedPath("/legal/terms", locale)}>{copy.afterNumberLink}</LegalLink>
          {copy.afterNumberAfter}
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="4" heading={copy.sectionContact}>
        <p>
          {copy.contactBefore}{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>{" "}
          {copy.contactMiddle}{" "}
          <LegalLink href={french ? "/fr/contact" : "/contact"}>
            {copy.contactLink}
          </LegalLink>
          {copy.contactAfter}
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
