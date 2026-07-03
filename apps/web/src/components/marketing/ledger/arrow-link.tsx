/**
 * ArrowLink (iteration 5, REFERENCES craft #14 / ELEVATE #6).
 *
 * The secondary-CTA treatment: an arrow that starts collapsed (`width:0;
 * opacity:0`) and expands on hover/focus while the label holds, 300ms
 * cubic-bezier. Rollups' tactile hover-arrow-expand. Applied to every quiet
 * text link ("See how it works", "Get your number", "See your inbox"), so the
 * quiet links read finished, not unfinished, WITHOUT competing with the one
 * magnetic petrol primary (CONVERSION §2, the primary always out-weighs).
 *
 * The `.jt-arrow-link` / `.jt-arrow` styles live in ledger.css.tsx; reduced
 * motion renders the arrow expanded (no transition). Renders as a Next <Link>
 * for internal routes or an <a> for on-page anchors.
 */

import Link from "next/link";

import { cn } from "@/lib/utils";

export function ArrowLink({
  href,
  children,
  className,
  anchor = false,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** Render a plain <a> (for on-page #anchors) instead of a Next <Link>. */
  anchor?: boolean;
}) {
  const inner = (
    <>
      {children}
      <span className="jt-arrow inline-flex shrink-0 items-center" aria-hidden>
        <svg
          viewBox="0 0 16 16"
          className="ml-0.5 size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8h9" />
          <path d="m9 4 4 4-4 4" />
        </svg>
      </span>
    </>
  );

  const cls = cn(
    // Marketing accent = the explicit --petrol token (#0F766E, 4.54:1 on the
    // paper ground, AA). NOT the app `--primary`, which flips to teal-500
    // (#00BBA7, only 2.0:1 on paper) inside any `.dark` region and failed the
    // color-contrast audit. Petrol is fixed across light/dark, so the quiet
    // links stay legible everywhere on the marketing surface.
    "jt-arrow-link group inline-flex items-center text-[15px] font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--petrol)]/60 rounded-sm",
    className,
  );

  if (anchor) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}
