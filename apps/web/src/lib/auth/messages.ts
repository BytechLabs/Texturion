import { AuthError } from "@supabase/supabase-js";

/**
 * Map Supabase Auth failures to G10 microcopy: what happened + what to do,
 * one sentence each, no jargon.
 */
export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    switch (error.code) {
      case "invalid_credentials":
        return "That email or password isn't right. Try again.";
      case "email_not_confirmed":
        return "Confirm your email first — we sent you a link when you signed up.";
      case "user_already_exists":
      case "email_exists":
        return "You already have an account with this email. Log in instead.";
      case "weak_password":
        return "That password is too easy to guess. Use at least 8 characters.";
      case "same_password":
        return "That's already your password. Pick a new one.";
      case "otp_expired":
        return "That link has expired. Request a new one.";
      case "over_request_rate_limit":
      case "over_email_send_rate_limit":
        return "Too many attempts. Wait a minute and try again.";
      case "user_not_found":
        return "We couldn't find an account with that email.";
      case "session_expired":
      case "refresh_token_not_found":
        return "Your session ended. Log in again.";
      case "captcha_failed":
        return "We couldn't confirm you're human. Refresh the page and try again.";
      default:
        break;
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Try again in a moment.";
}
