import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { CompareQuoPageBody } from "./compare-quo-page";

it.each([
  { locale: "en", href: "/developers" },
  { locale: "fr-CA", href: "/fr/developpeurs" },
] as const)(
  "links to developer resources and the Pro signup from the $locale Quo comparison",
  ({ locale, href }) => {
    const html = renderToStaticMarkup(<CompareQuoPageBody locale={locale} />);
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain('/signup?plan=pro"');
  },
);
