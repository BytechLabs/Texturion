import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { LegalRichText } from "@/components/marketing/legal/legal-rich-text";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import {
  accessibilityVerifiedFr,
  legalAccessibilityCopy,
} from "@/i18n/marketing/legal-accessibility";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";

const EN_PATH = "/legal/accessibility";
const FR_PATH = "/fr/accessibilite";

interface VerifiedRow {
  criterion: string;
  holds: string;
  enforcedBy: string;
}

/**
 * The verified table remains sourced from `docs/ACCESSIBILITY.md`. A source
 * change reaches the English page immediately and makes the French build fail
 * until its keyed translation is supplied, so neither language can drift.
 */
export function verifiedAccessibilityRows(statement: string): VerifiedRow[] {
  const source = statement;
  const start = source.indexOf("## Verified mechanically");
  if (start === -1) {
    throw new Error(
      "docs/ACCESSIBILITY.md has no 'Verified mechanically' section — the " +
        "published statement cannot be built from it",
    );
  }
  const rest = source.slice(start);
  const end = rest.indexOf("\n## ", 1);
  const block = end === -1 ? rest : rest.slice(0, end);
  const rows: VerifiedRow[] = [];

  for (const line of block.split("\n")) {
    const cells = line.trim();
    if (!cells.startsWith("|") || cells.includes("---")) continue;
    const parts = cells.split("|").slice(1, -1).map((cell) => cell.trim());
    if (parts.length !== 3 || parts[0] === "Criterion") continue;
    rows.push({ criterion: parts[0], holds: parts[1], enforcedBy: parts[2] });
  }
  if (rows.length === 0) {
    throw new Error(
      "docs/ACCESSIBILITY.md's verified table parsed to zero rows — refusing " +
        "to publish a statement that claims nothing is checked",
    );
  }
  return rows;
}

function splitBold(text: string): { lead: string; rest: string } {
  const match = /^\*\*(.+?)\*\*\s*(.*)$/.exec(text);
  return match
    ? { lead: match[1], rest: match[2] }
    : { lead: "", rest: text };
}

function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/`/g, "");
}

export function AccessibilityPageBody({
  locale = "en",
  statement,
}: {
  locale?: MarketingLocale;
  statement: string;
}) {
  const copy = legalAccessibilityCopy(locale);
  const french = locale === "fr-CA";
  const rows = verifiedAccessibilityRows(statement).map((row) => {
    if (!french) return row;
    const translated = accessibilityVerifiedFr[plain(row.criterion)];
    if (!translated) {
      throw new Error(
        `No French translation for accessibility criterion: ${plain(row.criterion)}`,
      );
    }
    const sourceHolds = plain(row.holds);
    if (translated.sourceHolds !== sourceHolds) {
      throw new Error(
        `Accessibility evidence changed for ${plain(row.criterion)}; update its French translation`,
      );
    }
    return {
      ...row,
      criterion: translated.criterion,
      holds: translated.holds,
    };
  });
  const sections = [
    { id: "asking", number: "1", heading: copy.sectionAsking },
    { id: "verified", number: "2", heading: copy.sectionVerified },
    { id: "not-verified", number: "3", heading: copy.sectionNotVerified },
    { id: "gaps", number: "4", heading: copy.sectionGaps },
    { id: "contact", number: "5", heading: copy.sectionContact },
  ];

  return (
    <LegalPage
      title={copy.title}
      summary={copy.summary}
      lastUpdated={copy.lastUpdated}
      lastUpdatedIso="2026-08-25"
      breadcrumbLabel={copy.breadcrumbLabel}
      path={french ? FR_PATH : EN_PATH}
      sections={sections}
      locale={locale}
    >
      <LegalSectionBlock id="asking" number="1" heading={copy.sectionAsking}>
        <p><LegalRichText text={copy.askingIntro} /></p>
        <ol>
          <li><LegalRichText text={copy.askingOne} /></li>
          <li><LegalRichText text={copy.askingTwo} /></li>
          <li><LegalRichText text={copy.askingThree} /></li>
          <li><LegalRichText text={copy.askingFour} /></li>
        </ol>
        <p><LegalRichText text={copy.askingEnd} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="verified" number="2" heading={copy.sectionVerified}>
        <p><LegalRichText text={copy.verifiedIntro} /></p>
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">{copy.tableCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{copy.columnCriterion}</th>
                <th scope="col">{copy.columnHolds}</th>
                <th scope="col">{copy.columnEnforcedBy}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { lead, rest } = splitBold(row.criterion);
                return (
                  <tr key={`${row.criterion}-${row.enforcedBy}`}>
                    <th scope="row">
                      {lead ? <strong>{lead}</strong> : null} {plain(rest)}
                    </th>
                    <td>{plain(row.holds)}</td>
                    <td><code>{plain(row.enforcedBy)}</code></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </LegalSectionBlock>

      <LegalSectionBlock id="not-verified" number="3" heading={copy.sectionNotVerified}>
        <p><LegalRichText text={copy.notVerifiedOne} /></p>
        <p><LegalRichText text={copy.notVerifiedTwo} /></p>
      </LegalSectionBlock>

      <LegalSectionBlock id="gaps" number="4" heading={copy.sectionGaps}>
        <p><LegalRichText text={copy.gapsIntro} /></p>
        <ul>
          <li><LegalRichText text={copy.gapResize} /></li>
          <li><LegalRichText text={copy.gapAudit} /></li>
          <li><LegalRichText text={copy.gapScreenReader} /></li>
          <li><LegalRichText text={copy.gapIos} /></li>
          <li><LegalRichText text={copy.gapLocale} /></li>
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="5" heading={copy.sectionContact}>
        <p>
          <LegalRichText text={copy.contact} slots={{
            supportEmail: (
              <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
            ),
          }} />
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
