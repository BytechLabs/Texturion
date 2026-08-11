import { AuthError } from "@supabase/supabase-js";

import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/**
 * Map Supabase Auth failures to G10 microcopy: what happened + what to do,
 * one sentence each, no jargon.
 *
 * #228: the sentences live in `i18n/sections/onboarding.ts`, and the lookup
 * arrives as an argument rather than being reached for. Every caller is a
 * `"use client"` screen with `useT()` already in hand — login, signup, reset,
 * update-password, the OAuth buttons and the two Settings credential cards — so
 * passing it costs a line and keeps this module free of React.
 *
 * The default exists for the callers that have not been handed a `t` yet and
 * for a test calling this bare; it is English, which is what every reader saw
 * before this existed. It is `makeTranslate(DEFAULT_LOCALE)` and not a
 * catalogue read because two of these sentences are shown outside any provider.
 *
 * WHAT IS DELIBERATELY NOT TRANSLATED: `error.message`, Supabase's own text for
 * a code this switch does not name. It is shown rather than replaced — a code
 * we have never seen is a code we cannot write a sentence for, and a confident
 * wrong sentence is worse than an English right one.
 */
export function authErrorMessage(
  error: unknown,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  if (error instanceof AuthError) {
    switch (error.code) {
      case "invalid_credentials":
        return t("onboarding.authInvalidCredentials");
      case "email_not_confirmed":
        return t("onboarding.authEmailNotConfirmed");
      case "user_already_exists":
      case "email_exists":
        return t("onboarding.authEmailExists");
      case "weak_password":
        return t("onboarding.authWeakPassword");
      case "same_password":
        return t("onboarding.authSamePassword");
      case "otp_expired":
        return t("onboarding.authLinkExpired");
      case "over_request_rate_limit":
      case "over_email_send_rate_limit":
        return t("onboarding.authTooManyAttempts");
      case "user_not_found":
        return t("onboarding.authUserNotFound");
      case "session_expired":
      case "refresh_token_not_found":
        return t("onboarding.authSessionEnded");
      case "captcha_failed":
        return t("onboarding.authCaptchaFailed");
      default:
        break;
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return t("onboarding.authFailed");
}
