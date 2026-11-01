// @vitest-environment happy-dom
import { act, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ publicEnv: { NEXT_PUBLIC_GTM_ID: "GTM-MTL658DD" } }));
vi.mock("next/script", () => ({
  default: ({ children, ...props }: { children?: React.ReactNode }) => (
    <script {...props}>{children}</script>
  ),
}));
// The page has settled before either mount.
vi.mock("@/lib/perf/after-lcp-and-load", () => ({
  whenPageSettles: () => Promise.resolve(),
}));

const w = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete w.__loonextGtm;
  delete w.dataLayer;
});

/**
 * Runs the inline loader against this window, the way next/script runs it
 * once per document, and records each gtm.js the loader would insert.
 */
async function runLoaderOnce() {
  const { GoogleTagManager } = await import("./google-tag-manager");
  const html = renderToStaticMarkup(<GoogleTagManager />)
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'");
  const code = html.slice(html.indexOf(">") + 1, html.indexOf("</script>"));
  const inserted: string[] = [];
  const d = {
    cookie: "",
    referrer: "",
    createElement: () => ({}) as { src?: string },
    getElementsByTagName: () => [
      { parentNode: { insertBefore: (el: { src?: string }) => inserted.push(el.src ?? "") } },
    ],
  };
  new Function("window", "document", code)(window, d);
  return inserted;
}

async function mountBoot() {
  const { GtmBoot } = await import("./gtm-boot");
  const { unmount } = render(<GtmBoot />);
  // Let the settled gate's then() run.
  await act(async () => {});
  return unmount;
}

describe("GtmBoot (#640)", () => {
  it("loads the container once when the marketing shell mounts again", async () => {
    const inserted = await runLoaderOnce();
    const unmount = await mountBoot();
    expect(inserted).toHaveLength(1);

    // An EN/FR switch, or a trip to the app and back: a new shell, a new boot.
    unmount();
    await mountBoot();
    expect(inserted).toHaveLength(1);
  });
});
