/**
 * Pure browser-detection helpers behind the permission card's recovery copy
 * (G8: a denied permission gets honest, browser-specific instructions —
 * "what happened + what to do", G10). UA sniffing is only ever used to pick
 * a SENTENCE, never a code path, so a wrong guess costs nothing.
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
export function permissionRecoverySteps(userAgent: string): string {
  switch (browserFamily(userAgent)) {
    case "ios":
      return "Open Settings → Notifications → JobText on your phone, allow notifications, then come back here.";
    case "firefox":
      return "Click the permissions icon next to the address bar, remove the notifications block, then reload this page.";
    case "safari":
      return "Open Safari → Settings → Websites → Notifications, allow this site, then reload this page.";
    case "chromium":
      return "Click the icon next to the address bar, set Notifications to Allow, then reload this page.";
    default:
      return "Allow notifications for this site in your browser settings, then reload this page.";
  }
}

/**
 * iOS Safari only exposes Web Push to apps installed on the home screen —
 * the unsupported-state copy uses this to say the honest, useful thing.
 */
export function isIosBrowserTab(userAgent: string, standalone: boolean): boolean {
  return browserFamily(userAgent) === "ios" && !standalone;
}
