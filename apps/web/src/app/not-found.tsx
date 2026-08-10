import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";

import { EN } from "@/i18n/catalog";

/**
 * Root 404 boundary. This renders OUTSIDE the (marketing) route group, so it
 * cannot use the `.mkt-scope` utilities, marketing components, or the
 * marketing font trio. Everything visual is inlined here: the v4 palette
 * hexes (Signal White ground, Answer Ink, First Blue) and plain flex layout.
 * The root layout still wraps this page, so Inter (font-sans on <body>)
 * applies.
 */

/**
 * #228: a 404 is English, and the strings are still in the catalogue.
 *
 * There is no `LocaleProvider` above this page and there cannot be one — the
 * whole point of a 404 is that no route matched, so there is no company, no
 * session and no member setting to resolve a language from. We know nothing
 * about the reader at the moment this renders, and guessing from
 * `Accept-Language` on the one page that also serves crawlers would make the
 * cached HTML a coin flip.
 *
 * So the words are read straight off the English catalogue. The keys live
 * there anyway, next to the error boundaries' for the same reason: a
 * translator can see the sentences, and the day a locale can be resolved here
 * this becomes a change of argument rather than a re-extraction.
 *
 * NOT `makeTranslate(DEFAULT_LOCALE)`, which is the pattern everywhere else.
 * It is exported from `i18n/provider.tsx`, and that file is `"use client"` —
 * so every export of it is a client reference, and calling one while
 * rendering on the server is a build failure, not a runtime fallback:
 *
 *   Failed to collect configuration for /_not-found
 *   Attempted to call makeTranslate() from the server but makeTranslate is
 *   on the client.
 *
 * `catalog.ts` carries no directive, so reading it here is server-safe. None
 * of these four strings interpolates, so nothing of `makeTranslate` is
 * missed; a surface that needs a token has to wait for the lookup to move out
 * of the client module.
 */
const copy = EN.misc;

export const metadata: Metadata = {
  title: copy.notFoundTitle,
};

const ground = "#F3F3EE";
const ink = "#191B14";
const link = "#3A430F";
const muted = "rgba(25, 27, 20, 0.64)";

const styles = {
  main: {
    minHeight: "100svh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.75rem",
    padding: "4rem 1.5rem",
    textAlign: "center",
    backgroundColor: ground,
    color: ink,
  },
  wordmark: {
    fontSize: "1.125rem",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: ink,
    textDecoration: "none",
  },
  /* The wordmark rule (#206): the SECOND o in brand olive. Inline style on
     purpose — this page is self-contained, so the brand face (Golos) can't
     mount here; the colored-o span is the rule that always holds. */
  wordmarkO: {
    color: "#66801F",
  },
  eyebrow: {
    margin: 0,
    fontSize: "0.8125rem",
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: muted,
  },
  heading: {
    margin: "0.5rem 0 0",
    fontSize: "clamp(1.75rem, 4vw, 2.375rem)",
    fontWeight: 650,
    letterSpacing: "-0.025em",
    lineHeight: 1.15,
  },
  body: {
    margin: "0.875rem auto 0",
    maxWidth: "26rem",
    fontSize: "1rem",
    lineHeight: 1.6,
    color: muted,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.25rem",
  },
  primary: {
    display: "inline-block",
    padding: "0.625rem 1.375rem",
    borderRadius: "999px",
    backgroundColor: link,
    color: "#FDFDF9",
    fontSize: "0.9375rem",
    fontWeight: 600,
    textDecoration: "none",
  },
  secondary: {
    color: link,
    fontSize: "0.9375rem",
    fontWeight: 600,
    textDecoration: "underline",
    textUnderlineOffset: "4px",
  },
} satisfies Record<string, CSSProperties>;

export default function NotFound() {
  return (
    <main style={styles.main}>
      <Link href="/" style={styles.wordmark} aria-label={copy.homeAria}>
        Lo<span style={styles.wordmarkO}>o</span>next
      </Link>
      <div>
        {/* The one string that is not in the catalogue: 404 is the same
            three digits in every language this product will ever speak. */}
        <p style={styles.eyebrow}>404</p>
        <h1 style={styles.heading}>{copy.notFoundHeading}</h1>
        <p style={styles.body}>{copy.notFoundBody}</p>
      </div>
      <div style={styles.actions}>
        <Link href="/" style={styles.primary}>
          {copy.backToHome}
        </Link>
        <Link href="/pricing" style={styles.secondary}>
          {copy.seePricing}
        </Link>
      </div>
    </main>
  );
}
