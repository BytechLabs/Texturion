"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { publicEnv } from "@/env";

import {
  CONSENT_CHANGE_EVENT,
  readStoredConsent,
  saveConsentChoice,
  type ConsentChoice,
} from "./consent";

/**
 * The cookie consent banner (#124), mounted by the (marketing) layout and
 * gated on NEXT_PUBLIC_GTM_ID exactly like the GTM loader: no tag manager, no
 * banner — dev, CI, and previews stay banner-free, and the no-JS render never
 * shows it (with JS off the tag manager never loads, so there is nothing to
 * consent to).
 *
 * Shown only while no choice is stored. Both answers carry equal weight (one
 * tap each, same size); "No thanks" stores denied and the Consent Mode v2
 * default stays denied, so tags with consent checks set nothing. The banner
 * OVERLAYS (fixed, bottom) — it never inserts into the page flow, so it can
 * never shift layout (BLUEPRINT §11 CLS law).
 *
 * SSR renders nothing (open starts false and effects only run client-side),
 * so hydration always matches and crawlers never see the banner. The
 * `initialOpen` prop exists so tests can render the open state with
 * renderToStaticMarkup; production never passes it.
 */

/* Banner CSS, prefix "frcc-". One inert style block, unlayered so the base
   declarations beat Tailwind utilities. White card on the card shadow (the
   site's only shadow); cobalt CTA + frost quiet button per §4 Buttons; the
   only transitions are reduced-motion gated. */
const CSS = `
.frcc-card {
  box-shadow: var(--fr-shadow-card);
}
.frcc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.75rem;
  padding: 0 1.25rem;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
}
.frcc-btn:focus-visible,
.frcc-link:focus-visible {
  outline: 2px solid var(--fr-cobalt);
  outline-offset: 2px;
}
.frcc-btn-yes {
  background-color: var(--fr-cobalt);
  color: #ffffff;
}
.frcc-btn-yes:hover {
  background-color: var(--fr-cobalt-deep);
}
.frcc-btn-no {
  background-color: var(--fr-frost);
  color: var(--fr-ink);
}
.frcc-btn-no:hover {
  background-color: rgba(39, 64, 222, 0.12);
}
.frcc-link {
  color: var(--fr-cobalt);
  text-decoration: underline;
  text-underline-offset: 2px;
  border-radius: 2px;
}
@media (prefers-reduced-motion: no-preference) {
  .frcc-btn {
    transition: background-color 200ms ease-out;
  }
}
`;

export function ConsentBanner({ initialOpen }: { initialOpen?: boolean }) {
  // Env gate before any hooks: builds without GTM render nothing, ever.
  if (!publicEnv.NEXT_PUBLIC_GTM_ID) return null;
  return <ConsentBannerInner initialOpen={initialOpen} />;
}

function ConsentBannerInner({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    // No stored choice → ask. A choice saved by ANY consent surface (this
    // banner, or the /legal/cookies preferences control in another part of
    // the page) closes the banner via the shared change event.
    if (readStoredConsent(document.cookie) === null) setOpen(true);
    const onChange = () => setOpen(false);
    window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
  }, []);

  const choose = useCallback((choice: ConsentChoice) => {
    saveConsentChoice(window, choice);
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <div
      role="region"
      aria-label="Cookie choices"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="frcc-card pointer-events-auto mx-auto w-full max-w-2xl rounded-2xl bg-white p-5 sm:p-6">
        <p className="font-body-mkt text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
          <strong className="font-semibold text-[color:var(--fr-ink)]">
            Cookies, your call.
          </strong>{" "}
          We would like to set cookies that show us how people find Loonext and
          help our ads reach the right folks. Say no and we set none of them.
          The signed-in app never uses tracking cookies either way.{" "}
          <Link href="/legal/cookies" className="frcc-link">
            Cookie policy
          </Link>
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="frcc-btn frcc-btn-yes"
            onClick={() => choose("granted")}
          >
            Allow cookies
          </button>
          <button
            type="button"
            className="frcc-btn frcc-btn-no"
            onClick={() => choose("denied")}
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
