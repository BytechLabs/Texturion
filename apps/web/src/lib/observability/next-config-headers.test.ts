/**
 * #559 — what the wire actually says about a revocable link.
 *
 * A shared job-photos link can be revoked at any moment, and D75 promises that
 * revoking works. It did at the API and then didn't in practice: the page was
 * 308ed to the marketing apex, where a blanket rule stamped an hour of
 * shared-cache TTL on it, so for up to an hour the revoked link kept opening for
 * whoever already had the address. The page's own source comment claimed
 * no-store the whole time.
 *
 * Read from `next.config.ts` as text rather than by importing it. The config
 * imports the OpenNext adapter at module scope, and a header rule is a string in
 * a data structure — text is what it is, and text is what a reviewer diffs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isAppSurfacePath } from "@/lib/hosts";

import { TOKEN_PATH_PREFIXES } from "./scrub";

const CONFIG = readFileSync(
  join(__dirname, "../../../next.config.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

/** The declared list, parsed out of the config source. */
function declaredUncacheablePrefixes(): string[] {
  const match = /UNCACHEABLE_TOKEN_PREFIXES = \[([^\]]*)\]/.exec(CONFIG);
  expect(match, "next.config.ts no longer declares UNCACHEABLE_TOKEN_PREFIXES")
    .not.toBeNull();
  return (match?.[1] ?? "")
    .split(",")
    .map((raw) => raw.trim().replace(/^"|"$/g, ""))
    .filter((raw) => raw !== "");
}

describe("#559 a revocable link is never shared-cached", () => {
  it("declares the prefixes it is going to protect", () => {
    // Loud rather than vacuous: an empty list would satisfy every assertion
    // below by having nothing to check.
    const declared = declaredUncacheablePrefixes();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toContain("photos");
  });

  it("sends no-store for each declared prefix", () => {
    expect(CONFIG).toContain('"no-store, private"');
    expect(CONFIG).toContain("UNCACHEABLE_TOKEN_PREFIXES.map");
  });

  it("excludes them from the apex rule by pattern, not by rule order", () => {
    // Relying on the more specific rule to win would be relying on precedence
    // nobody here has verified against the OpenNext adapter.
    expect(CONFIG).toContain("(?!${UNCACHEABLE_PREFIX_GROUP}/)");
  });

  it("compiles to a pattern that actually excludes what it names", () => {
    /**
     * The text assertion above only proves the interpolation is spelled right.
     * This builds the same regex the config builds and asks it about real paths,
     * because the first version of this rule read correctly and was wrong:
     * `(?!photos|invite/)` binds the slash to the last alternative only, so it
     * excluded every path starting "photos" — /photos-for-plumbers with it —
     * while still caching /invite/<token>. Both halves of that are bugs, and the
     * source text of a working rule and a broken one differ by two characters.
     */
    const group = /UNCACHEABLE_PREFIX_GROUP = `([^`]*)`/.exec(CONFIG);
    expect(group, "UNCACHEABLE_PREFIX_GROUP moved").not.toBeNull();
    const compiled = new RegExp(
      `^${(group?.[1] ?? "").replace(
        "${UNCACHEABLE_TOKEN_PREFIXES.join(\"|\")}",
        declaredUncacheablePrefixes().join("|"),
      )}/`,
    );

    // Excluded from the apex cache: every declared prefix, with its token.
    for (const prefix of declaredUncacheablePrefixes()) {
      expect(compiled.test(`${prefix}/a-token`), `${prefix}/…`).toBe(true);
    }
    // Still cached: marketing paths that merely start with the same letters.
    expect(compiled.test("photos-for-plumbers")).toBe(false);
    expect(compiled.test("invites/accept")).toBe(false);
    expect(compiled.test("pricing")).toBe(false);
  });

  it("anchors the host predicate, which OpenNext does not do for us", () => {
    // Next anchors a `has` host value; OpenNext compiles it to an unanchored
    // regex, where a bare "loonext.com" also matches app.loonext.com — verified
    // live, the app host was returning the apex s-maxage with no Vary: Cookie.
    // `^…$` is right under both matchers.
    expect(CONFIG).toContain('value: "^loonext\\\\.com$"');
    expect(
      /has: \[\{ type: "host", value: "loonext\.com" \}\]/.test(CONFIG),
      "the unanchored host predicate is back — under OpenNext it also matches app.loonext.com",
    ).toBe(false);
  });
});

describe("#559 the link stays on the host that minted it", () => {
  it("treats /photos as an app surface, so it is not 308ed to the apex", () => {
    // The API mints the URL on APP_ORIGIN. Being on neither list is what sent it
    // to the marketing apex and into that cache rule in the first place.
    expect(isAppSurfacePath("/photos")).toBe(true);
    expect(isAppSurfacePath("/photos/some-token")).toBe(true);
  });

  it("does not protect it, which would bounce a homeowner to /login", () => {
    // The person opening a shared link has no account. This is the distinction
    // between EXTRA_APP_PREFIXES and PROTECTED_PREFIXES, and getting it wrong
    // would replace an hour of staleness with a dead link.
    const redirects = readFileSync(
      join(__dirname, "../auth/redirects.ts"),
      "utf8",
    );
    const protectedList = /PROTECTED_PREFIXES = \[([^\]]*)\]/.exec(redirects);
    expect(protectedList, "PROTECTED_PREFIXES moved").not.toBeNull();
    expect(protectedList?.[1]).not.toContain("/photos");
  });
});

describe("#559 the two token lists agree", () => {
  it("scrubs the token of every link it declares uncacheable", () => {
    // A link that can be revoked is a link whose token is a secret. Two lists
    // describing one set of links is the shape that produced both #558 and
    // #559 — so they are compared rather than maintained in parallel.
    expect(declaredUncacheablePrefixes()).toEqual([...TOKEN_PATH_PREFIXES]);
  });
});
