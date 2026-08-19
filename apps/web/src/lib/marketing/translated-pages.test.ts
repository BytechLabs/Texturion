import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { languagesFor, TRANSLATED_PAGES, twinOf } from "./translated-pages";

/**
 * D138 Rules 4 and 5 — the registry and the filesystem agree.
 *
 * ## The two failures, and the second is the dangerous one
 *
 * **A row whose French page does not exist** announces a translation to Google
 * that returns 404. Rule 4 makes an untranslated `/fr` URL a 404 rather than
 * English, so a stale row turns a deliberate absence into a broken promise.
 *
 * **A French page with no row** is worse and quieter: the page is live, a
 * French reader can reach it, and nothing tells a search engine it is the
 * translation of anything. It will be treated as a thin duplicate of a page it
 * has no declared relationship with. Nobody notices, because the page itself
 * looks perfect.
 *
 * So the check runs in both directions, which is the same reason every
 * catalogue check in this repo does.
 */

const APP = join(process.cwd(), "src", "app");
const FR_GROUP = join(APP, "(marketing-fr)");

/** Every `/fr/...` route the filesystem actually serves. */
function frenchRoutes(dir: string, urlPrefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // A route group — "(marketing-fr)" — contributes no URL segment.
      const segment = entry.startsWith("(") ? urlPrefix : `${urlPrefix}/${entry}`;
      found.push(...frenchRoutes(full, segment));
      continue;
    }
    if (entry === "page.tsx") found.push(urlPrefix);
  }
  return found;
}

describe("#228/D138 the French pages and the registry agree", () => {
  const routes = frenchRoutes(FR_GROUP);

  it("found the French route group at all", () => {
    // Without this the two assertions below pass on empty lists, which is what
    // a moved directory looks like from the outside.
    expect(existsSync(FR_GROUP), "the (marketing-fr) group is gone").toBe(true);
    expect(routes.length, "no French pages were found").toBeGreaterThan(0);
    expect(TRANSLATED_PAGES.length).toBeGreaterThan(0);
  });

  it("every registered French page exists", () => {
    const missing = TRANSLATED_PAGES.filter((p) => !routes.includes(p.fr));
    expect(
      missing.map((p) => p.fr),
      "these are announced to search engines as translations and would 404",
    ).toEqual([]);
  });

  it("every French page is registered", () => {
    const unregistered = routes.filter(
      (route) => !TRANSLATED_PAGES.some((p) => p.fr === route),
    );
    expect(
      unregistered,
      "these French pages are live but nothing declares them the translation " +
        "of anything, so a search engine sees a thin duplicate",
    ).toEqual([]);
  });

  it("every registered English page exists too", () => {
    const missing = TRANSLATED_PAGES.filter(
      (p) => !existsSync(join(APP, "(marketing)", ...p.en.split("/").filter(Boolean), "page.tsx")),
    );
    expect(missing.map((p) => p.en)).toEqual([]);
  });
});

describe("the pair is reciprocal by construction", () => {
  it("gives both pages the same three alternates", () => {
    for (const page of TRANSLATED_PAGES) {
      const fromEnglish = languagesFor(page.en);
      const fromFrench = languagesFor(page.fr);
      // Not "each names the other" — literally the same object, because both
      // are derived from one row. A one-way link cannot be expressed.
      expect(fromEnglish).toEqual(fromFrench);
      expect(fromEnglish).toEqual({
        "en-CA": page.en,
        "fr-CA": page.fr,
        "x-default": page.en,
      });
    }
  });

  it("says nothing about a page with no translation", () => {
    // A lone hreflang on an untranslated page tells a crawler a version exists
    // that does not.
    //
    // The path is DERIVED, not named. This assertion used to say "/pricing",
    // which was true until /pricing was translated and then failed as a
    // consequence of the work rather than a defect in it. Anything absent from
    // the registry proves the same thing and cannot go stale.
    const untranslated = "/legal/terms";
    expect(
      TRANSLATED_PAGES.some((page) => page.en === untranslated),
      "pick a path the registry does not carry",
    ).toBe(false);
    expect(languagesFor(untranslated)).toBeUndefined();
    expect(twinOf(untranslated)).toBeUndefined();
  });

  it("points the switcher at the other language's exact page", () => {
    // D138 Rule 6: never a bounce to the front page. Somebody reading
    // /fr/contact who switches wants /contact, not the homepage.
    expect(twinOf("/contact")).toEqual({ locale: "fr-CA", path: "/fr/contact" });
    expect(twinOf("/fr/contact")).toEqual({ locale: "en", path: "/contact" });
  });
});
