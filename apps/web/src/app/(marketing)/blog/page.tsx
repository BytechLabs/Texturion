import Link from "next/link";
import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/marketing/ui/breadcrumbs";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { BLOG_POSTS, blogPostPath } from "@/lib/marketing/blog";
import {
  breadcrumbJsonLd,
  buildMetadata,
  type Breadcrumb,
} from "@/lib/marketing/seo";
import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";

/**
 * /blog index (#127): the quiet register. One 68ch column, no art; each post
 * is a date, a linked title, and its one-line description, newest first from
 * the BLOG_POSTS registry. Advertises the RSS feed via alternates.types.
 */

const PATH = LIVE_ROUTES.blog;

const base = buildMetadata({
  title: "Blog",
  description:
    "Plain-English guides on customer texting for small service crews: getting the business off one person's cell, staying compliant, and answering every job.",
  path: PATH,
});

export const metadata: Metadata = {
  ...base,
  alternates: {
    ...base.alternates,
    types: { "application/rss+xml": absoluteUrl("/blog/rss.xml") },
  },
};

export default function BlogIndexPage() {
  const crumbs: Breadcrumb[] = [
    { name: "Home", path: "/" },
    { name: "Blog", path: PATH },
  ];
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />

      <div className="bg-[color:var(--fr-ground)] py-16 md:py-24">
        <div className="mx-auto w-full max-w-[68ch] px-6 md:px-8">
          <header>
            <Breadcrumbs crumbs={crumbs} className="mb-6" />
            <h1 className="font-display text-[2rem] font-extrabold leading-[1.1] tracking-[-0.01em] text-[color:var(--fr-ink)] sm:text-[2.5rem] text-balance">
              The Loonext blog.
            </h1>
            <p className="fr-body mt-5 text-[color:var(--fr-ink-70)]">
              Plain-English guides on customer texting for small service
              crews: getting the business off one person&apos;s cell, staying
              on the right side of the texting rules, and answering every job
              that comes in.
            </p>
          </header>

          <div className="mt-14 space-y-10">
            {BLOG_POSTS.map((post) => (
              <article key={post.slug}>
                <p className="fr-mono-data text-[0.8125rem] text-[color:var(--fr-ink-55)]">
                  <time dateTime={post.datePublishedIso}>
                    {post.datePublished}
                  </time>
                  {" · "}
                  {post.readingMinutes} min read
                </p>
                <h2 className="fr-h3 mt-2 text-[color:var(--fr-ink)]">
                  <Link
                    href={blogPostPath(post.slug)}
                    className="transition-colors duration-200 ease-out hover:text-[color:var(--fr-cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
                  >
                    {post.title}
                  </Link>
                </h2>
                <p className="fr-body mt-2 text-[color:var(--fr-ink-70)]">
                  {post.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
