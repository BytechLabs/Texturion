"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";

/**
 * Cloudflare Turnstile widget (SPEC §10 front door). Rendered on the auth
 * screens only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is configured; Supabase
 * Auth verifies the token server-side, so the pages block submit until the
 * widget hands one over.
 *
 * The challenge script is loaded here with the explicit render API — no npm
 * dependency, one shared script tag per session.
 */

/** Imperative surface for parents: Supabase consumes a captcha token on every
 *  auth attempt (they're single-use), so a failed submit must reset the widget
 *  to mint a fresh token before the user retries. */
export interface TurnstileHandle {
  reset: () => void;
}

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// One script tag per session, shared across auth pages (client-side nav keeps
// this module alive). Reset on failure so a remount can retry the load.
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load the Turnstile script."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({
  siteKey,
  onToken,
  ref,
}: {
  siteKey: string;
  /** Called with a fresh token, and with null when the token expires or the
   *  challenge errors — the parent must re-block submit on null. */
  onToken: (token: string | null) => void;
  ref?: Ref<TurnstileHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Track the latest callback without re-rendering the widget when the parent
  // re-renders with a new function identity.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  });

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        if (widgetIdRef.current !== null) {
          window.turnstile?.reset(widgetIdRef.current);
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        // Script blocked or offline: no widget means no token, so submit
        // stays gated — surface why instead of a silently dead button.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  return (
    <div data-slot="turnstile" className="space-y-2">
      {/* min-height matches the normal-size widget (65px) to avoid the form
          jumping when the challenge iframe appears. Named as a group so the
          injected challenge iframe has context in the accessibility tree. */}
      <div
        ref={containerRef}
        role="group"
        aria-label="Security check"
        className="min-h-[65px]"
      />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t load the security check. Refresh the page and try
          again.
        </p>
      )}
    </div>
  );
}
