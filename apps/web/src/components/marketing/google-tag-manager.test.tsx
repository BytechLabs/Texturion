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

  it("is imported by exactly one file, and that file is the marketing shell", () => {
    // Named exactly rather than "somewhere under (marketing)": the marketing
    // tree contains route groups that the app shell also renders into, and a
    // check that accepted any of them would accept the one that matters.
    //
    // D138 added a hop. The frame moved out of the layout and into a shell the
    // English and French layouts share, so the single importer is the shell —
    // and the containment now needs the second assertion below, because a file
    // that mounts GTM is only contained if the things mounting IT are.
    expect(importers.map(relativeToSrc)).toEqual([
      "components/marketing/shell.tsx",
    ]);
  });

  it("and that shell is rendered only by marketing layouts", () => {
    // The hop is where the containment could quietly leak: importing
    // MarketingShell into an app layout would put a remote script with full DOM
    // access onto a page showing a customer's messages, and the assertion above
    // would still pass because GTM's own importer had not changed.
    const shellImporters = sourceFiles(join(process.cwd(), "src"), [".tsx", ".ts"])
      .filter((file) => !file.endsWith(".test.tsx") && !file.endsWith(".test.ts"))
      .filter((file) => !file.includes("marketing/shell"))
      .filter((file) => sourceText(file).includes("@/components/marketing/shell"))
      .map(relativeToSrc);

    expect(shellImporters.length, "nothing renders the marketing shell").toBeGreaterThan(0);
    for (const file of shellImporters) {
      expect(
        file.startsWith("app/(marketing"),
        `${file} renders the marketing shell, which mounts the tag manager. ` +
          "That script is accepted on the marketing site and has not been " +
          "accepted on the signed-in product.",
      ).toBe(true);
      expect(file.endsWith("/layout.tsx"), `${file} is not a layout`).toBe(true);
    }
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

describe("gtm.js waits for the page to settle (#640)", () => {
  /** The loader as the browser runs it, against a stand-in window. */
  async function runLoader(w: Record<string, unknown> = {}) {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    const html = await render();
    const code = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    const inserted: { src?: string }[] = [];
    w.location ??= { href: "https://loonext.com/pricing?ref=nav" };
    const d = {
      cookie: "",
      referrer: "https://www.google.com/",
      createElement: () => ({}) as { src?: string },
      getElementsByTagName: () => [
        { parentNode: { insertBefore: (el: { src?: string }) => inserted.push(el) } },
      ],
    };
    new Function("window", "document", code)(w, d);
    return { w, inserted, dataLayer: w.dataLayer as unknown[] };
  }

  it("seeds the consent default and the gtm.js event at once, but does not download", async () => {
    const { w, inserted, dataLayer } = await runLoader();
    expect(inserted).toEqual([]);
    expect(Array.from(dataLayer[0] as ArrayLike<unknown>).slice(0, 2)).toEqual([
      "consent",
      "default",
    ]);
    expect(dataLayer[1]).toMatchObject({ event: "gtm.js" });
    expect(typeof w.__loonextGtm).toBe("function");
  });

  it("downloads once the boot releases it", async () => {
    const { w, inserted } = await runLoader();
    (w.__loonextGtm as () => void)();
    expect(inserted.map((el) => el.src)).toEqual([
      "https://www.googletagmanager.com/gtm.js?id=GTM-MTL658DD",
    ]);
  });

  it("downloads at once when the boot got there first", async () => {
    const { inserted } = await runLoader({ __loonextGtm: "go" });
    expect(inserted).toHaveLength(1);
  });

  it("downloads once, however often it is released", async () => {
    const { w, inserted } = await runLoader();
    const release = w.__loonextGtm as () => void;
    release();
    release();
    expect(inserted).toHaveLength(1);
    expect(w.__loonextGtm).toBe("done");
  });

  it("hands the container the URL and referrer the visitor landed with", async () => {
    const { dataLayer } = await runLoader();
    expect(dataLayer[1]).toMatchObject({
      event: "gtm.js",
      landing_page_location: "https://loonext.com/pricing?ref=nav",
      landing_page_referrer: "https://www.google.com/",
    });
  });

  it.each(["?gclid=abc", "?utm_source=google&utm_medium=cpc", "?x=1&fbclid=f", "?wbraid=w"])(
    "downloads at once, without a release, on a landing URL with %s",
    async (search) => {
      const { w, inserted, dataLayer } = await runLoader({
        location: { href: `https://loonext.com/${search}` },
      });
      expect(inserted).toHaveLength(1);
      expect(w.__loonextGtm).toBe("done");
      expect(dataLayer[1]).toMatchObject({ event: "gtm.js" });
    },
  );

  it("waits on a landing URL whose campaign parameter is empty", async () => {
    const { inserted } = await runLoader({ location: { href: "https://loonext.com/?gclid=" } });
    expect(inserted).toEqual([]);
  });
});
