import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { legalDpaCopy } from "@/i18n/marketing/legal-dpa";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { parseDpaClauses } from "@/lib/marketing/dpa-clauses";

/**
 * #285 — the data processing agreement, published from `docs/DPA.md`
 * (English) or `docs/DPA.fr.md` (French) rather than retyped, so the page and
 * the document cannot be two versions of one commitment. The caller passes the
 * markdown in, because a page file imports it at build time and a Worker has
 * no filesystem to read it from later.
 */

export const DPA_EN_PATH = "/legal/dpa";
export const DPA_FR_PATH = "/fr/entente-traitement-donnees";
const LAST_UPDATED_ISO = "2026-08-16";

export function DpaPageBody({
  locale = "en",
  statement,
}: {
  locale?: MarketingLocale;
  statement: string;
}) {
  const copy = legalDpaCopy(locale);
  const terms = parseDpaClauses(statement);

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso={LAST_UPDATED_ISO}
      breadcrumbLabel={copy.breadcrumbLabel}
      path={locale === "fr-CA" ? DPA_FR_PATH : DPA_EN_PATH}
      sections={terms.map((clause) => ({
        id: `clause-${clause.number}`,
        number: clause.number,
        heading: clause.heading,
      }))}
      locale={locale}
    >
      {terms.map((clause) => (
        <LegalSectionBlock
          key={clause.number}
          id={`clause-${clause.number}`}
          number={clause.number}
          heading={clause.heading}
        >
          {clause.blocks.map((block, index) =>
            block.kind === "li" ? null : <p key={index}>{block.text}</p>,
          )}
          {clause.blocks.some((block) => block.kind === "li") && (
            <ul>
              {clause.blocks
                .filter((block) => block.kind === "li")
                .map((block, index) => (
                  <li key={index}>{block.text}</li>
                ))}
            </ul>
          )}
        </LegalSectionBlock>
      ))}

      <LegalSectionBlock id="contact" number="12" heading={copy.sectionContact}>
        <p>
          <LegalRichText
            text={copy.contact}
            slots={{
              supportEmail: (
                <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
              ),
            }}
          />
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
