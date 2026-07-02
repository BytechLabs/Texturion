import type { Metadata } from "next";

import { SITE_URL, absoluteUrl } from "./site";

/**
 * Per-page Metadata builder for marketing routes (BLUEPRINT §11.1).
 *
 * - `title` feeds the root "%s · JobText" template unless `absoluteTitle` is set
 *   (the home page uses an absolute title).
 * - Descriptions are hand-written per page (no templating — §11.1).
 * - `alternates.canonical` is emitted for every page.
 * - OpenGraph + Twitter (summary_large_image) share the page title/description;
 *   images come from the route's own opengraph-image.tsx (Next auto-wires them),
 *   so we don't hardcode image URLs here.
 */
export function buildMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
}): Metadata {
  const canonical = absoluteUrl(path);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: "JobText",
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* JSON-LD (BLUEPRINT §11.2)                                                   */
/*                                                                            */
/* Official Next pattern: inline <script type="application/ld+json"> in a     */
/* server component, escaping "<" to block breakout. NO FAQPage (dead rich    */
/* result since May 2026, §11.2). NO aggregateRating/review (none exist —     */
/* fabrication risks a manual action, §13.1).                                 */
/* -------------------------------------------------------------------------- */

/** Serialize a JSON-LD object with the "<" escape the Next docs mandate. */
export function jsonLdScript(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

const ORG_ID = `${SITE_URL}/#organization`;

/** Organization node (root of the graph; referenced by other nodes via @id). */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: "JobText",
    url: SITE_URL,
    logo: `${SITE_URL}/icons/icon-512.png`,
    description:
      "A shared SMS inbox for small service businesses in the US and Canada.",
  } as const;
}

/** WebSite node — home only. */
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "JobText",
    url: SITE_URL,
    publisher: { "@id": ORG_ID },
  } as const;
}

/**
 * SoftwareApplication (WebApplication) with the two REAL offers — home + pricing.
 * Each Offer carries priceCurrency USD, a string price, and a monthly-subscription
 * qualifier so a parser can't read it as a one-time charge (§11.2 finding).
 * Deliberately no aggregateRating / review.
 */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: "JobText",
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "WebApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    publisher: { "@id": ORG_ID },
    offers: [
      {
        "@type": "Offer",
        name: "Starter",
        price: "29.00",
        priceCurrency: "USD",
        category: "monthly subscription",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "29.00",
          priceCurrency: "USD",
          unitCode: "MON",
          billingIncrement: 1,
        },
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: "79.00",
        priceCurrency: "USD",
        category: "monthly subscription",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "79.00",
          priceCurrency: "USD",
          unitCode: "MON",
          billingIncrement: 1,
        },
      },
    ],
  } as const;
}

export interface Breadcrumb {
  name: string;
  path: string;
}

/** BreadcrumbList — sub-pages only (still fully supported, §11.2). */
export function breadcrumbJsonLd(crumbs: Breadcrumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  } as const;
}
