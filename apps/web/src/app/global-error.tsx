"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";

import { reportBoundaryError } from "./error";

/**
 * Last-resort boundary: catches a throw in the ROOT layout itself, where
 * error.tsx cannot help. Next.js replaces the entire document with this
 * component, so it must render its own <html>/<body> and cannot rely on
 * anything the root layout provides: no globals.css, no next/font Inter, no
 * <Link> router context worth trusting. Hence the system font stack, inline
 * v4 palette styling, and plain anchors.
 *
 * Same recovery contract as error.tsx: report to Sentry (when configured),
 * offer `reset()`.
 */

const ground = "#FBFCFE";
const ink = "#10173B";
const link = "#2740DE";
const muted = "rgba(16, 23, 59, 0.64)";

const styles = {
  body: {
    margin: 0,
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    WebkitFontSmoothing: "antialiased",
    backgroundColor: ground,
    color: ink,
  },
  main: {
    minHeight: "100svh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.75rem",
    padding: "4rem 1.5rem",
    textAlign: "center",
  },
  wordmark: {
    fontSize: "1.125rem",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: ink,
    textDecoration: "none",
  },
  /* The wordmark rule (#206): the SECOND o in brand olive. Inline style on
     purpose — this boundary renders without the root layout, so no brand
     font and no classes; the colored-o span is the rule that always holds. */
  wordmarkO: {
    color: "#66801F",
  },
  heading: {
    margin: 0,
    fontSize: "clamp(1.75rem, 4vw, 2.375rem)",
    fontWeight: 650,
    letterSpacing: "-0.025em",
    lineHeight: 1.15,
  },
  bodyText: {
    margin: "0.875rem auto 0",
    maxWidth: "26rem",
    fontSize: "1rem",
    lineHeight: 1.6,
    color: muted,
  },
  digest: {
    margin: "0.75rem 0 0",
    fontSize: "0.8125rem",
    color: muted,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: "1.25rem",
  },
  retry: {
    padding: "0.625rem 1.375rem",
    borderRadius: "999px",
    border: "none",
    backgroundColor: link,
    color: "#FFFFFF",
    font: "inherit",
    fontSize: "0.9375rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  secondary: {
    color: link,
    fontSize: "0.9375rem",
    fontWeight: 600,
    textDecoration: "underline",
    textUnderlineOffset: "4px",
  },
} satisfies Record<string, CSSProperties>;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global boundary error", error);
    void reportBoundaryError(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={styles.body}>
        <main style={styles.main}>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
              the root layout (and with it the router tree) just crashed; a
              plain full-document navigation is deliberate here. */}
          <a href="/" style={styles.wordmark} aria-label="Loonext home">
            Lo<span style={styles.wordmarkO}>o</span>next
          </a>
          <div>
            <h1 style={styles.heading}>Something broke on our side.</h1>
            <p style={styles.bodyText}>
              It was nothing you did. Try again; if it keeps failing, come back
              in a few minutes.
            </p>
            {error.digest ? (
              <p style={styles.digest}>Reference: {error.digest}</p>
            ) : null}
          </div>
          <div style={styles.actions}>
            <button type="button" onClick={reset} style={styles.retry}>
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                deliberate full-document navigation, see the wordmark note. */}
            <a href="/" style={styles.secondary}>
              Back to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
