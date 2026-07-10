"use client";

import { useCallback, useEffect, useState } from "react";

import { publicEnv } from "@/env";

import {
  CONSENT_CHANGE_EVENT,
  readStoredConsent,
  saveConsentChoice,
  type ConsentChoice,
} from "./consent";

/**
 * The change-your-mind control (#124), embedded in /legal/cookies "Your
 * choices" so withdrawing consent is as easy as giving it (GDPR art. 7(3)).
 * Gated on NEXT_PUBLIC_GTM_ID like the banner and the GTM loader: builds
 * without a tag manager have nothing to consent to, so the control renders
 * nothing and the page's <noscript>/browser-controls copy carries the story.
 *
 * SSR renders only the reserved well (effects never run server-side), so
 * hydration always matches and mounting never shifts the section. The page
 * pairs it with a <noscript> line, because with JS off the tag manager never
 * loads at all.
 */

/* Preferences CSS, prefix "frcp-": a frost well (the site's only wash) with
   the same pill grammar as the banner. */
const CSS = `
.frcp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.5rem;
  padding: 0 1.125rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
  background-color: #ffffff;
  color: var(--fr-ink);
}
.frcp-btn:hover {
  background-color: rgba(39, 64, 222, 0.08);
}
.frcp-btn:focus-visible {
  outline: 2px solid var(--fr-cobalt);
  outline-offset: 2px;
}
.frcp-btn[aria-pressed="true"] {
  background-color: var(--fr-cobalt);
  color: #ffffff;
}
@media (prefers-reduced-motion: no-preference) {
  .frcp-btn {
    transition: background-color 200ms ease-out;
  }
}
`;

export function ConsentPreferences() {
  // Env gate before any hooks: builds without GTM render nothing.
  if (!publicEnv.NEXT_PUBLIC_GTM_ID) return null;
  return <ConsentPreferencesInner />;
}

function ConsentPreferencesInner() {
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);

  useEffect(() => {
    const adopt = () => setChoice(readStoredConsent(document.cookie));
    adopt();
    setMounted(true);
    // A choice saved anywhere (the banner included) updates this control.
    window.addEventListener(CONSENT_CHANGE_EVENT, adopt);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, adopt);
  }, []);

  const choose = useCallback((next: ConsentChoice) => {
    saveConsentChoice(window, next);
    setChoice(next);
  }, []);

  return (
    <div className="min-h-28 rounded-xl bg-[color:var(--fr-frost)] p-5">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {mounted ? (
        <ConsentPreferencesPanel choice={choice} onChoose={choose} />
      ) : null}
    </div>
  );
}

/**
 * The presentational panel, exported for unit tests (effects never run under
 * renderToStaticMarkup, so tests drive the states through props instead).
 */
export function ConsentPreferencesPanel({
  choice,
  onChoose,
}: {
  choice: ConsentChoice | null;
  onChoose: (choice: ConsentChoice) => void;
}) {
  return (
    <>
      <p
        aria-live="polite"
        className="font-body-mkt text-sm leading-relaxed text-[color:var(--fr-ink)]"
      >
        {choice === "granted"
          ? "Your current choice: cookies allowed."
          : choice === "denied"
            ? "Your current choice: no optional cookies."
            : "You have not made a choice yet, so no optional cookies are set."}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className="frcp-btn"
          aria-pressed={choice === "granted"}
          onClick={() => onChoose("granted")}
        >
          Allow cookies
        </button>
        <button
          type="button"
          className="frcp-btn"
          aria-pressed={choice === "denied"}
          onClick={() => onChoose("denied")}
        >
          No thanks
        </button>
      </div>
    </>
  );
}
