// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The real posthog-js, so a later SDK that reads its first touch or session
 * entry from somewhere else fails here. Nothing reaches the network: every
 * transport the SDK has is stubbed.
 */
vi.mock("@/lib/perf/after-lcp-and-load", () => ({ whenPageSettles: () => Promise.resolve() }));

const LANDING = "/?utm_source=google&utm_campaign=crew&gclid=TESTGCLID";

function stubTransports() {
  const sent = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
  vi.stubGlobal("fetch", sent);
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      open() {}
      setRequestHeader() {}
      send() {}
    },
  );
  Object.defineProperty(navigator, "sendBeacon", { value: () => true, configurable: true });
  // The SDK drops events from user agents it takes for bots, happy-dom's included.
  Object.defineProperty(navigator, "userAgent", {
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    configurable: true,
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("a visitor who moved on before PostHog started (#640)", () => {
  it("keeps the landing page as their first touch and the session's entry", async () => {
    stubTransports();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijkl.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_0123456789abcdef");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.loonext.com");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test_placeholder_not_a_project");
    history.replaceState(null, "", LANDING);
    const landing = location.href;

    const { initPostHog } = await import("./posthog");
    const ready = initPostHog();
    history.pushState(null, "", "/pricing");
    const posthog = await ready;
    expect(posthog).not.toBeNull();

    expect(posthog!.persistence!.get_initial_props()).toMatchObject({
      $initial_current_url: landing,
      $initial_pathname: "/",
      $initial_utm_source: "google",
      $initial_gclid: "TESTGCLID",
    });
    expect(posthog!.sessionPropsManager!.getSessionProps()).toMatchObject({
      $session_entry_url: landing,
      $session_entry_pathname: "/",
      $session_entry_utm_source: "google",
      $session_entry_gclid: "TESTGCLID",
    });
  });
});
