import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * D138 Rule 3 — a page that renders in two languages holds no words of its own.
 *
 * ## The near-miss this is built from
 *
 * Wiring `/canada` reported **73 of 73 strings replaced** and left five in
 * English. Two reasons, and neither is visible from the count:
 *
 * 1. **A short key ate a long one.** "Local numbers" is a heading AND the first
 *    two words of a paragraph. Replacing the heading first swallowed the
 *    paragraph and deleted a sentence from the page.
 * 2. **A sentence cut in half is two text nodes.** "The one-time
 *    `<RegistrationFee />` fee and the 3 to 7 business day approval…" reads as
 *    one sentence and scans as two fragments, so a fragment-shaped search
 *    reported success over the half it had not seen.
 *
 * `Day 0` and "The same flat plans as everyone:" would have shipped in English
 * on a French page that otherwise looked finished. That is precisely the
 * failure Rule 3 exists to prevent, and the replacement count is the thing that
 * said it had not happened.
 *
 * ## So the check is on the OUTPUT, not the process
 *
 * These files render for BOTH languages. Any prose literal in one of them
 * therefore appears in both, whatever the catalogue says — which makes "does
 * this file contain a sentence?" a complete test rather than a heuristic one.
 */

const BODIES = join(process.cwd(), "src", "components", "marketing");

/** Props whose value a reader (or a screen reader) sees. */
const COPY_PROPS =
  /\b(?:alt|aria-label|ariaLabel|title|label|caption|eyebrow|heading|description|placeholder|sub)="([^"]{4,})"/g;

/**
 * The same props, taking a TEMPLATE LITERAL instead of a quoted string.
 *
 * This is the hole the first version of this file had, and it was not
 * theoretical: SIX French pages closed on an English sentence because their
 * CTA read
 *
 *   sub={`Calls and texts on one business number, answered by whoever is
 *         free, ${ACTIVATION_CLAIM}. See the price.`}
 *
 * and `COPY_PROPS` reads `prop="..."`. Backtick, not quote; braces, not
 * equals-string. Every one of those pages passed all three checks with a
 * paragraph of English in it.
 *
 * The interpolations are stripped before the prose test, because `${copy.x}`
 * is a variable and only what surrounds it is written here. A template holding
 * nothing but expressions and punctuation is therefore fine, which is exactly
 * what a correctly wired one looks like.
 */
const TEMPLATE_PROP =
  /\b(?:alt|aria-label|ariaLabel|title|label|caption|eyebrow|heading|description|placeholder|sub)=\{`([^`]*)`\}/g;

/** Two or more words left over once the `${...}` holes are removed. */
function proseOutsideInterpolations(template: string): string | null {
  const literal = template.replace(/\$\{[^}]*\}/g, " ").trim();
  return /[A-Za-z][A-Za-z'’-]*\s+[A-Za-z][A-Za-z'’-]*/.test(literal)
    ? literal
    : null;
}

/**
 * A JSX text node with words in it.
 *
 * `{copy.x}` and `{" "}` are expressions, not text, so they never match. What
 * matches is a bare sentence — including a short one: `Day 0` is five
 * characters and was one of the five that got through.
 *
 * ## Two characters were missing and they were the expensive ones
 *
 * The class started as `[A-Za-z0-9'’,.:!?()-]` and had to match the WHOLE span
 * between the delimiters, so a single character outside it made a sentence
 * invisible. `&` and `;` were outside it. That is `&apos;` — which is how JSX
 * carries an apostrophe, which is how English carries a possessive. Every
 * sentence with one in it passed.
 *
 * The hero is where this surfaced: its H1 was caught and the paragraph
 * directly beneath it was not, and the only difference between them was
 * `somebody&apos;s`. A leading digit was the other gap — `9:04 PM · TUESDAY`
 * is a dateline, and the anchor demanded a letter first.
 */
const TEXT_NODE =
  />\s*([A-Za-z0-9][A-Za-z0-9'’,.:!?()·%$–-]*(?:\s+[A-Za-z0-9'’,.:!?()·%$–-]+)+)\s*</g;

