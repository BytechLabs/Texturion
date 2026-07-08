import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";

/**
 * Root 404 boundary. This renders OUTSIDE the (marketing) route group, so it
 * cannot use the `.mkt-scope` utilities, marketing components, or the
 * marketing font trio. Everything visual is inlined here: the v4 palette
 * hexes (Signal White ground, Answer Ink, First Blue) and plain flex layout.
 * The root layout still wraps this page, so Inter (font-sans on <body>)
 * applies.
 */

export const metadata: Metadata = {
  title: "Page not found",
};

const ground = "#FBFCFE";
const ink = "#10173B";
const link = "#2740DE";
const muted = "rgba(16, 23, 59, 0.64)";

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
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: ink,
    textDecoration: "none",
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
    color: "#FFFFFF",
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
      <Link href="/" style={styles.wordmark} aria-label="Loonext home">
        Loonext
      </Link>
      <div>
        <p style={styles.eyebrow}>404</p>
        <h1 style={styles.heading}>That page doesn&apos;t exist.</h1>
        <p style={styles.body}>
          The link is old or mistyped. The shared inbox is real, though, and it
          is one click away.
        </p>
      </div>
      <div style={styles.actions}>
        <Link href="/" style={styles.primary}>
          Back to the home page
        </Link>
        <Link href="/pricing" style={styles.secondary}>
          See pricing
        </Link>
      </div>
    </main>
  );
}
