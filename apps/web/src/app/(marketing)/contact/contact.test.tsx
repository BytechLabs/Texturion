import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * /contact guards (COPY-DECK v2): the deck's dateline and H1, the short
 * work-order form (name, email, business, message), the REAL submit path (a
 * fetch to POST /contact, not a mailto), the hidden honeypot, and never a
 * placeholder identity line (purge 7). The pure submit/validation logic is
 * covered in contact-form-logic.test.ts; this renders the component and page.
 *
 * The form now imports publicEnv, whose env module validates NEXT_PUBLIC_* at
 * import time. Stub the required values (test fixtures, not product config)
 * before the dynamic import so the module evaluates.
 */
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.local");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
vi.stubEnv("NEXT_PUBLIC_API_URL", "https://stub-api.local");

const { ContactForm } = await import("./contact-form");
const { default: ContactPage, metadata } = await import("./page");

const pageHtml = renderToStaticMarkup(<ContactPage />);
const formHtml = renderToStaticMarkup(<ContactForm />);

describe("/contact — the work-order page", () => {
  it("opens with the deck's dateline, H1, and reply promise", () => {
    expect(pageHtml).toContain("A REAL PERSON ANSWERS");
    expect(pageHtml).toContain("Email us. A real person answers.");
    expect(pageHtml).toContain("one of the people who built Loonext");
    // Deck /contact note: the reply-time clause ships only once ops verifies
    // it. Unverified at build time, so it is dropped (page and metadata).
    expect(pageHtml).not.toContain("usually within a business day");
    expect(String(metadata.description)).not.toContain(
      "usually within a business day",
    );
  });

  it("renders the short work order: name, email, business, message", () => {
    expect(formHtml).toContain('id="contact-name"');
    expect(formHtml).toContain('id="contact-email"');
    expect(formHtml).toContain('id="contact-business"');
    expect(formHtml).toContain('id="contact-message"');
    // Email is now a real, typed, required field (the endpoint requires it).
    expect(formHtml).toContain('type="email"');
    // Autocomplete is wired for the browser's contact autofill (attribute
    // casing varies by renderer, so match case-insensitively).
    expect(formHtml).toMatch(/autocomplete="name"/i);
    expect(formHtml).toMatch(/autocomplete="email"/i);
  });

  it("submits to the real endpoint, not a mailto (button is a plain verb)", () => {
    expect(formHtml).toContain("Send message");
    expect(formHtml).not.toContain("Open in your email app");
    // No copy claiming the button opens the visitor's mail app.
    expect(formHtml).not.toMatch(/opens your email app/i);
  });

  it("hides a honeypot field from humans and the a11y tree", () => {
    expect(formHtml).toContain('id="contact-website"');
    expect(formHtml).toContain('name="website"');
    expect(formHtml).toContain('aria-hidden="true"');
    expect(formHtml).toMatch(/tabindex="-1"/i);
    expect(formHtml).toMatch(/autocomplete="off"/i);
  });

  it("keeps a pre-filled mailto as the fallback link (not the primary path)", () => {
    expect(formHtml).toContain("mailto:support@loonext.com");
    expect(formHtml).toMatch(/Prefer your own email app/i);
  });

  it("routes to security disclosure and status with real links", () => {
    expect(pageHtml).toContain('href="/security"');
    expect(pageHtml).toContain('href="/status"');
    expect(pageHtml).toContain("security@loonext.com");
  });

  it("never renders a placeholder identity line (purge 7)", () => {
    expect(pageHtml).not.toMatch(/pending, added before launch/i);
    // Until ops supplies the entity, the mailing-address block is absent.
    expect(pageHtml).not.toContain("Mailing address");
  });

  it("no em-dash, no artifact talk, anywhere on the page or in metadata (Laws 1, 6)", () => {
    for (const s of [pageHtml, formHtml, String(metadata.description)]) {
      expect(s).not.toMatch(/—|–/);
      expect(s).not.toMatch(/real interface|stock photo|built with next/i);
    }
  });
});
