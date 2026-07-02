/**
 * Browser detection behind the permission card's denied-state recovery copy
 * (G8) — a wrong family only picks a different sentence, but the common
 * browsers should get their own instructions.
 */
import { describe, expect, it } from "vitest";

import {
  browserFamily,
  isIosBrowserTab,
  permissionRecoverySteps,
} from "./support";

const UA = {
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edgeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
};

describe("browserFamily", () => {
  it("classifies the common browsers", () => {
    expect(browserFamily(UA.chromeWin)).toBe("chromium");
    expect(browserFamily(UA.edgeWin)).toBe("chromium");
    expect(browserFamily(UA.firefoxWin)).toBe("firefox");
    expect(browserFamily(UA.safariMac)).toBe("safari");
    expect(browserFamily(UA.iphoneSafari)).toBe("ios");
    expect(browserFamily(UA.iphoneChrome)).toBe("ios");
    expect(browserFamily("")).toBe("unknown");
  });
});

describe("permissionRecoverySteps", () => {
  it("gives every family a concrete, non-empty sentence", () => {
    for (const ua of Object.values(UA)) {
      expect(permissionRecoverySteps(ua).length).toBeGreaterThan(20);
    }
    // Distinct copy where the UI actually differs.
    expect(permissionRecoverySteps(UA.chromeWin)).not.toBe(
      permissionRecoverySteps(UA.firefoxWin),
    );
    expect(permissionRecoverySteps(UA.iphoneSafari)).toContain("Settings");
  });
});

describe("isIosBrowserTab", () => {
  it("flags iOS browser tabs but not installed PWAs or desktops", () => {
    expect(isIosBrowserTab(UA.iphoneSafari, false)).toBe(true);
    expect(isIosBrowserTab(UA.iphoneSafari, true)).toBe(false);
    expect(isIosBrowserTab(UA.chromeWin, false)).toBe(false);
  });
});
