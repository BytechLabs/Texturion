import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// composer.tsx transitively reaches the Supabase browser client and the API
// client, both of which validate public env at IMPORT time. This suite renders
// one pure presentational component, so the env module is stubbed rather than
// the whole data layer configured — the same approach the marketing suites use.
vi.mock("@/env", () => ({
  publicEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "stub-key",
    NEXT_PUBLIC_API_URL: "https://stub.api.local",
  },
}));

import { MergeFieldPreview } from "./composer";

/**
 * #393 — the "Sends as:" line must appear for a draft that is about to be
 * SIGNED, not only for one holding a {token}.
 *
 * This is the one case where the sent text differs from the typed text with
 * nothing in the draft to hint at it: no merge field, no visible cue, and — for
 * a short message — no segment meter either, because the meter only appears at
 * two parts. Without this the product would quietly add a sentence to a
 * customer's first impression and show the sender nothing.
 */
const SIGNATURE = " - Acme Plumbing. Reply STOP to opt out";

function markup(props: Parameters<typeof MergeFieldPreview>[0]): string {
  return renderToStaticMarkup(<MergeFieldPreview {...props} />);
}

describe("MergeFieldPreview — signed first texts", () => {
  it("previews a plain draft that will be signed", () => {
    const html = markup({ text: "On my way", identificationSuffix: SIGNATURE });
    expect(html).toContain("Sends as:");
    expect(html).toContain("On my way - Acme Plumbing. Reply STOP to opt out");
  });

  it("renders nothing for a plain draft that will NOT be signed", () => {
    // The ordinary case, and it must stay quiet: most texts are replies or go
    // to someone already signed to.
    expect(markup({ text: "On my way", identificationSuffix: null })).toBe("");
    expect(markup({ text: "On my way" })).toBe("");
  });

  it("stays quiet on an empty draft even when signing is on", () => {
    // Otherwise the preview reads as the signature alone, which is not a
    // message anybody is about to send.
    expect(markup({ text: "", identificationSuffix: SIGNATURE })).toBe("");
    expect(markup({ text: "   ", identificationSuffix: SIGNATURE })).toBe("");
  });

  it("substitutes merge fields AND signs, in the send path's order", () => {
    const html = markup({
      text: "Hi {first_name}, this is {business_name}.",
      contactName: "Dana Whitfield",
      businessName: "Acme Plumbing",
      identificationSuffix: SIGNATURE,
    });
    expect(html).toContain(
      "Hi Dana, this is Acme Plumbing. - Acme Plumbing. Reply STOP to opt out",
    );
  });

  it("does not double the signature an owner already typed", () => {
    const text = `On my way${SIGNATURE}`;
    const html = markup({ text, identificationSuffix: SIGNATURE });
    // The suffix appears once in the rendered sentence, not twice.
    const occurrences = html.split("Reply STOP to opt out").length - 1;
    expect(occurrences).toBe(1);
  });

  it("still previews merge fields when signing is off", () => {
    const html = markup({
      text: "Hi {first_name}",
      contactName: "Dana",
      identificationSuffix: null,
    });
    expect(html).toContain("Hi Dana");
  });
});
