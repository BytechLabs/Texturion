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
 * — never lorem). The `sections` array drives the TOC and must match the
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
          <header className="mb-10 border-b border-border pb-8">
            <p className="text-sm text-muted-foreground">Legal</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {title}
            </h1>
            {intro && (
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                {intro}
              </p>
            )}
            <p className="mt-6 text-sm text-muted-foreground">
              Last updated{" "}
              <time dateTime="2026-07-02" className="font-medium text-foreground/80">
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
            className="sticky top-24 border-l border-border pl-4"
          >
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              On this page
            </p>
            <ul className="space-y-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`#${s.id}`}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
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
      className="font-medium text-primary underline-offset-4 hover:underline"
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
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        {heading}
      </h2>
      <div className="mt-3 space-y-4 leading-relaxed text-foreground/80">
        {children}
      </div>
    </section>
  );
}
