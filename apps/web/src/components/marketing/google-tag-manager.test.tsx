import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  return renderToStaticMarkup(<GoogleTagManager />);
}

afterEach(() => {
  env.NEXT_PUBLIC_GTM_ID = undefined;
  vi.resetModules();
});

describe("GoogleTagManager (#124)", () => {
  it("renders nothing when the container id is unset (dev/CI/previews)", async () => {
    env.NEXT_PUBLIC_GTM_ID = undefined;
    expect(await render()).toBe("");
  });

  it("loads the container and the noscript fallback when the id is set", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    const html = await render();
    // The loader seeds the dataLayer and requests gtm.js for the exact id.
    expect(html).toContain("dataLayer");
    expect(html).toContain("googletagmanager.com/gtm.js");
    expect(html).toContain("GTM-MTL658DD");
    // The no-JS fallback iframe targets the same container.
    expect(html).toContain(
      "googletagmanager.com/ns.html?id=GTM-MTL658DD",
    );
  });

  it("injects the id verbatim — no other container can leak in", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-ABC123";
    const html = await render();
    expect(html).toContain("GTM-ABC123");
    expect(html).not.toContain("GTM-MTL658DD");
  });
});
