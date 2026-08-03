/**
 * Shared email-HTML helper suite: the ONE escape + text→HTML conversion every
 * email builder uses (email-hardening batch). The injection case mirrors the
 * real bug this module fixed: a customer-controlled company name interpolated
 * into email markup.
 */
import { describe, expect, it } from "vitest";

import {
  emailLayout,
  emailTextFooter,
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
      'See usage: <a href="https://app.loonext.com/x" style="color:#3A430F;text-decoration:underline;">https://app.loonext.com/x</a>',
    );
  });

  it("linkify stops at the paragraph tag after a trailing URL", () => {
    // toHtml turns the trailing blank line into </p>; the link must not swallow it.
    const html = renderEmailHtml("Open: https://x.example/a\n\nLoonext");
    expect(html).toContain('<a href="https://x.example/a"');
    expect(html).not.toContain('href="https://x.example/a</p>');
  });
});

describe("#252 — a reply reaches a person", () => {
  it("names the monitored address", () => {
    const html = emailLayout("<p>Your grace period ends in three days.</p>");
    expect(html).toContain("support@loonext.com");
  });

  it("does NOT claim replies go unread, because they do not", () => {
    // This assertion is the inverse of the one that used to be here, and the
    // old one is why the contradiction survived: it pinned "not read" as the
    // expected copy, so the footer and the five bodies telling the reader to
    // "reply to this email" could disagree with a green suite.
    //
    // `sendEmail` stamps a Reply-To on every send, pointed at the monitored
    // support address, falling back to it when the operator never set the
    // secret. A reply DOES reach a person, and the two bodies that matter most
    // are the workspace-deletion pair, where replying is the only stated way to
    // undo something irreversible.
    const html = emailLayout("<p>Your workspace closes in 30 days.</p>");
    expect(html).not.toContain("not read");
    expect(html).toContain("reaches a person");
  });

  it("puts it in every email, not just the ones somebody remembered", () => {
    // The whole value is that it is unconditional: a footer added per-send is
    // one somebody forgets on the send that matters.
    for (const body of ["<p>a</p>", "", "<p>Payment failed.</p>"]) {
      expect(emailLayout(body), JSON.stringify(body)).toContain(
        "support@loonext.com",
      );
    }
  });

  it("says the same thing in the text part as in the html part", () => {
    // The label lived only in the HTML. A plain-text reader — or anybody whose
    // client fell back to `text` — got the body's "reply to this email" with
    // nothing around it, and they are the reader least able to go looking for
    // another route.
    const footer = emailTextFooter();
    expect(footer).toContain("support@loonext.com");
    expect(footer).toContain("Replying reaches a person");
    expect(footer).not.toContain("not read");
    // No markup in the part that is not markup.
    expect(footer).not.toContain("<");
  });

  it("carries no em or en dash, in either part", () => {
    // Law 6, and the old footer had one.
    for (const text of [emailLayout("<p>x</p>"), emailTextFooter()]) {
      expect(text).not.toContain("—");
      expect(text).not.toContain("–");
    }
  });
});