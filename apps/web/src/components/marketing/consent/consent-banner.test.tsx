import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Both consent surfaces read publicEnv.NEXT_PUBLIC_GTM_ID — mock the env
// module so each test controls whether GTM (and therefore consent UI) exists.
const env = { NEXT_PUBLIC_GTM_ID: undefined as string | undefined };
vi.mock("@/env", () => ({ publicEnv: env }));

async function renderBanner(initialOpen?: boolean) {
  const { ConsentBanner } = await import("./consent-banner");
  return renderToStaticMarkup(<ConsentBanner initialOpen={initialOpen} />);
}

async function renderPreferences() {
  const { ConsentPreferences } = await import("./consent-preferences");
  return renderToStaticMarkup(<ConsentPreferences />);
}

afterEach(() => {
  env.NEXT_PUBLIC_GTM_ID = undefined;
  vi.resetModules();
});

describe("ConsentBanner (#124)", () => {
  it("renders nothing when GTM is not configured (dev/CI/previews)", async () => {
    env.NEXT_PUBLIC_GTM_ID = undefined;
    expect(await renderBanner(true)).toBe("");
  });

  it("renders nothing on the server even with GTM configured (no CLS, no crawler noise)", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    expect(await renderBanner()).toBe("");
  });

  it("asks with two equal one-tap answers and links the cookie policy", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    const html = await renderBanner(true);
    expect(html).toContain("Allow cookies");
    expect(html).toContain("No thanks");
    expect(html).toContain('href="/legal/cookies"');
    // The honest framing: nothing is set on "no".
    expect(html).toContain("Say no and we set none of them");
  });

  it("overlays instead of inserting (fixed positioning, BLUEPRINT CLS law)", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    const html = await renderBanner(true);
    expect(html).toContain("fixed");
    expect(html).toContain("bottom-0");
  });
});

describe("ConsentPreferences (#124)", () => {
  it("renders nothing when GTM is not configured", async () => {
    env.NEXT_PUBLIC_GTM_ID = undefined;
    expect(await renderPreferences()).toBe("");
  });

  it("server-renders only the reserved well (interactive panel mounts client-side)", async () => {
    env.NEXT_PUBLIC_GTM_ID = "GTM-MTL658DD";
    const html = await renderPreferences();
    expect(html).not.toBe("");
    expect(html).not.toContain("Allow cookies");
  });
});

describe("ConsentPreferencesPanel (#124)", () => {
  async function renderPanel(
    choice: "granted" | "denied" | null,
  ): Promise<string> {
    const { ConsentPreferencesPanel } = await import("./consent-preferences");
    return renderToStaticMarkup(
      <ConsentPreferencesPanel choice={choice} onChoose={() => {}} />,
    );
  }

  it("states the no-choice-yet default honestly", async () => {
    const html = await renderPanel(null);
    expect(html).toContain("no optional cookies are set");
    expect(html).toContain("Allow cookies");
    expect(html).toContain("No thanks");
  });

  it("reflects a stored choice via aria-pressed", async () => {
    const granted = await renderPanel("granted");
    expect(granted).toContain("cookies allowed");
    expect(granted).toContain('aria-pressed="true"');
    const denied = await renderPanel("denied");
    expect(denied).toContain("no optional cookies");
  });
});
