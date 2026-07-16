"use client";

import { useCallback } from "react";

import { Turnstile } from "@/components/auth/turnstile";
import { publicEnv } from "@/env";

/**
 * Native-app captcha bridge (#166). The Android/iOS apps load this page in a
 * WebView when Supabase Auth demands a captcha token — Turnstile validates
 * the page's HOSTNAME against the site key, so the widget must live here on
 * app.loonext.com; a token minted on this page is valid for the same Supabase
 * auth calls the web makes.
 *
 * The token is handed to whichever native bridge is present:
 *   Android — window.LoonextCaptcha.postToken(token)  (@JavascriptInterface)
 *   iOS     — window.webkit.messageHandlers.loonextCaptcha.postMessage(token)
 * A human opening this page directly just sees the widget do nothing —
 * a token without credentials is worthless, and the page is noindexed via
 * metadata in layout scope (auth pages are already noindex).
 */

interface AndroidCaptchaBridge {
  postToken: (token: string) => void;
}

interface IosCaptchaBridge {
  postMessage: (token: string) => void;
}

declare global {
  interface Window {
    LoonextCaptcha?: AndroidCaptchaBridge;
    webkit?: { messageHandlers?: { loonextCaptcha?: IosCaptchaBridge } };
  }
}

export default function NativeCaptchaPage() {
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const handleToken = useCallback((token: string | null) => {
    if (!token) return;
    window.LoonextCaptcha?.postToken(token);
    window.webkit?.messageHandlers?.loonextCaptcha?.postMessage(token);
  }, []);

  return (
    <main className="flex min-h-svh items-center justify-center bg-background">
      {siteKey ? (
        <Turnstile siteKey={siteKey} onToken={handleToken} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Captcha isn&apos;t configured in this environment.
        </p>
      )}
    </main>
  );
}
