import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONSENT_COOKIE } from "@/components/marketing/consent/consent";
import { sourceFiles, sourceText } from "@/test/source-tree";

// The component reads publicEnv.NEXT_PUBLIC_GTM_ID — mock the env module so
// each test controls whether GTM is configured.
const env = { NEXT_PUBLIC_GTM_ID: undefined as string | undefined };
vi.mock("@/env", () => ({ publicEnv: env }));

// next/script renders its inline children as a plain script in SSR markup.
vi.mock("next/script", () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => (
    <script {...props}>{children}</script>
  ),
}));

async function render() {
  const { GoogleTagManager } = await import("./google-tag-manager");
  // renderToStaticMarkup entity-escapes quotes inside the inline script;
  // decode them so assertions can read the script as the browser would.
  return renderToStaticMarkup(<GoogleTagManager />)
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'");
}

afterEach(() => {
  env.NEXT_PUBLIC_GTM_ID = undefined;
  vi.resetModules();
});

/**
 * #577 — the container loads on the MARKETING origin and nowhere else.
 *
 * The component says this in its own docblock: "it never loads on the
 * authenticated app — the product surface must not stream signed-in telemetry
 * into a marketing tag manager." That was the whole containment, and it was
 * prose. One import into `(app)/layout.tsx` would move a remote script with
 * full DOM access onto the signed-in product, and nothing would have said so.
 *
 * The exposure #577 names is that the container is a code-publishing path
 * which bypasses this repo, CI and review. That is a real trade the founder
 * makes for marketing measurement, and it is theirs to make. What is NOT a
 * trade is where the trade applies: a script accepted on the marketing site
 * has not been accepted on a page showing a customer's messages.
 */
const IMPORT_PATH = "@/components/marketing/google-tag-manager";

/** `…/src/app/(marketing)/layout.tsx` → `app/(marketing)/layout.tsx`. */
function relativeToSrc(file: string): string {
  const normalised = file.split("\\").join("/");
  return normalised.slice(normalised.lastIndexOf("/src/") + "/src/".length);
}

describe("#577 the tag manager stays on the marketing origin", () => {
  const importers = sourceFiles(join(process.cwd(), "src"), [".tsx", ".ts"])
    .filter((file) => !file.endsWith(".test.tsx") && !file.endsWith(".test.ts"))
    .filter((file) => !file.includes("google-tag-manager"))
    .filter((file) => sourceText(file).includes(IMPORT_PATH));

  it("is imported by exactly one file, and that file is the marketing layout", () => {
    // Named exactly rather than "somewhere under (marketing)": the marketing
    // tree contains route groups that the app shell also renders into, and a
    // check that accepted any of them would accept the one that matters.
    expect(importers.map(relativeToSrc)).toEqual([
      "app/(marketing)/layout.tsx",
    ]);
  });

  it("the scan reaches the tree at all", () => {
    // Without this the assertion above passes on an empty list, which is what
    // a broken glob looks like from the outside.
    expect(sourceFiles(join(process.cwd(), "src"), [".tsx"]).length).toBeGreaterThan(200);
  });
});
describe("GoogleTagManager (#124)", () => {
  it("renders nothing when the container id is unset (dev/CI/previews)", async () => {
    env.NEXT_PUBLIC_GTM_ID = undefined;
    expect(await render()).toBe("");
  });

  it("loads the container when the id is set", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    const html = await render();
    // The loader seeds the dataLayer and requests gtm.js for the exact id.
    expect(html).toContain("dataLayer");
    expect(html).toContain("googletagmanager.com/gtm.js");
    expect(html).toContain("GTM-MTL658DD");
  });

  it("seeds the Consent Mode v2 default BEFORE gtm.js loads", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    const html = await render();
    // The consent default is pushed from the stored choice cookie, in the
    // same script, ahead of the loader IIFE.
    expect(html).toContain(`${CONSENT_COOKIE}=granted`);
    expect(html.indexOf("consent")).toBeGreaterThan(-1);
    expect(html.indexOf("consent")).toBeLessThan(
      html.indexOf("googletagmanager.com/gtm.js"),
    );
    // All four v2 signals are present and deny by default; security_storage
    // stays granted in both maps.
    for (const signal of [
      "ad_storage",
      "ad_user_data",
      "ad_personalization",
      "analytics_storage",
    ]) {
      expect(html).toContain(signal);
    }
    expect(html).toContain('"security_storage":"granted"');
    expect(html).toContain('"analytics_storage":"denied"');
  });

  it("ships NO noscript iframe — it cannot respect consent state", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    const html = await render();
    expect(html).not.toContain("ns.html");
    expect(html).not.toContain("noscript");
    expect(html).not.toContain("iframe");
  });

  it("injects the id verbatim — no other container can leak in", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-ABC123";
    const html = await render();
    expect(html).toContain("GTM-ABC123");
    expect(html).not.toContain("GTM-MTL658DD");
  });
});
