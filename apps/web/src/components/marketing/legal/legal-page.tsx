import Link from "next/link";

import { Dateline } from "@/components/marketing/fr";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";

export interface LegalSection {
  id: string;
  /** Mono section number, e.g. "1". Omit for unnumbered sections. */
  number?: string;
  heading: string;
}

/**
 * LEGAL template (DESIGN-DIRECTION v4 §6 LEGAL, COPY-DECK v2): the quiet
 * register. A single 68ch column of Hanken 17px body, mono section numbers,
 * and the Frost "Plain English summary" chip on top carrying a 3 or 4
 * sentence TRUE summary of the page. No datelines, no art, no hairline rules
 * (Law 10: separation is space alone). The system's restraint is the
 * credibility.
 *
 * Content is passed as children (real, substantive copy, never lorem). The
 * `sections` array drives the quiet contents list and must match the
 * children's section ids.
 */
export function LegalPage({
  title,
  summary,
  lastUpdated,
  lastUpdatedIso = "2026-07-02",
  breadcrumbLabel,
  path,
  sections,
  children,
}: {
  title: string;
  /** The plain English summary: 3 or 4 sentences, every one true. */
  summary: string;
  /** Human display date, e.g. "July 2, 2026". */
  lastUpdated: string;
  /** ISO date for the <time> element, e.g. "2026-07-02". Defaults to the
   * launch-set date the original four legal pages share. */
  lastUpdatedIso?: string;
  breadcrumbLabel: string;
  path: string;
  sections: LegalSection[];
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[color:var(--fr-ground)] py-16 md:py-24">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: breadcrumbLabel, path },
        ])}
      />
      <article className="mx-auto w-full max-w-[68ch] px-6 md:px-8">
        <header>
          <h1 className="font-display text-[2rem] font-extrabold leading-[1.1] tracking-[-0.01em] text-[color:var(--fr-ink)] sm:text-[2.5rem] text-balance">
            {title}
          </h1>
          <p className="fr-mono-data mt-4 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
            Last updated{" "}
            <time dateTime={lastUpdatedIso}>{lastUpdated}</time>
          </p>

          {/* The one chip legal pages get (§5.1): Frost, ink text, and under
              it the true summary in plain English. */}
          <div className="mt-8 rounded-xl bg-[color:var(--fr-frost)] p-5 sm:p-6">
            <Dateline tone="frost" className="bg-white">
              Plain English summary
            </Dateline>
            <p className="fr-body mt-3 text-[color:var(--fr-ink)]">{summary}</p>
          </div>

          {/* Quiet contents: mono numbers, no box, no rules. */}
          <nav aria-label="Contents" className="mt-8">
            <ol className="space-y-1.5">
              {sections.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`#${s.id}`}
                    className="group inline-flex items-baseline gap-2.5 text-[0.9375rem] text-[color:var(--fr-ink-70)] transition-colors duration-200 ease-out hover:text-[color:var(--fr-cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
                  >
                    <span
                      className="fr-mono-data w-6 shrink-0 text-right text-[0.75rem] text-[color:var(--fr-ink-55)] group-hover:text-[color:var(--fr-cobalt)]"
                      aria-hidden="true"
                    >
                      {s.number ?? "·"}
                    </span>
                    {s.heading}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
        </header>

        <div className="mt-14 space-y-12">{children}</div>
      </article>
    </div>
  );
}

/** Inline cobalt link for legal prose (internal routes or mailto). */
export function LegalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const className =
    "font-medium text-[color:var(--fr-cobalt)] underline decoration-[color:var(--fr-cobalt)]/35 underline-offset-4 transition-colors duration-200 ease-out hover:decoration-[color:var(--fr-cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]";
  // Internal path → client-side navigation (no full page reload / re-download).
  // Hash anchors, mailto:, and external http(s) links stay a plain <a>.
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * A numbered, anchored section: the mono section number sits in the margin
 * beat before a Hanken 700 heading (§6 LEGAL "mono section numbers").
 */
export function LegalSectionBlock({
  id,
  number,
  heading,
  children,
}: {
  id: string;
  /** Mono section number, e.g. "1". Omit for unnumbered sections. */
  number?: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="flex items-baseline gap-3">
        {number && (
          <span
            className="fr-mono-data shrink-0 text-[0.8125rem] text-[color:var(--fr-ink-55)]"
            aria-hidden="true"
          >
            {number.padStart(2, "0")}
          </span>
        )}
        <span className="fr-h3 text-[color:var(--fr-ink)]">{heading}</span>
      </h2>
      <div className="fr-body mt-3 space-y-4 text-[color:var(--fr-ink-70)]">
        {children}
      </div>
    </section>
  );
}