/**
 * Copy sitting in a data array rather than in markup.
 *
 * `q` and `a` were missing until the home page's FAQ came through here, and
 * their absence would have passed that whole section as clean: seven questions
 * and seven answers, every one a `q:`/`a:` pair, none of them matched by a list
 * that stopped at `body`. Short field names are the ones a scanner's author
 * skips, and they are exactly what a FAQ uses.
 *
 * `name` is deliberately NOT in this list. In these visuals it holds a person —
 * Karen M, the Nguyen family, Marcus T — and a person is not a word to
 * translate. Every other field here holds something somebody wrote.
 *
 * `body: "12 minutes, Priya, booked the install"` renders on screen and reads
 * as configuration. Matched on the FIELD NAMES the visuals use for text, so a
 * className or an href cannot trip it — and deliberately not on a leading
 * capital, because one of the strings that got through began with a digit.
 */
const DATA_COPY =
  /\b(?:body|snippet|title|label|text|caption|source|tag|when|due|q|a|detail|term|hint|intro|lead|heading|eyebrow|sub)\s*:\s*"([^"]{4,})"/g;

/**
 * Every file that renders for both languages.
 *
 * The page bodies, AND the feature visuals they embed. The visuals were
 * outside this check for three pages, and every string that got through was in
 * one of them: five on the task board, two on the inbox list, four on the
 * contact timeline — a customer's own words, a quoted price, a month name.
 *
 * They hid for the same reason each time. A visual's copy sits in a DATA array
 * — `{ kind: "call", when: "Aug 2024", body: "12 minutes, Priya, booked the
 * install" }` — which reads as configuration rather than as prose, and is
 * missed by an eye looking for sentences and by a scan anchored on a capital
 * letter after a straight quote. One of them was in curly quotes; one started
 * with a digit.
 *
 * So the rule for them is the same and the reason is stronger: a file rendering
 * in two languages may hold no user-visible literal at all.
 */
/**
 * The source with JSX's HTML entities turned back into the characters they
 * stand for, so a sentence reads as a sentence.
 *
 * This replaced a first attempt that stripped every `{...}` block instead. That
 * looked more principled and was wrong in a way worth recording: the LAST brace
 * pair in any component is the function body itself, so stripping innermost-out
 * eventually swallowed the entire component and the guard went green over three
 * files that still held English. It passed because it could no longer see
 * anything at all.
 *
 * Decoding is narrower and does the actual job. `&apos;` becomes `'`, which the
 * character class already accepts, so possessives stop hiding while `&&` and
 * `=>` stay outside the class and code keeps not matching.
 *
 * `&amp;` is deliberately NOT decoded: turning it back into a bare `&` would
 * put the code-fragment false positives right back. A literal ampersand inside
 * a sentence is therefore still a blind spot, and a small one in this copy.
 */
function decodeEntities(source: string): string {
  return source
    .replace(/&apos;|&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function bilingualBodies(): string[] {
  const pages = readdirSync(BODIES)
    .filter((name) => name.endsWith("-page.tsx"))
    .map((name) => join(BODIES, name));
  // Legal documents share their bodies too. They live one directory deeper
  // than the campaign pages, which left the first translated legal page
  // outside this guard and allowed the shared shell's English labels to pass.
  const legalPages = readdirSync(join(BODIES, "legal"))
    .filter((name) => name.endsWith("-page.tsx"))
    .map((name) => join(BODIES, "legal", name));
  // A visual is checked once it ACCEPTS A LOCALE. That is the moment it
  // claims to render in both languages, and until then it is only ever on an
  // English page — so the check turns itself on as each one is converted,
  // rather than failing for every page nobody has translated yet.
  const visuals = readdirSync(join(BODIES, "features"))
    .filter((name) => name.endsWith("-visual.tsx"))
    .map((name) => join(BODIES, "features", name))
    .filter((file) => readFileSync(file, "utf8").includes("MarketingLocale"));
  // The home page's eleven sections, on the same rule and for the same
  // reason. They are not `-page.tsx` files — the route composes them — so
  // nothing here saw them until this line existed, and the home page is the
  // single largest body of copy on the site.
  const homeDir = join(BODIES, "home");
  const sections = readdirSync(homeDir)
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => join(homeDir, name))
    .filter((file) => readFileSync(file, "utf8").includes("MarketingLocale"));
  // The hero, which is its own directory because it carries the arrival
  // canvas. It is the first thing anybody reads, so it would be a strange
  // thing to leave outside the one check that reads rendered words.
  const heroDir = join(BODIES, "hero");
  const hero = readdirSync(heroDir)
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => join(heroDir, name))
    .filter((file) => readFileSync(file, "utf8").includes("MarketingLocale"));
  // The demo threads and their chrome. A conversation is the most
  // copy-dense thing on the site and it renders inside the home page, the
  // bento grid and several feature embeds, so it belongs here too.
  const demoDir = join(BODIES, "thread-demo");
  const demo = readdirSync(demoDir)
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => join(demoDir, name))
    .filter((file) => readFileSync(file, "utf8").includes("MarketingLocale"));
  return [...pages, ...legalPages, ...visuals, ...sections, ...hero, ...demo];
}

