import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";

/**
 * Pure browser-detection helpers behind the permission card's recovery copy
 * (G8: a denied permission gets honest, browser-specific instructions —
 * "what happened + what to do", G10). UA sniffing is only ever used to pick
 * a SENTENCE, never a code path, so a wrong guess costs nothing.
 *
 * #228: the sentences are in `i18n/sections/misc.ts`. They name MENUS, and a
 * French reader's browser labels those menus in French — so this is one of the
 * few places where translating changes what the instruction actually points at
 * rather than only how it reads.
 */

export type BrowserFamily =
  | "ios"
  | "safari"
  | "firefox"
  | "chromium"
  | "unknown";

export function browserFamily(userAgent: string): BrowserFamily {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (ua.includes("firefox")) return "firefox";
  // Chromium engines announce "safari" too — check them first.
  if (/chrome|chromium|crios|edg\//.test(ua)) return "chromium";
  if (ua.includes("safari")) return "safari";
  return "unknown";
}

/** One sentence telling this browser's user how to un-block notifications. */
export function permissionRecoverySteps(
  userAgent: string,
  t: Translate = makeTranslate(DEFAULT_LOCALE),
): string {
  switch (browserFamily(userAgent)) {
    case "ios":
      return t("misc.pushRecoveryIos");
    case "firefox":
      return t("misc.pushRecoveryFirefox");
    case "safari":
      return t("misc.pushRecoverySafari");
    case "chromium":
      return t("misc.pushRecoveryChromium");
    default:
      return t("misc.pushRecoveryGeneric");
  }
}

/**
 * iOS Safari only exposes Web Push to apps installed on the home screen —
 * the unsupported-state copy uses this to say the honest, useful thing.
 */
export function isIosBrowserTab(userAgent: string, standalone: boolean): boolean {
  return browserFamily(userAgent) === "ios" && !standalone;
}
