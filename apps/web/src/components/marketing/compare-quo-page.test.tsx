import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { CompareQuoPageBody } from "./compare-quo-page";

it.each([
  { locale: "en", href: "/developers", signup: "/signup?plan=pro" },
  { locale: "fr-CA", href: "/fr/developpeurs", signup: "/signup?plan=pro&amp;lang=fr-CA" },
] as const)(
  "links to developer resources and the Pro signup from the $locale Quo comparison",
  ({ locale, href, signup }) => {
    const html = renderToStaticMarkup(<CompareQuoPageBody locale={locale} />);
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain(`href="${signup}"`);
  },
);