describe("#228/D138 the bilingual page bodies carry no words of their own", () => {
  const files = bilingualBodies();

  it("found the bodies and the visuals, so a passing run means something", () => {
    // A rename or a move would otherwise leave this file asserting over an
    // empty list — the failure mode that let the five through in the first
    // place, in a different costume.
    expect(files.length, "no bilingual files were found").toBeGreaterThan(4);
    expect(
      files.some((f) => f.includes("-visual")),
      "the visuals are not being checked, which is where every miss has been",
    ).toBe(true);
    expect(
      files.some((f) => f.includes(`${join("marketing", "legal")}`)),
      "the shared legal page bodies are not being checked",
    ).toBe(true);
  });

  for (const file of bilingualBodies()) {
    const name = file.split(/[\\/]/).pop() ?? file;
    const source = readFileSync(file, "utf8");

    it(`${name} has no prose in its markup`, () => {
      const found = [...decodeEntities(source).matchAll(TEXT_NODE)].map((m) =>
        m[1].trim(),
      );
      expect(
        found,
        `${name} renders in both languages, so a sentence written here shows ` +
          `to a French reader in English. Move it to the catalogue.`,
      ).toEqual([]);
    });

    it(`${name} has no prose in a prop a reader sees`, () => {
      // `alt` and `ariaLabel` are the ones that hide — invisible on screen
      // and read aloud, so an English one on a French page is caught by nobody
      // LOOKING at the page. `ariaLabel` was missing from the list until a
      // break-test planted one and this stayed green, which is the only reason
      // it is here: an assertion nobody has watched fail is a guess.
      const found = [...source.matchAll(COPY_PROPS)].map((m) => m[1]);
      expect(
        found,
        `${name} passes a literal to a prop a reader or a screen reader sees`,
      ).toEqual([]);
    });

    it(`${name} builds no sentence inside a template literal`, () => {
      // The check that found six shipped pages closing in English. A prop
      // taking a backtick string is the one shape a quote-anchored scan
      // cannot see, and it is the shape a CTA reaches for the moment it needs
      // to interpolate a constant.
      const found = [...source.matchAll(TEMPLATE_PROP)]
        .map((m) => proseOutsideInterpolations(m[1]))
        .filter((prose): prose is string => prose !== null);
      expect(
        found,
        `${name} writes prose inside a template literal passed to a prop. ` +
          `The interpolated part comes from the catalogue; the words around ` +
          `it have to as well.`,
      ).toEqual([]);
    });

    it(`${name} has no copy hiding in a data array`, () => {
      // Where every miss has actually been. A visual's example thread is data
      // to the code and prose to the reader.
      const found = [...source.matchAll(DATA_COPY)].map((m) => m[1]);
      expect(
        found,
        `${name} holds text in a data field. It renders on screen, so it has ` +
          `to come from the catalogue like everything else.`,
      ).toEqual([]);
    });
  }
});
