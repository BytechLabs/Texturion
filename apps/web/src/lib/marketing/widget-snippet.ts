/**
 * #232 — the one line an owner pastes into their own website.
 *
 * In a module of its own, with nothing after it, and that is deliberate on two
 * counts.
 *
 * The closing tag is ASSEMBLED from the tag name rather than written out. A
 * literal closing script tag inside a module that is ever rendered into a page
 * terminates the enclosing script block — a parser hazard old enough to have
 * its own CVEs — so the sequence never exists in this source.
 *
 * INCLUDING IN THIS COMMENT, which is not pedantry: the first version of this
 * file spelled the tag out here to explain why the code does not, and that
 * broke the settings page in dev. The bundler embeds module SOURCE — comments
 * and all — as a string, and the sequence closed the surrounding script block.
 * Uncaught "Invalid or unexpected token", on one route only, from a docblock.
 *
 * And `check-hardcoded-strings` reads text between a `>` and the next `<` as
 * JSX, which it cannot distinguish from a template literal holding markup. In
 * the component this swallowed the whole function body after it and reported
 * the word "catch" as user-facing copy. The guard was right to be suspicious of
 * markup in a component; the answer is for the markup not to live in one.
 */
/**
 * #228: the LOCALE rides in the snippet.
 *
 * `widget.js` is served raw to somebody else's website with no bundler and no
 * way to ask us anything before it paints, so the language has to arrive as an
 * attribute the way `data-label` already does. Emitted only for a non-default
 * locale: an English workspace's snippet stays the one line it was.
 *
 * The workspace's locale, not the reader's. This is the language the business
 * SELLS in — what its own customers read on its own website — and an owner who
 * runs the app in English while serving a French town must not hand their
 * visitors English.
 */
export function widgetSnippet(
  origin: string,
  key: string,
  locale?: string,
): string {
  const tag = "script";
  const lang = locale && locale !== "en" ? ` data-lang="${locale}"` : "";
  return `<${tag} src="${origin}/widget.js" data-key="${key}"${lang} defer></${tag}>`;
}
