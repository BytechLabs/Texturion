import type { Metadata } from "next";

import { SITE_URL, absoluteUrl } from "./site";

/**
 * Default og:image for every marketing page. File-convention opengraph-image
 * routes do NOT cascade to child segments (verified live: /canada, /blog,
 * /compare shipped with no og:image at all while (marketing)/opengraph-image
 * served only "/"), so the shared card is wired here config-side instead —
 * a static 1200×630 snapshot of (marketing)/opengraph-image.tsx's render
 * (public/og/loonext-og-default.png; re-snapshot if that design changes).
 * Routes with their own opengraph-image.tsx (home, /pricing) still win:
 * file-based metadata takes priority over this config default.
 */
const OG_DEFAULT_IMAGE = {
  url: absoluteUrl("/og/loonext-og-default.png"),
  width: 1200,
  height: 630,
  alt: "A text message glowing warm out of a dark petrol screen at 9:47 pm, with a reply on its way back.",
} as const;

/**
 * Per-page Metadata builder for marketing routes (BLUEPRINT §11.1).
 *
 * - `title` feeds the root "%s · Loonext" template unless `absoluteTitle` is set
 *   (the home page uses an absolute title).
 * - Descriptions are hand-written per page (no templating, §11.1).
 * - `alternates.canonical` is emitted for every page.
 * - OpenGraph + Twitter (summary_large_image) share the page title/description;
 *   og:image is the shared default card above unless the route ships its own
 *   opengraph-image.tsx.
 * - `article` marks a blog post: og:type article + article:published_time,
 *   matching the BlogPosting JSON-LD the post also renders.
 */
export function buildMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
  article,
}: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
  article?: { publishedTimeIso: string; modifiedTimeIso?: string };
}): Metadata {
  const canonical = absoluteUrl(path);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical },
    openGraph: {
      siteName: "Loonext",
      title,
      description,
      url: canonical,
      images: [OG_DEFAULT_IMAGE],
      ...(article
        ? {
            type: "article",
            publishedTime: article.publishedTimeIso,
            modifiedTime: article.modifiedTimeIso ?? article.publishedTimeIso,
          }
        : { type: "website" }),
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
/* result since May 2026, §11.2). NO aggregateRating/review (none exist ,     */
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
    name: "Loonext",
    url: SITE_URL,
    logo: `${SITE_URL}/icons/icon-512.png`,
    description:
      "A shared SMS inbox for small service businesses in the US and Canada.",
  } as const;
}

/** WebSite node, home only. */
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "Loonext",
    url: SITE_URL,
    publisher: { "@id": ORG_ID },
  } as const;
}

/**
 * SoftwareApplication (WebApplication) with the two REAL offers, home + pricing.
 * Each Offer carries priceCurrency USD, a string price, and a monthly-subscription
 * qualifier so a parser can't read it as a one-time charge (§11.2 finding).
 * Deliberately no aggregateRating / review.
 */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: "Loonext",
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

/**
 * BlogPosting node for /blog/<slug> pages (#127). Author and publisher are the
 * Organization (solo-founder company; no personal author entity to claim).
 * Deliberately no `image` — Next wires the og image per route and we do not
 * hardcode asset URLs that could drift (same reasoning as buildMetadata).
 */
export function blogPostingJsonLd({
  headline,
  description,
  path,
  datePublishedIso,
  dateModifiedIso,
}: {
  headline: string;
  description: string;
  path: string;
  datePublishedIso: string;
  dateModifiedIso?: string;
}) {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    headline,
    description,
    url,
    mainEntityOfPage: url,
    datePublished: datePublishedIso,
    dateModified: dateModifiedIso ?? datePublishedIso,
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  } as const;
}

export interface Breadcrumb {
  name: string;
  path: string;
}

/** BreadcrumbList, sub-pages only (still fully supported, §11.2). */
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
