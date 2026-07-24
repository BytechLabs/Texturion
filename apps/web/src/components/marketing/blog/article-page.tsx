import { Dateline } from "@/components/marketing/fr";
import { BlogPlate } from "@/components/marketing/blog/blog-plate";
import { FeatureCta } from "@/components/marketing/features/feature-page";
import { Breadcrumbs } from "@/components/marketing/ui/breadcrumbs";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import type { BlogPost } from "@/lib/marketing/blog";
import { blogPostPath } from "@/lib/marketing/blog";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import {
  blogPostingJsonLd,
  breadcrumbJsonLd,
  type Breadcrumb,
} from "@/lib/marketing/seo";

/**
 * ARTICLE template (#127): the quiet register, same 68ch single column as
 * LEGAL (DESIGN-DIRECTION v4 §6) because long-form reading wants the same
 * restraint. The header opens on the post's banner plate (deterministic art
 * from the slug, lib/marketing/blog-art — the page's single waiting/answered
 * mark pair) above the ink Dateline chip and the H1. Inline SVG geometry is
 * not an LCP candidate, so the H1 stays the LCP; the plate box has a fixed
 * aspect ratio, so CLS stays 0. No hairline rules; separation is space alone.
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
  // One crumb trail feeds BOTH the BreadcrumbList JSON-LD (search engines) and
  // the visible <nav> trail (humans + a11y), so the two can never disagree.
  const crumbs: Breadcrumb[] = [
    { name: "Home", path: "/" },
    { name: "Blog", path: LIVE_ROUTES.blog },
    { name: post.title, path },
  ];
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd
        data={blogPostingJsonLd({
          headline: post.title,
          description: post.description,
          path,
          datePublishedIso: post.datePublishedIso,
          imagePath: `/og/blog/${post.slug}`,
        })}
      />

      <div className="bg-[color:var(--fr-ground)] py-16 md:py-24">
        <article className="mx-auto w-full max-w-[68ch] px-6 md:px-8">
          <header>
            <Breadcrumbs crumbs={crumbs} className="mb-6" />
            <BlogPlate
              slug={post.slug}
              dateline={post.dateline}
              variant="banner"
              className="aspect-[16/5] w-full rounded-[12px]"
            />
            <Dateline className="mt-8">{post.dateline}</Dateline>
            <h1 className="font-display mt-5 text-[2rem] font-extrabold leading-[1.1] tracking-[-0.01em] text-[color:var(--fr-ink)] sm:text-[2.5rem] text-balance">
              {post.title}
            </h1>
            <p className="fr-mono-data mt-4 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
              <time dateTime={post.datePublishedIso}>{post.datePublished}</time>
              {" · "}
              {post.readingMinutes} min read
            </p>
          </header>

          {/* MDX content (#130): the mdx-components map (src/mdx-components.tsx)
              owns the inter-element rhythm since MDX renders a flat sibling
              list, so the wrapper only sets the gap from the header and zeroes
              the first element's own top margin. */}
          <div className="mt-12 [&>:first-child]:mt-0">{children}</div>
        </article>
      </div>

      <FeatureCta heading={ctaHeading} sub={ctaSub} />
    </>
  );
}

/**
 * Inline cobalt link; identical anatomy to legal prose links. The blog authors
 * in MDX now, so this is the ONE article component left — src/mdx-components.tsx
 * maps Markdown `[text](href)` onto it. Headings, paragraphs, and lists are
 * mapped there too, so the old ArticleLede/ArticleSection/ArticleList JSX
 * helpers retired with the TSX posts (#130).
 */
export { LegalLink as ArticleLink } from "@/components/marketing/legal/legal-page";
