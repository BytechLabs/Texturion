import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildMailto, ContactForm } from "./contact-form";
import ContactPage, { metadata } from "./page";

/**
 * /contact guards (COPY-DECK v2): the deck's dateline and H1, the short
 * work-order form (name, business, message), the mailto submit path, and
 * never a placeholder identity line (purge 7).
 */

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

  it("the form is the deck's short work order: name, business, message", () => {
    expect(formHtml).toContain('id="contact-name"');
    expect(formHtml).toContain('id="contact-business"');
    expect(formHtml).toContain('id="contact-message"');
    expect(formHtml).not.toContain('type="email"');
  });

  it("submits via the honest mailto path to the real support address", () => {
    expect(formHtml).toContain("Open in your email app");
    expect(formHtml).toContain("mailto:support@loonext.com");
    expect(formHtml).toContain("That address works too.");
  });

  it("percent-encodes the mailto draft per RFC 6068 (spaces are %20, never +)", () => {
    const href = buildMailto(
      "Dale Reyes",
      "Reyes Plumbing",
      "My water heater quote question",
    );
    expect(href).toContain("mailto:support@loonext.com?subject=");
    // Spaces must be %20; a "+" would render literally in the mail client.
    expect(href).toContain("subject=Loonext%20question%20from%20Dale%20Reyes");
    expect(href).toContain("body=My%20water%20heater%20quote%20question");
    expect(href).not.toContain("+");
    // Newlines before the signature are %0A, and the comma is encoded too.
    expect(href).toContain("%0A%0ADale%20Reyes%2C%20Reyes%20Plumbing");
  });

  it("omits the signature block when name and business are empty", () => {
    const href = buildMailto("", "", "Question about porting");
    expect(href).toContain("subject=Loonext%20question&");
    expect(href).toContain("body=Question%20about%20porting");
    expect(href).not.toContain("%0A");
    expect(href).not.toContain("+");
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
