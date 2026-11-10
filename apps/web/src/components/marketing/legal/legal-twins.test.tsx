import securityPolicy from "@root/SECURITY.md";
import accessibilityStatement from "@root/docs/ACCESSIBILITY.md";
import dpaEn from "@root/docs/DPA.md";
import dpaFr from "@root/docs/DPA.fr.md";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CountryProvider } from "@/components/marketing/country";
import { parseDpaClauses } from "@/lib/marketing/dpa-clauses";
import { TRANSLATED_PAGES } from "@/lib/marketing/translated-pages";

import { AccessibilityPageBody } from "./accessibility-page";
import { AupPageBody } from "./aup-page";
import { CookiesPageBody } from "./cookies-page";
import { DeleteMyDataPageBody } from "./delete-my-data-page";
import { DpaPageBody } from "./dpa-page";
import { FairUsePageBody } from "./fair-use-page";
import { MessagingPageBody } from "./messaging-page";
import { PrivacyPageBody } from "./privacy-page";
import { RefundsPageBody } from "./refunds-page";
import { SubprocessorsPageBody } from "./subprocessors-page";
import { TermsPageBody } from "./terms-page";
import { VulnerabilityDisclosurePageBody } from "./vulnerability-disclosure-page";

/**
 * #228 — every English legal document has a French twin with the same shape.
 *
 * The French text is a translation of a contract, so the failure to catch
 * is the quiet one: somebody edits a clause in English, adds a
 * section, and the French reader's version keeps promising the old terms. The
 * checks are structural (the same sections, in the same order, with the same
 * number of list items) because a test cannot read legal meaning, but it can
 * refuse an edit that touched only one language.
 */

const LEGAL_DIR = join(process.cwd(), "src", "app", "(marketing)", "legal");

function render(body: React.ReactNode) {
  return renderToStaticMarkup(
    <CountryProvider initialCountry="ca">{body}</CountryProvider>,
  );
}

type Locale = "en" | "fr-CA";

const BODIES: Record<string, (locale: Locale) => React.ReactNode> = {
  terms: (locale) => <TermsPageBody locale={locale} />,
  privacy: (locale) => <PrivacyPageBody locale={locale} />,
  aup: (locale) => <AupPageBody locale={locale} />,
  dpa: (locale) => (
    <DpaPageBody locale={locale} statement={locale === "en" ? dpaEn : dpaFr} />
  ),
  accessibility: (locale) => (
    <AccessibilityPageBody locale={locale} statement={accessibilityStatement} />
  ),
  cookies: (locale) => <CookiesPageBody locale={locale} />,
  "delete-my-data": (locale) => <DeleteMyDataPageBody locale={locale} />,
  "fair-use": (locale) => <FairUsePageBody locale={locale} />,
  messaging: (locale) => <MessagingPageBody locale={locale} />,
  refunds: (locale) => <RefundsPageBody locale={locale} />,
  subprocessors: (locale) => <SubprocessorsPageBody locale={locale} />,
  "vulnerability-disclosure": (locale) => (
    <VulnerabilityDisclosurePageBody locale={locale} statement={securityPolicy} />
  ),
};

/** The ids of every `<section>` a page renders, in order. */
function sectionIds(html: string): string[] {
  return [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
}

const documents = readdirSync(LEGAL_DIR, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(join(LEGAL_DIR, entry.name, "page.tsx")),
  )
  .map((entry) => entry.name);

describe("#228 every English legal document has a French twin", () => {
  it("found the English legal documents at all", () => {
    expect(documents.length).toBeGreaterThanOrEqual(12);
  });

  for (const name of documents) {
    describe(`/legal/${name}`, () => {
      it("is registered with a French route that exists", () => {
        const row = TRANSLATED_PAGES.find((p) => p.en === `/legal/${name}`);
        expect(row, `/legal/${name} has no French twin in TRANSLATED_PAGES`).toBeDefined();
        const page = join(
          process.cwd(),
          "src",
          "app",
          "(marketing-fr)",
          ...row!.fr.split("/").filter(Boolean),
          "page.tsx",
        );
        expect(existsSync(page), `missing ${row!.fr}`).toBe(true);
      });

      it("renders the same sections, in the same order, in both languages", () => {
        const body = BODIES[name];
        expect(body, `no render fixture for /legal/${name}; add it above`).toBeDefined();
        const en = sectionIds(render(body("en")));
        const fr = sectionIds(render(body("fr-CA")));
        expect(en.length, `/legal/${name} rendered no sections`).toBeGreaterThan(0);
        expect(fr).toEqual(en);
      });
    });
  }
});

describe("#228 the contract documents keep the same obligations in French", () => {
  it("the DPA has the same clauses, paragraphs and list items in both languages", () => {
    const en = parseDpaClauses(dpaEn);
    const fr = parseDpaClauses(dpaFr);
    expect(en.length).toBeGreaterThan(0);
    expect(fr.map((c) => c.number)).toEqual(en.map((c) => c.number));
    for (const [index, clause] of en.entries()) {
      expect(
        fr[index].blocks.map((b) => b.kind),
        `DPA clause ${clause.number} differs in shape between English and French`,
      ).toEqual(clause.blocks.map((b) => b.kind));
    }
  });

  it("the DPA cites the same sources in both languages", () => {
    const sources = (md: string) =>
      md
        .split("\n")
        .filter((line) => line.startsWith("> "))
        .map((line) => line.trim());
    expect(sources(dpaFr)).toEqual(sources(dpaEn));
  });

  it("the French DPA keeps the three promises it deliberately under-makes", () => {
    expect(dpaFr).toMatch(/non une garantie de résidence/i);
    expect(dpaFr).toMatch(/n'est pas complète dans tous\s+les\s+magasins/i);
    expect(dpaFr).toMatch(/n'offrons pas aux clients d'audits sur\s+place/i);
    expect(dpaFr).toMatch(/SOC 2/);
  });

  it("the French terms carry the same limit of liability figure and windows", () => {
    const html = render(<TermsPageBody locale="fr-CA" />);
    expect(html).toContain("trois mois");
    expect(html).toContain("30 jours");
    expect(html).toContain("80 % et 100 %");
    expect(html).toContain("de 3 à 7 jours ouvrables");
    expect(html).toContain("de 1 à 7 jours ouvrables");
  });

  it("the terms say which language governs, in both languages", () => {
    const html = render(<TermsPageBody locale="fr-CA" />);
    expect(html).toContain("la version française vous est présentée en premier et elle régit");
    expect(html).toContain("souhait exprès");
    const english = render(<TermsPageBody locale="en" />);
    expect(english).toContain("the French version is presented to you first and it governs");
    expect(english).toContain("express wish");
  });

  it("French legal pages link to French twins, not back to English", () => {
    const pages = [
      <TermsPageBody key="t" locale="fr-CA" />,
      <AupPageBody key="a" locale="fr-CA" />,
      <PrivacyPageBody key="p" locale="fr-CA" />,
      <CookiesPageBody key="c" locale="fr-CA" />,
    ];
    for (const page of pages) {
      const html = render(page);
      for (const english of ["/legal/terms", "/legal/aup", "/legal/privacy", "/legal/dpa"]) {
        expect(html, `French page links to ${english}`).not.toContain(`href="${english}"`);
      }
    }
  });
});
