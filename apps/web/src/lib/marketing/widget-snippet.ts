/**
 * #232 — the one line an owner pastes into their own website.
 *
 * In a module of its own, with nothing after it, and that is deliberate on two
 * counts.
 *
 * The closing tag is ASSEMBLED from the tag name rather than written out. A
 * literal `</script>` inside a module that is ever rendered into a page
 * terminates the enclosing script block — a parser hazard old enough to have
 * its own CVEs — so the sequence never exists in this source.
 *
 * And `check-hardcoded-strings` reads text between a `>` and the next `<` as
 * JSX, which it cannot distinguish from a template literal holding markup. In
 * the component this swallowed the whole function body after it and reported
 * the word "catch" as user-facing copy. The guard was right to be suspicious of
 * markup in a component; the answer is for the markup not to live in one.
 */
export function widgetSnippet(origin: string, key: string): string {
  const tag = "script";
  return `<${tag} src="${origin}/widget.js" data-key="${key}" defer></${tag}>`;
}
