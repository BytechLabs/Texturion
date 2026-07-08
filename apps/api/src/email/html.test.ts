/**
 * Shared email-HTML helper suite: the ONE escape + text→HTML conversion every
 * email builder uses (email-hardening batch). The injection case mirrors the
 * real bug this module fixed: a customer-controlled company name interpolated
 * into email markup.
 */
import { describe, expect, it } from "vitest";

import { escapeHtml, toHtml } from "./html";

describe("escapeHtml", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeHtml("Acme Plumbing 123")).toBe("Acme Plumbing 123");
  });

  it("escapes the ampersand first (no double-escaping)", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("toHtml", () => {
  it("renders paragraphs from blank lines and <br> from single newlines", () => {
    expect(toHtml("Hi,\n\nline one\nline two\n\nBye")).toBe(
      "<p>Hi,</p><p>line one<br>line two</p><p>Bye</p>",
    );
  });

  it("escapes injected markup in the copy (the stripe.ts company-name bug)", () => {
    const html = toHtml(
      `Hi,\n\nA payment for Smith & Sons <Plumbing>'s subscription failed.\n\n— Loonext`,
    );
    expect(html).toContain("Smith &amp; Sons &lt;Plumbing&gt;");
    expect(html).not.toContain("<Plumbing>");
    // Structure markup is still intact around the escaped payload.
    expect(html.startsWith("<p>Hi,</p><p>")).toBe(true);
  });

  it("neutralizes a script-tag payload entirely", () => {
    const html = toHtml('<script>alert("x")</script>');
    expect(html).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>",
    );
  });
});
