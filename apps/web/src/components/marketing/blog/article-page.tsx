import { Dateline } from "@/components/marketing/fr";
import { FeatureCta } from "@/components/marketing/features/feature-page";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import type { BlogPost } from "@/lib/marketing/blog";
import { blogPostPath } from "@/lib/marketing/blog";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { blogPostingJsonLd, breadcrumbJsonLd } from "@/lib/marketing/seo";

/**
 * ARTICLE template (#127): the quiet register, same 68ch single column as
 * LEGAL (DESIGN-DIRECTION v4 §6) because long-form reading wants the same
 * restraint. The one v4 flourish an article keeps is the ink Dateline chip
 * above the H1. No art, no hairline rules, separation is space alone.
 *
 * Ends on the standard Frost CTA band: an article that earns a read earns
 * the pitch, and the CTA copy stays in the site-wide register.
 */
export function ArticlePage({
  post,
  ctaHeading = "Give your crew one inbox to share.",
  ctaSub = "A local business number and a shared text inbox the whole team can see, live in minutes. See the price, pay, and start today.",
  children,
}: {
  post: BlogPost;
  ctaHeading?: string;
  ctaSub?: string;
  children: React.ReactNode;
}) {
  const path = blogPostPath(post.slug);
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Blog", path: LIVE_ROUTES.blog },
          { name: post.title, path },
        ])}
      />
      <JsonLd
        data={blogPostingJsonLd({
          headline: post.title,
          description: post.description,
          path,
          datePublishedIso: post.datePublishedIso,
        })}
      />

      <div className="bg-[color:var(--fr-ground)] py-16 md:py-24">
        <article className="mx-auto w-full max-w-[68ch] px-6 md:px-8">
          <header>
            <Dateline>{post.dateline}</Dateline>
            <h1 className="font-display mt-5 text-[2rem] font-extrabold leading-[1.1] tracking-[-0.01em] text-[color:var(--fr-ink)] sm:text-[2.5rem] text-balance">
              {post.title}
            </h1>
            <p className="fr-mono-data mt-4 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
              <time dateTime={post.datePublishedIso}>{post.datePublished}</time>
              {" · "}
              {post.readingMinutes} min read
            </p>
          </header>

          <div className="mt-12 space-y-12">{children}</div>
        </article>
      </div>

      <FeatureCta heading={ctaHeading} sub={ctaSub} />
    </>
  );
}

/**
 * The article lede: the opening paragraphs before the first heading, set in
 * full-ink body so the hook reads a shade heavier than the sections below.
 */
export function ArticleLede({ children }: { children: React.ReactNode }) {
  return (
    <div className="fr-body space-y-4 text-[color:var(--fr-ink)]">
      {children}
    </div>
  );
}

/** An anchored h2 section in the article's prose register. */
export function ArticleSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="fr-h3 text-[color:var(--fr-ink)]">{heading}</h2>
      <div className="fr-body mt-3 space-y-4 text-[color:var(--fr-ink-70)]">
        {children}
      </div>
    </section>
  );
}

/** Bulleted list in the prose register (same idiom as the legal pages). */
export function ArticleList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6">{children}</ul>;
}

/** Inline cobalt link; identical anatomy to legal prose links. */
export { LegalLink as ArticleLink } from "@/components/marketing/legal/legal-page";
