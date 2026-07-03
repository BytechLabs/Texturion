import Link from "next/link";

import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Container } from "@/components/marketing/ui/container";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

export interface LegalSection {
  id: string;
  heading: string;
}

/**
 * Shared layout for legal & trust pages (BLUEPRINT §9): a readable measure
 * (~68ch), a sticky table of contents on desktop, a last-updated date, and a
 * BreadcrumbList (§11.2). Content is passed as children (real, substantive copy
 *, never lorem). The `sections` array drives the TOC and must match the
 * children's section ids.
 */
export function LegalPage({
  title,
  intro,
  lastUpdated,
  breadcrumbLabel,
  path,
  sections,
  children,
}: {
  title: string;
  intro?: string;
  /** Human display date, e.g. "July 2, 2026". */
  lastUpdated: string;
  breadcrumbLabel: string;
  path: string;
  sections: LegalSection[];
  children: React.ReactNode;
}) {
  return (
    <Container className="py-16 sm:py-20">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: breadcrumbLabel, path },
        ])}
      />
      <div className="lg:grid lg:grid-cols-[1fr_16rem] lg:gap-12">
        <article className="mx-auto w-full max-w-[68ch]">
          <header className="mb-10 border-b border-[color:var(--hairline)] pb-8">
            {/* Mono meta eyebrow with the petrol rule (no number, §0). */}
            <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
              <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
              Legal
            </p>
            {/* The Basteleur display face on the legal H1 (DESIGN-DIRECTION §3:
                legal headers wear the identity). Kept at a calm, readable scale,
                legal stays quiet but wears the brand lettering. */}
            <h1 className="font-display mt-3 text-[32px] font-bold leading-tight tracking-[-0.01em] text-[color:var(--ink)] sm:text-[40px]">
              {title}
            </h1>
            {intro && (
              <p className="mt-4 text-lg leading-relaxed text-[color:var(--ink-70)]">
                {intro}
              </p>
            )}
            <p className="font-mono-mkt mt-6 text-[13px] text-[color:var(--graphite)]">
              Last updated{" "}
              <time dateTime="2026-07-02" className="font-medium text-[color:var(--ink)]">
                {lastUpdated}
              </time>
              .
            </p>
          </header>

          <div className="space-y-10">{children}</div>
        </article>

        {/* Sticky TOC (desktop) */}
        <aside className="hidden lg:block">
          <nav
            aria-label="On this page"
            className="sticky top-24 border-l border-[color:var(--hairline)] pl-4"
          >
            <p className="font-mono-mkt mb-3 text-[12px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
              On this page
            </p>
            <ul className="space-y-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`#${s.id}`}
                    className="text-sm text-[color:var(--ink-70)] transition-colors hover:text-[color:var(--petrol)]"
                  >
                    {s.heading}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </Container>
  );
}

/** Inline petrol link for use inside legal prose (internal routes or mailto). */
export function LegalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="font-medium text-[color:var(--petrol)] underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}

/** A numbered/anchored section within a legal page (scroll-margin for the TOC). */
export function LegalSectionBlock({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-[20px] font-bold tracking-[-0.005em] text-[color:var(--ink)]">
        {heading}
      </h2>
      <div className="mt-3 space-y-4 leading-relaxed text-[color:var(--ink-70)]">
        {children}
      </div>
    </section>
  );
}
