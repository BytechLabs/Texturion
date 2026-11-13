import securityPolicy from "@root/SECURITY.md";
import accessibilityStatement from "@root/docs/ACCESSIBILITY.md";
import dpaEn from "@root/docs/DPA.md";
import dpaFr from "@root/docs/DPA.fr.md";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CountryProvider } from "@/components/marketing/country";

import { AccessibilityPageBody } from "./accessibility-page";
import { AupPageBody } from "./aup-page";
import { CookiesPageBody } from "./cookies-page";
import { DeleteMyDataPageBody } from "./delete-my-data-page";
import { DpaPageBody } from "./dpa-page";
import { FairUsePageBody } from "./fair-use-page";
import { LegalRichText } from "./legal-rich-text";
import { MessagingPageBody } from "./messaging-page";
import { PrivacyPageBody } from "./privacy-page";
import { RefundsPageBody } from "./refunds-page";
import { SubprocessorsPageBody } from "./subprocessors-page";
import { TermsPageBody } from "./terms-page";
import { VulnerabilityDisclosurePageBody } from "./vulnerability-disclosure-page";

const SLOT_PATTERN = /\{[A-Za-z][A-Za-z0-9]*\}/g;

type Locale = "en" | "fr-CA";

const BODIES: Record<string, (locale: Locale) => ReactNode> = {
  privacy: (locale) => <PrivacyPageBody locale={locale} />,
  terms: (locale) => <TermsPageBody locale={locale} />,
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

function render(body: ReactNode) {
  return renderToStaticMarkup(
    <CountryProvider initialCountry="ca">{body}</CountryProvider>,
  );
}

describe("LegalRichText fills slots inside marks", () => {
  it("fills a slot inside bold", () => {
    const html = renderToStaticMarkup(
      <LegalRichText
        text="Our officer is **{officer}**."
        slots={{ officer: "our Privacy Officer" }}
      />,
    );
    expect(html).toBe("Our officer is <strong>our Privacy Officer</strong>.");
  });

  it("fills slots inside emphasis and code, and keeps marks inside bold", () => {
    const html = renderToStaticMarkup(
      <LegalRichText
        text="*see {page}* and `{region}` and **run `{command}`**"
        slots={{ page: "the policy", region: "us-east-1", command: "stop" }}
      />,
    );
    expect(html).toBe(
      "<em>see the policy</em> and <code>us-east-1</code> and <strong>run <code>stop</code></strong>",
    );
  });

  it("throws on an unknown slot inside bold", () => {
    expect(() =>
      renderToStaticMarkup(<LegalRichText text="Ask **{officer}**." slots={{}} />),
    ).toThrow("Missing legal-copy slot: officer");
  });

  it("throws on a slot name that only exists on Object.prototype", () => {
    expect(() =>
      renderToStaticMarkup(<LegalRichText text="Ask {toString}." />),
    ).toThrow("Missing legal-copy slot: toString");
  });

  it("throws when a slot value brings in an unfilled slot of its own", () => {
    expect(() =>
      renderToStaticMarkup(
        <LegalRichText text="Ask {officer}." slots={{ officer: <b>{"{name}"}</b> }} />,
      ),
    ).toThrow("Unfilled legal-copy slot: name");
  });
});

describe("every legal page renders with no slot left in braces", () => {
  const rendered: string[] = [];

  for (const [name, body] of Object.entries(BODIES)) {
    for (const locale of ["en", "fr-CA"] as const) {
      it(`${name} (${locale})`, () => {
        const html = render(body(locale));
        expect(html.match(SLOT_PATTERN) ?? []).toEqual([]);
        rendered.push(`${name} ${locale}`);
      });
    }
  }

  it("names the Law 25 officer in bold on the privacy page", () => {
    expect(render(BODIES.privacy("en"))).toContain("<strong>our Privacy Officer</strong>");
    expect(render(BODIES.privacy("fr-CA"))).toContain(
      "<strong>notre responsable de la protection des renseignements personnels</strong>",
    );
  });

  it("rendered every page in both languages, privacy among them", () => {
    console.log(`legal pages rendered with no slot left in braces: ${rendered.length}`);
    expect(rendered).toContain("privacy en");
    expect(rendered).toContain("privacy fr-CA");
    expect(rendered.length).toBe(Object.keys(BODIES).length * 2);
  });
});
