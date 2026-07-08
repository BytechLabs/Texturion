import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * global-error.tsx guards. This boundary replaces the ENTIRE document when
 * the root layout throws, so beyond the shared branding rules it must render
 * its own <html>/<body>, carry a system font stack (next/font is gone with
 * the layout), and use plain anchors instead of router <Link>s.
 */

const VALID_URL = "https://abcdefghijkl.supabase.co";
const VALID_KEY = "sb_publishable_0123456789abcdef";
const VALID_API = "https://api.loonext.com";

// global-error imports reportBoundaryError from ./error, which imports @/env
// (validated at module load) — stub the required set before importing.
async function importGlobalError() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", VALID_KEY);
  vi.stubEnv("NEXT_PUBLIC_API_URL", VALID_API);
  const { default: GlobalError } = await import("./global-error");
  return GlobalError;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function render(digest?: string) {
  const GlobalError = await importGlobalError();
  const error = Object.assign(new Error("boom"), { digest });
  return renderToStaticMarkup(
    <GlobalError error={error} reset={() => undefined} />,
  );
}

describe("global-error page", () => {
  it("renders its own full document (html + body)", async () => {
    const html = await render();
    expect(html).toContain('<html lang="en"');
    expect(html).toContain("<body");
  });

  it("stands alone: system font stack inline, no router Links, no scoped classes", async () => {
    const html = await render();
    expect(html).toContain("system-ui");
    expect(html).toContain('<a href="/"');
    expect(html).not.toContain('class="');
    expect(html).not.toContain("var(--");
  });

  it("carries the wordmark, the honest headline, and a retry button", async () => {
    const html = await render();
    expect(html).toContain("Loonext");
    expect(html).toContain("Something broke on our side.");
    expect(html).toContain("Try again");
    expect(html).toContain("<button");
  });

  it("shows the Next.js digest as a support reference when present", async () => {
    expect(await render("abc123")).toContain("Reference: abc123");
    expect(await render(undefined)).not.toContain("Reference:");
  });

  it("inlines the v4 palette and uses no em-dashes", async () => {
    const html = await render();
    expect(html).toContain("#FBFCFE");
    expect(html).toContain("#10173B");
    expect(html).toContain("#2740DE");
    expect(html).not.toMatch(/—|–/);
  });
});
