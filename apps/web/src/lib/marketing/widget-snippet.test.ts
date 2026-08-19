/**
 * #232 — the line an owner copies.
 *
 * Short, and every assertion is about something that would break silently: a
 * snippet that looks right and does not work is worse than one that is
 * obviously wrong, because the owner pastes it, sees no button, and concludes
 * the product does not work.
 */
import { describe, expect, it } from "vitest";

import { widgetSnippet } from "./widget-snippet";

describe("the embed snippet", () => {
  it("carries the key and points at the script", () => {
    const snippet = widgetSnippet(
      "https://app.loonext.com",
      "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    );
    expect(snippet).toContain('src="https://app.loonext.com/widget.js"');
    expect(snippet).toContain('data-key="aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"');
    // `defer` matters: without it the script blocks the customer's page while
    // it loads, on somebody else's site, which is the fastest way to be removed.
    expect(snippet).toContain("defer");
  });

  it("is a closed element, so a page does not swallow the rest of itself", () => {
    // A snippet missing its closing tag takes everything after it in the host
    // page with it. Assembled from the tag name, so this is the assertion that
    // the assembly is right rather than clever.
    const snippet = widgetSnippet("https://app.loonext.com", "k");
    // Both tags are built from the same pieces the source is, for the reason
    // the module explains: a literal closing tag in a file the bundler embeds
    // as a string closes the surrounding script block. A test file is embedded
    // the same way.
    const tag = "script";
    expect(snippet.startsWith(`<${tag} `)).toBe(true);
    expect(snippet.endsWith(`</${tag}>`)).toBe(true);
  });

  it("has no line breaks, because it is pasted into a text field", () => {
    expect(widgetSnippet("https://app.loonext.com", "k")).not.toContain("\n");
  });
});

describe("#228 the snippet carries the workspace's language", () => {
  it("names a non-default locale, so the paste matches the preview", () => {
    // widget.js is served raw to somebody else's site with no way to ask us
    // anything before it paints, so the language has to arrive as an attribute.
    const snippet = widgetSnippet("https://app.loonext.com", "k", "fr-CA");
    expect(snippet).toContain('data-lang="fr-CA"');
  });

  it("stays one plain line for an English workspace", () => {
    // The overwhelming majority of snippets. An attribute that always appears
    // would put a language on every paste, including the ones that never
    // needed one.
    expect(widgetSnippet("https://app.loonext.com", "k", "en")).not.toContain(
      "data-lang",
    );
    expect(widgetSnippet("https://app.loonext.com", "k")).not.toContain(
      "data-lang",
    );
  });
});
