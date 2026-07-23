"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";
import Link from "next/link";

import { publicEnv } from "@/env";

/**
 * Root error boundary: catches any render throw outside the (app) group's own
 * boundary (marketing pages, auth, onboarding) so visitors never see the
 * unbranded Next.js failure screen. Mirrors the (app)/error.tsx recovery
 * pattern: one honest retry via `reset()`, which re-renders the errored
 * segment.
 *
 * Like not-found.tsx, this renders outside the marketing scope, so all
 * styling is inlined (v4 palette hexes); the root layout still applies, so
 * Inter comes from <body>.
 */

/**
 * Best-effort Sentry report, shared with global-error.tsx. Guarded on the
 * OPTIONAL NEXT_PUBLIC_SENTRY_DSN (unset = observability off = silent no-op,
 * and the @sentry/browser chunk is never fetched). The SDK singleton was
 * already initialized by instrumentation-client.ts when the DSN is set, so
 * this import resolves to the same, configured client. Never rejects: error
 * reporting must not break the error page itself.
 */
export async function reportBoundaryError(
  error: Error & { digest?: string },
): Promise<void> {
  if (!publicEnv.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/browser");
    Sentry.captureException(error);
  } catch (cause) {
    console.error("Sentry capture failed:", cause);
  }
}

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
    fontWeight: 600,
    letterSpacing: "-0.02em",
    color: ink,
    textDecoration: "none",
  },
  /* The wordmark rule (#206): the SECOND o in brand olive. Inline style on
     purpose — this boundary is self-contained (no brand font, no scoped
     classes); the colored-o span is the rule that always holds. */
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
  body: {
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

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Console for local debugging; Sentry (when configured) for production.
    console.error("Root boundary error", error);
    void reportBoundaryError(error);
  }, [error]);

  return (
    <main style={styles.main}>
      <Link href="/" style={styles.wordmark} aria-label="Loonext home">
        Lo<span style={styles.wordmarkO}>o</span>next
      </Link>
      <div>
        <h1 style={styles.heading}>Something broke on our side.</h1>
        <p style={styles.body}>
          It was nothing you did. Try the page again; if it keeps failing,{" "}
          <Link href="/contact" style={styles.secondary}>
            tell us what you were doing
          </Link>{" "}
          and we will look into it.
        </p>
        {error.digest ? (
          <p style={styles.digest}>Reference: {error.digest}</p>
        ) : null}
      </div>
      <div style={styles.actions}>
        <button type="button" onClick={reset} style={styles.retry}>
          Try again
        </button>
        <Link href="/" style={styles.secondary}>
          Back to the home page
        </Link>
      </div>
    </main>
  );
}
