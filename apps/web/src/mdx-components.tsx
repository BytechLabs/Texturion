import type { MDXComponents } from "mdx/types";

import { ArticleLink } from "@/components/marketing/blog/article-page";

/**
 * MDX element → component map (#130), the Next App Router convention. Only the
 * blog authors in MDX, so this map IS the article prose register — the same
 * quiet 68ch look the hand-authored TSX posts had, now applied to plain
 * Markdown. Inter-element rhythm lives here (headings breathe, paragraphs and
 * lists sit closer) instead of a wrapper's `space-y`, because MDX renders a
 * FLAT list of siblings. rehype-slug (next.config) stamps each heading with an
 * id, which we spread through so in-article anchors keep resolving.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h2: ({ children, ...props }) => (
      <h2
        {...props}
        className="fr-h3 mt-12 scroll-mt-28 text-[color:var(--fr-ink)]"
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3
        {...props}
        className="fr-h3 mt-10 scroll-mt-28 text-[color:var(--fr-ink)]"
      >
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className="fr-body mt-5 text-[color:var(--fr-ink-70)]">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="fr-body mt-5 list-disc space-y-2 pl-6 text-[color:var(--fr-ink-70)]">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="fr-body mt-5 list-decimal space-y-2 pl-6 text-[color:var(--fr-ink-70)]">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-[1.6]">{children}</li>,
    a: ({ href, children }) => (
      <ArticleLink href={href ?? "#"}>{children}</ArticleLink>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-[color:var(--fr-ink)]">
        {children}
      </strong>
    ),
    ...components,
  };
}
