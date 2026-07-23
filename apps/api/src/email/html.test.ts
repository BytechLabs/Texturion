/**
 * Shared email-HTML helper suite: the ONE escape + text→HTML conversion every
 * email builder uses (email-hardening batch). The injection case mirrors the
 * real bug this module fixed: a customer-controlled company name interpolated
 * into email markup.
 */
import { describe, expect, it } from "vitest";

import {
  emailLayout,
  escapeHtml,
  linkifyUrls,
  renderEmailHtml,
  toHtml,
} from "./html";

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

describe("emailLayout + renderEmailHtml (#88 branded transactional layout)", () => {
  it("frames body html in the branded, email-client-safe container", () => {
    const html = emailLayout("<p>Hello</p>");
    expect(html).toContain("<!DOCTYPE html>");
    // The wordmark rule (#206): a text span with ONLY the second o in olive.
    expect(html).toContain('Lo<span style="color:#66801F;">o</span>next');
    expect(html).toContain("<p>Hello</p>"); // the body, untouched
    expect(html).toContain("service message about your Loonext account"); // footer
    // Email clients strip <style>/<head> CSS, so layout is tables + INLINE styles.
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width:560px");
    expect(html).not.toContain("<style");
  });

  it("renders plain text as a full branded email, escaping the copy", () => {
    const html = renderEmailHtml("Hi,\n\nSmith & <Sons> did a thing.\n\nLoonext");
    expect(html).toContain("Smith &amp; &lt;Sons&gt;");
    expect(html).not.toContain("<Sons>");
    expect(html).toContain("max-width:560px"); // wrapped in the layout
  });

  it("linkifies bare URLs so transactional CTAs are clickable", () => {
    expect(linkifyUrls("See usage: https://app.loonext.com/x")).toBe(
      'See usage: <a href="https://app.loonext.com/x" style="color:#66801F;text-decoration:underline;">https://app.loonext.com/x</a>',
    );
  });

  it("linkify stops at the paragraph tag after a trailing URL", () => {
    // toHtml turns the trailing blank line into </p>; the link must not swallow it.
    const html = renderEmailHtml("Open: https://x.example/a\n\nLoonext");
    expect(html).toContain('<a href="https://x.example/a"');
    expect(html).not.toContain('href="https://x.example/a</p>');
  });
});
