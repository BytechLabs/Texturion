import securityPolicy from "@root/SECURITY.md";
import accessibilityStatement from "@root/docs/ACCESSIBILITY.md";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CountryProvider } from "@/components/marketing/country";

import { AccessibilityPageBody } from "./accessibility-page";
import { CookiesPageBody } from "./cookies-page";
import { DeleteMyDataPageBody } from "./delete-my-data-page";
import { FairUsePageBody } from "./fair-use-page";
import { MessagingPageBody } from "./messaging-page";
import { SubprocessorsPageBody } from "./subprocessors-page";
import { VulnerabilityDisclosurePageBody } from "./vulnerability-disclosure-page";

function render(body: React.ReactNode) {
  return renderToStaticMarkup(
    <CountryProvider initialCountry="ca">{body}</CountryProvider>,
  );
}

describe("#228 the seven non-contract legal documents render in French", () => {
  const pages = [
    {
      name: "accessibility",
      html: () =>
        render(
          <AccessibilityPageBody
            locale="fr-CA"
            statement={accessibilityStatement}
          />,
        ),
      expected: "Aucun parcours avec TalkBack ou VoiceOver",
      englishHeading: "What a buyer is usually asking",
    },
    {
      name: "cookies",
      html: () => render(<CookiesPageBody locale="fr-CA" />),
      expected: "Les témoins essentiels que nous utilisons",
      englishHeading: "The short version",
    },
    {
      name: "delete-my-data",
      html: () => render(<DeleteMyDataPageBody locale="fr-CA" />),
      expected: "exclusion des textos",
      englishHeading: "What is deleted",
    },
    {
      name: "fair-use",
      html: () => render(<FairUsePageBody locale="fr-CA" />),
      expected: "La limite quotidienne des fournisseurs sans fil",
      englishHeading: "Why this exists",
    },
    {
      name: "messaging",
      html: () => render(<MessagingPageBody locale="fr-CA" />),
      expected: "La fréquence des messages varie",
      englishHeading: "What this program is",
    },
    {
      name: "subprocessors",
      html: () => render(<SubprocessorsPageBody locale="fr-CA" />),
      expected: "Sous-traitants actuels",
      englishHeading: "Current sub-processors",
    },
    {
      name: "vulnerability-disclosure",
      html: () =>
        render(
          <VulnerabilityDisclosurePageBody
            locale="fr-CA"
            statement={securityPolicy}
          />,
        ),
      expected: "Protection des recherches de bonne foi",
      englishHeading: "Safe harbour",
    },
  ];

  for (const page of pages) {
    it(`${page.name} carries French body copy and French legal chrome`, () => {
      const html = page.html();
      expect(html).toContain(page.expected);
      expect(html).toContain("Dernière mise à jour");
      expect(html).toContain("Résumé en langage clair");
      expect(html).toContain('aria-label="Table des matières"');
      expect(html).not.toContain("Plain English summary");
      expect(html).not.toContain(page.englishHeading);
    });
  }

  it("translates the source-backed accessibility evidence table", () => {
    const html = render(
      <AccessibilityPageBody
        locale="fr-CA"
        statement={accessibilityStatement}
      />,
    );
    expect(html).toContain("Contraste (minimum)");
    expect(html).toContain("Appliqué par");
    expect(html).not.toContain("Contrast (Minimum)");
  });

  it("uses the French AI catalogue while preserving the attributable English quote", () => {
    const html = render(<SubprocessorsPageBody locale="fr-CA" />);
    expect(html).toContain("Réponses suggérées");
    expect(html).toContain("L&#x27;inférence de l&#x27;IA");
    expect(html).toContain("En français");
    expect(html).toContain("Cloudflare does not use your Customer Content");
  });

  it("keeps vulnerability-policy paragraphs and lists in source order", () => {
    const html = render(
      <VulnerabilityDisclosurePageBody
        locale="en"
        statement={securityPolicy}
      />,
    );
    const intro = html.indexOf("These are commitments");
    const firstCommitment = html.indexOf("Within 3 business days");
    const ceiling = html.indexOf("Critical issues jump the queue");
    const bounty = html.indexOf("We are glad to credit you");

    expect(intro).toBeGreaterThan(-1);
    expect(firstCommitment).toBeGreaterThan(intro);
    expect(ceiling).toBeGreaterThan(firstCommitment);
    expect(bounty).toBeGreaterThan(ceiling);
  });
});
