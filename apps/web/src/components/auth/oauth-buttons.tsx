"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authErrorMessage } from "@/lib/auth/messages";
import { oauthRedirectTo, type OAuthProvider } from "@/lib/auth/oauth";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * "Continue with Google" (D18 / APP-FEATURES-V2 §1.1, §1.3, §1.7).
 * Stone-outlined, Google mark, full-width, stacked ABOVE the email form so the
 * one petrol element on the screen stays the primary email submit / "Continue"
 * action (accent budget — APP-UI-ELEVATION).
 *
 * Runs supabase.auth.signInWithOAuth (PKCE), sending the provider to
 * /auth/callback?next=… on this origin. On the redirect back, the callback
 * Route Handler exchanges the code and routes on membership (existing company →
 * /inbox; no company → onboarding — never auto-creates a company).
 *
 * Google is the only SSO provider offered. Its Google Cloud OAuth Web client
 * (client id + secret) is a Supabase-dashboard config item, not shipped here —
 * see lib/auth/oauth.ts.
 */
export function OAuthButtons({ next }: { next?: string | null }) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: OAuthProvider) {
    setError(null);
    setPending(provider);
    // signInWithOAuth navigates away on success; on failure it returns an
    // error and we stay on the page.
    const { error: oauthError } = await getSupabaseBrowser().auth.signInWithOAuth(
      {
        provider,
        options: { redirectTo: oauthRedirectTo(window.location.origin, next) },
      },
    );
    if (oauthError) {
      setError(authErrorMessage(oauthError));
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null}
          onClick={() => void signIn("google")}
        >
          <GoogleMark />
          {pending === "google" ? "Opening Google…" : "Continue with Google"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {/* Divider — quiet stone rule with a centered label (§1.7 calm). */}
      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-border" aria-hidden />
        <span className="text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
    </div>
  );
}

/** Google "G" mark, inline (CSP blocks remote assets). Provider brand colors. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
