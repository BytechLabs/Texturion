/**
 * Blog post registry (#127), the single source of truth for /blog: it drives
 * the index page, the sitemap entries, and the RSS feed, the same way
 * LIVE_ROUTES drives the fixed-route inventory (BLUEPRINT §11.3 pattern).
 *
 * Every post here is a REAL hand-authored route at
 * app/(marketing)/blog/<slug>/page.tsx (enforced by blog-pages.test.ts).
 * Posts are ordered newest first; the index and the feed render in registry
 * order. Article copy follows the house rules: plain language, no em-dashes,
 * every product or billing claim a verified fact from BRAND-MESSAGING.md.
 */

export interface BlogPost {
  /** URL slug under /blog, kebab-case. */
  slug: string;
  /** H1 and metadata title (feeds the "%s · Loonext" template). */
  title: string;
  /** Meta description and the one-liner on the index page. Under 160 chars. */
  description: string;
  /** The mono eyebrow chip above the H1, e.g. "FIELD GUIDE". */
  dateline: string;
  /** Human display date, e.g. "July 10, 2026". */
  datePublished: string;
  /** ISO date for <time>, JSON-LD, sitemap, and RSS, e.g. "2026-07-10". */
  datePublishedIso: string;
  /** Honest estimate at ~220 words per minute, whole minutes. */
  readingMinutes: number;
}

/** Newest first (the launch batch shares one date; array order is the index
 * order: flagship pain piece, then the number-cluster hub and spokes, then
 * the compliance set). */
export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "stop-giving-customers-your-personal-cell-number",
    title: "How to stop giving customers your personal cell number",
    description:
      "A practical plan to move customers off your personal cell and onto one business text number, with copy paste templates and honest costs.",
    dateline: "GUIDE",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 6,
  },
  {
    slug: "how-to-get-a-business-text-number",
    title: "How to get a business text number your whole crew can use",
    description:
      "How to get a local business text number your whole crew can answer: new, ported, or text enabled, plus real costs and the honest US setup timeline.",
    dateline: "GUIDE",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 6,
  },
  {
    slug: "shared-inbox-vs-group-text-vs-forwarding",
    title:
      "Group text, forwarding, or shared inbox? How small crews share one business number",
    description:
      "Group threads, forwarding, and shared logins all work at first. Where each one breaks, and how a shared inbox lets a small crew answer one number.",
    dateline: "GUIDE",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 6,
  },
  {
    slug: "real-cost-of-business-texting",
    title: "What business texting really costs: every fee, itemized",
    description:
      "A plain breakdown of business texting costs: platform fees, per seat pricing, number fees, carrier passthrough, registration, and hidden charges.",
    dateline: "PRICING",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 8,
  },
  {
    slug: "missed-calls-lost-jobs-text-back-playbook",
    title:
      "Missed calls are costing you jobs: the text-back playbook for trades",
    description:
      "Text back every missed call within a minute. Copy and paste templates for plumbers, HVAC, salons, landscapers, and cleaners, plus follow up scripts.",
    dateline: "PLAYBOOK",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 6,
  },
  {
    slug: "how-to-text-quotes-to-customers",
    title:
      "How to text a quote to a customer: timing, etiquette, and templates that win jobs",
    description:
      "Copy and paste templates for texting quotes to customers, plus a follow up cadence and etiquette that win jobs without being pushy.",
    dateline: "TEMPLATES",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 7,
  },
  {
    slug: "text-enable-your-business-landline",
    title:
      "Can customers text your landline? How to text-enable the number you already have",
    description:
      "Your landline can receive texts without changing your phone service. How text enabling works, which numbers qualify, and the honest timeline.",
    dateline: "NUMBERS",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 5,
  },
  {
    slug: "port-business-number-without-going-dark",
    title:
      "How to port your business number to a texting service without going dark",
    description:
      "Keep your business number when you switch to a texting service. A pre port checklist, realistic timelines, and the voice vs texting gotcha.",
    dateline: "NUMBERS",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 7,
  },
  {
    slug: "a2p-10dlc-registration-honest-timeline",
    title: "A2P 10DLC registration: the honest timeline for a small business",
    description:
      "What A2P 10DLC registration is, what it costs, why US sending takes about a week to approve, and what your crew can do while you wait.",
    dateline: "NUMBERS",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 5,
  },
  {
    slug: "customer-texted-stop-now-what",
    title: "A customer texted STOP: what just happened, and what to do next",
    description:
      "What actually happens when a customer texts STOP, the mistakes that create real legal risk, and how customers can opt back in with START.",
    dateline: "COMPLIANCE",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 6,
  },
  {
    slug: "tcpa-rules-texting-customers-service-business",
    title:
      "TCPA rules for texting customers: a plain-English guide for service businesses",
    description:
      "What the TCPA actually requires when a service business texts customers: replies vs marketing, consent, STOP requests, and a checklist for this afternoon.",
    dateline: "COMPLIANCE",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 6,
  },
  {
    slug: "casl-text-message-rules-canada",
    title:
      "CASL texting rules for Canadian small businesses, in plain English",
    description:
      "What CASL actually requires when a Canadian service business texts customers: consent, identification, unsubscribe, and STOP handling, in plain English.",
    dateline: "COMPLIANCE",
    datePublished: "July 10, 2026",
    datePublishedIso: "2026-07-10",
    readingMinutes: 7,
  },
];

/** Path for a post (leading slash), e.g. "/blog/stop-texting-from-your-cell". */
export function blogPostPath(slug: string): string {
  return `/blog/${slug}`;
}

/** Registry lookup for post pages; throws at build time on a typo'd slug. */
export function blogPost(slug: string): BlogPost {
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) throw new Error(`unregistered blog post: ${slug}`);
  return post;
}

/**
 * The post's own OG card, rendered from its plate art + title by the
 * app/og/blog/[slug] route. Feeds buildMetadata's `image` param — every post
 * page passes this so no post ever falls back to the site-wide default card.
 */
export function blogPostOgImage(post: BlogPost): {
  path: string;
  width: number;
  height: number;
  alt: string;
} {
  return {
    path: `/og/blog/${post.slug}`,
    width: 1200,
    height: 630,
    alt: post.title,
  };
}
