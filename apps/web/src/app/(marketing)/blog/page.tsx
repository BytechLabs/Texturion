import Link from "next/link";
import type { Metadata } from "next";

import { BlogPlate } from "@/components/marketing/blog/blog-plate";
import { FrCard } from "@/components/marketing/fr";
import { Breadcrumbs } from "@/components/marketing/ui/breadcrumbs";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import { BLOG_POSTS, blogPostPath } from "@/lib/marketing/blog";
import {
  breadcrumbJsonLd,
  buildMetadata,
  type Breadcrumb,
} from "@/lib/marketing/seo";
import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";

/**
 * /blog index (#127, redesigned): a card grid in the standard 72rem band, the
 * compare-hub anatomy (FrCard p-0, one full-card Link, Reveal stagger). Every
 * card opens with the post's own plate (deterministic art from the slug, see
 * lib/marketing/blog-art) so the index reads as a designed publication, not a
 * list. The newest post leads the grid full-width with its banner plate; that
 * banner carries the page's single waiting/answered mark pair.
 *
 * The WHOLE card is the link. Advertises the RSS feed via alternates.types
 * and a visible mono link in the header.
 */

const PATH = LIVE_ROUTES.blog;

const base = buildMetadata({
  title: "Business texting guides for service crews",
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
  const [featured, ...rest] = BLOG_POSTS;
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />

      <div className="bg-[color:var(--fr-ground)] py-16 md:py-24">
        <div className="mx-auto w-full max-w-[72rem] px-6 md:px-8">
          <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="max-w-3xl">
              <Breadcrumbs crumbs={crumbs} className="mb-6" />
              <h1 className="font-display text-[2rem] font-extrabold leading-[1.1] tracking-[-0.01em] text-[color:var(--fr-ink)] sm:text-[2.5rem] text-balance">
                The Loonext blog.
              </h1>
              <p className="fr-body mt-5 max-w-2xl text-[color:var(--fr-ink-70)]">
                Plain-English guides on customer texting for small service
                crews: getting the business off one person&apos;s cell, staying
                on the right side of the texting rules, and answering every job
                that comes in.
              </p>
            </div>
            <a
              href="/blog/rss.xml"
              className="fr-mono-data text-[0.8125rem] text-[color:var(--fr-ink-55)] transition-colors duration-200 ease-out hover:text-[color:var(--fr-cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
            >
              RSS feed
            </a>
          </header>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {/* The newest post leads, full-width, banner plate. */}
            <Reveal className="h-full md:col-span-2">
              <FrCard className="h-full p-0">
                <Link
                  href={blogPostPath(featured.slug)}
                  className="group flex h-full flex-col overflow-hidden rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)] md:flex-row"
                >
                  <BlogPlate
                    slug={featured.slug}
                    dateline={featured.dateline}
                    variant="banner"
                    className="aspect-[16/7] w-full md:aspect-auto md:min-h-[16rem] md:w-[55%]"
                  />
                  <div className="flex flex-1 flex-col p-6 md:p-8">
                    <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                      {featured.dateline}
                    </p>
                    <h2 className="font-display mt-3 text-[1.5rem] font-extrabold leading-[1.15] tracking-[-0.01em] text-[color:var(--fr-ink)] transition-colors duration-200 ease-out group-hover:text-[color:var(--fr-cobalt)] md:text-[1.75rem] text-balance">
                      {featured.title}
                    </h2>
                    <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
                      {featured.description}
                    </p>
                    <p className="fr-mono-data mt-auto pt-6 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
                      <time dateTime={featured.datePublishedIso}>
                        {featured.datePublished}
                      </time>
                      {" · "}
                      {featured.readingMinutes} min read
                    </p>
                  </div>
                </Link>
              </FrCard>
            </Reveal>

            {rest.map((post, i) => (
              <Reveal
                key={post.slug}
                delay={Math.min(i, 3) * 60}
                className="h-full"
              >
                <FrCard className="h-full p-0">
                  <Link
                    href={blogPostPath(post.slug)}
                    className="group flex h-full flex-col overflow-hidden rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
                  >
                    <BlogPlate
                      slug={post.slug}
                      dateline={post.dateline}
                      variant="card"
                      className="aspect-[15/7] w-full"
                    />
                    <div className="flex flex-1 flex-col p-6">
                      <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                        {post.dateline}
                      </p>
                      <h2 className="fr-h3 mt-3 text-[color:var(--fr-ink)] transition-colors duration-200 ease-out group-hover:text-[color:var(--fr-cobalt)]">
                        {post.title}
                      </h2>
                      <p className="mt-2 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                        {post.description}
                      </p>
                      <p className="fr-mono-data mt-auto pt-5 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
                        <time dateTime={post.datePublishedIso}>
                          {post.datePublished}
                        </time>
                        {" · "}
                        {post.readingMinutes} min read
                      </p>
                    </div>
                  </Link>
                </FrCard>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
