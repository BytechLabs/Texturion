"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/i18n/provider";

/**
 * The one way to ask a person for help from any signed-out screen (WCAG 2.2
 * 3.2.6 Consistent Help).
 *
 * It lives in the auth layout, not in each page, so it sits in the same place
 * on login, signup, reset-password, update-password and the invite screen
 * without any page having to remember it. Somebody locked out of their account
 * is the reader with the fewest other routes to a human.
 */
export function AuthHelp() {
  const t = useT();
  const pathname = usePathname();
  // The native apps load /native-captcha in a bare WebView with no way out to
  // a marketing page; a link there would navigate the sheet away from the app.
  if (pathname?.startsWith("/native-captcha")) return null;
  return (
    <p className="mt-6 text-center text-sm text-muted-foreground">
      {t("onboarding.authHelpPrompt")}{" "}
      <Link
        href="/contact"
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {t("onboarding.authHelpLink")}
      </Link>
    </p>
  );
}
