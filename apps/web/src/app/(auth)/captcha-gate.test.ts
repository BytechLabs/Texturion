import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The auth pages call App Router hooks at render time; a plain server render
// pass has no router context, so pin them to inert stubs (submit handlers and
// navigation never run in these tests).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({
      href,
      children,
    }: {
      href: string;
      children?: ReactNode;
    }) => h("a", { href }, children),
  };
});

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.loonext.com";
const FAKE_SITE_KEY = "0x4AAAAAAAFakeSiteKey";

const pages = {
  signup: () => import("./signup/page"),
  login: () => import("./login/page"),
  "reset-password": () => import("./reset-password/page"),
} as const;

// env.ts validates at module load, so each render stubs process.env first and
// imports a fresh copy of the page (same pattern as env.test.ts).
async function renderPage(
  name: keyof typeof pages,
  siteKey: string | undefined,
) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
  vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey);
  const { default: Page } = await pages[name]();
  return renderToString(createElement(Page));
}

/** The one type="submit" button on each auth screen (the OAuth buttons are
 *  type="button", so this uniquely picks the form's submit). */
function submitButton(html: string): string {
  const match = html.match(/<button[^>]*type="submit"[^>]*>/);
  expect(match).not.toBeNull();
  return (match as RegExpMatchArray)[0];
}

// Each test re-imports a full page module tree (supabase client included)
// after resetModules; the first cold transform under a parallel full-suite
// run can exceed the 5s default and flake — give the file real headroom.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Supabase's captcha setting gates signUp, signInWithPassword AND
// resetPasswordForEmail, so all three screens carry the same optional
// Turnstile wiring (SPEC §10 front door).
describe.each(["signup", "login", "reset-password"] as const)(
  "%s captcha gate",
  (page) => {
    it("renders without the widget and leaves submit enabled when no site key is set", async () => {
      const html = await renderPage(page, undefined);
      expect(html).not.toContain('data-slot="turnstile"');
      // The Button's class list contains "disabled:" variants, so assert on
      // the rendered attribute form specifically.
      expect(submitButton(html)).not.toContain('disabled=""');
    });

    it("renders the widget container and blocks submit until a token exists", async () => {
      const html = await renderPage(page, FAKE_SITE_KEY);
      expect(html).toContain('data-slot="turnstile"');
      expect(submitButton(html)).toContain('disabled=""');
    });
  },
);
