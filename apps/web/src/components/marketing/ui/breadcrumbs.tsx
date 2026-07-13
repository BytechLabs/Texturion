import Link from "next/link";

import type { Breadcrumb } from "@/lib/marketing/seo";

/**
 * Visual breadcrumb trail (#130), the human-visible companion to the
 * BreadcrumbList JSON-LD the same pages already emit for search engines. The
 * LAST crumb is the current page: rendered as plain text with
 * `aria-current="page"`, never a link. Every earlier crumb links to its path.
 *
 * A quiet mono-eyebrow register so it never competes with the H1 it sits above,
 * matching the blog/legal reading surfaces.
 */
export function Breadcrumbs({
  crumbs,
  className = "",
}: {
  crumbs: Breadcrumb[];
  className?: string;
}) {
  if (crumbs.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className={`fr-mono-data text-[0.75rem] text-[color:var(--fr-ink-55)] ${className}`.trim()}
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={crumb.path} className="flex items-center gap-x-2">
              {isLast ? (
                <span aria-current="page" className="text-[color:var(--fr-ink-70)]">
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link
                    href={crumb.path}
                    className="transition-colors duration-200 ease-out hover:text-[color:var(--fr-cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
                  >
                    {crumb.name}
                  </Link>
                  <span aria-hidden className="text-[color:var(--fr-ink-55)]">
                    /
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
