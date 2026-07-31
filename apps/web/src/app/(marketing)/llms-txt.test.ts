import { readFileSync } from "node:fs";
// Still reaching into the API source for the caps assertion below: the one fact
// this file cannot derive, because the caps live in the Worker.
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BLOG_POSTS, blogPostPath } from "@/lib/marketing/blog";
import { buildLlmsTxt, notedRoutes } from "@/lib/marketing/llms-txt";
import { LIVE_ROUTES, absoluteUrl } from "@/lib/marketing/site";
import { PLAN_PRICING, US_REGISTRATION_FEE_DOLLARS } from "@/lib/api/types";

/**
 * #451 — llms.txt cannot silently drift from the facts it states.
 *
 * Two files describe this product to machines. `sitemap.ts` is DERIVED from
 * `BLOG_POSTS`, so adding a post cannot leave it stale. `llms.txt` is a static
 * asset that is typed by hand — and per #434 it drifted within a fortnight,
 * describing a product that had shipped AI drafting, transcripts, mentions and
 * Lou to three clients without a single mention of any of them.
 *
 * Same repo, same content domain, same audience. The difference was entirely
 * that one is generated and one is typed.
 *
 * Fully generating it would cost the part worth keeping — the honest-omissions
 * voice, the deliberate absences that no data source knows about. So this takes
 * the other half of the trade: every fact in it that EXISTS AS DATA is asserted
 * against that data, and the prose stays a human's. Drift becomes a CI failure
 * instead of a discovery.
 */

// BUILT, not read from disk. That is the change #451 asked for: the file cannot be
// stale because there is no file, and these assertions therefore run against
// exactly the bytes a crawler will fetch.
const LLMS = buildLlmsTxt();

describe("llms.txt states the prices the product actually charges", () => {
  it("names each plan's monthly price", () => {
    // The single most-quoted fact in the file, and the one a stale copy gets
    // most embarrassingly wrong — a machine reading an old price will repeat
    // it to somebody deciding whether to buy.
    for (const [plan, pricing] of Object.entries(PLAN_PRICING)) {
      expect(LLMS, `${plan} price`).toContain(`$${pricing.monthlyDollars}/mo`);
    }
  });

  it("names each plan's seat count", () => {
    for (const [plan, pricing] of Object.entries(PLAN_PRICING)) {
      expect(LLMS, `${plan} seats`).toMatch(
        new RegExp(String.raw`${pricing.seats}\s+(teammates|people)`),
      );
    }
  });

  it("names the one-time registration fee", () => {
    expect(LLMS).toContain(`$${US_REGISTRATION_FEE_DOLLARS} fee`);
  });
});

describe("llms.txt keeps up with what shipped", () => {
  it("lists EVERY blog post, by title and url", () => {
    // #451's definition of done: publishing a post updates this file with no
    // human step. It derives from BLOG_POSTS now, so this asserts the derivation
    // rather than hoping somebody remembered — and it is `every`, not "all or
    // none", because a partial list is the failure the old assertion tolerated.
    const missing = BLOG_POSTS.filter(
      (post) =>
        !LLMS.includes(post.title) ||
        !LLMS.includes(absoluteUrl(blogPostPath(post.slug))),
    ).map((post) => post.slug);
    expect(
      missing,
      `\n\nPosts absent from llms.txt: ${missing.join(", ")}\n\n` +
        `These come from BLOG_POSTS, so this failing means the derivation broke, ` +
        `not that somebody forgot to type them.\n`,
    ).toEqual([]);
  });

  it("links every page it says it links, at a url that exists in LIVE_ROUTES", () => {
    // Every URL is built from LIVE_ROUTES, so a route rename cannot leave a dead
    // link. Asserted rather than assumed because the grouped lines (trades,
    // comparisons, legal) are hand-assembled and a typo there would be silent.
    const missing = notedRoutes().filter(
      (route) => !LLMS.includes(absoluteUrl(LIVE_ROUTES[route])),
    );
    expect(missing, `noted routes not present in the output: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("mentions the trades, comparisons and legal pages it groups", () => {
    // The grouped lines are the ones with no per-item note, so nothing else would
    // catch a route silently dropped from them.
    for (const route of [
      "forPlumbers",
      "forHvac",
      "forLandscapers",
      "forCleaners",
      "forSalons",
      "forContractors",
      "compareHeymarket",
      "compareQuo",
      "terms",
      "privacy",
      "messaging",
      "aup",
      "fairUse",
      "refunds",
      "cookies",
    ] as const) {
      expect(LLMS, `${route} is grouped but its url is absent`).toContain(
        absoluteUrl(LIVE_ROUTES[route]),
      );
    }
  });

  it("describes the AI features, which shipped to three clients", () => {
    // #434: the file was current through the calls feature and contained ZERO
    // occurrences of these, a fortnight after they shipped. A machine asked
    // "does this product use AI" would have answered no.
    const lower = LLMS.toLowerCase();
    for (const term of ["ai", "transcri"]) {
      expect(lower, `llms.txt never mentions "${term}"`).toContain(term);
    }
  });

  it("states each AI default the way the Worker actually ships it", () => {
    // The defect found while closing #434: the file said "opt-in, off by
    // default" and "every AI feature is off until an owner turns it on" when
    // every setting defaulted TRUE server-side. It understated what the product
    // does with message text, which is the one direction a privacy claim must
    // never be wrong in.
    //
    // #491 FOUND THE OTHER HALF OF THAT BUG. The original guard forbade the
    // string "off by default" anywhere in the AI section — correct while all
    // the settings were true, and wrong the moment `voicemail_intake` shipped
    // OFF (#367/D89). A test written to stop the file understating what we do
    // ended up forbidding it from stating a true, privacy-relevant fact.
    //
    // So the defaults are READ from the source that enforces them, exactly as
    // the caps assertion below reads the caps. Flip a default in the Worker and
    // this fails until the file says so, in either direction.
    const settingsSrc = readFileSync(
      join(process.cwd(), "..", "api", "src", "ai", "settings.ts"),
      "utf8",
    );
    const block = settingsSrc.slice(
      settingsSrc.indexOf("export const DEFAULT_AI_SETTINGS"),
    );
    const defaults = [
      ...block.slice(0, block.indexOf("};")).matchAll(
        /^\s*(\w+):\s*(true|false),/gm,
      ),
    ].map(([, key, value]) => ({ key, on: value === "true" }));

    // The parse itself has to be load-bearing: an empty match set would make
    // every assertion below vacuously pass.
    expect(defaults.length).toBeGreaterThanOrEqual(4);

    const aiSection = LLMS.slice(
      LLMS.indexOf("## AI features"),
      LLMS.indexOf("## Optional add-on modules"),
    );
    expect(aiSection.length).toBeGreaterThan(100);
    // Never the #434 claim, whatever the defaults are.
    expect(aiSection).not.toMatch(/every AI feature is off/i);
    expect(aiSection).toMatch(/switch/i);

    if (defaults.some((d) => d.on)) {
      expect(aiSection).toMatch(/on by default/i);
    }
    // Every feature that genuinely ships OFF has to be named as off, so a
    // fifth toggle cannot arrive undocumented the way this one did.
    for (const off of defaults.filter((d) => !d.on)) {
      expect(
        aiSection,
        `${off.key} defaults OFF and llms.txt does not say so`,
      ).toMatch(/off by default/i);
    }
  });

  it("states the AI caps that the API actually enforces", () => {
    // Presence tests cannot catch a wrong NUMBER, and a stale cap on the file
    // whose job is describing us is the same class of miss as the omission. So
    // the numbers are read out of the source that enforces them rather than
    // copied — which is how I caught two of my own three wrong on the way in.
    const caps: { file: string; constant: string }[] = [
      {
        file: "messaging/reply-suggestions.ts",
        constant: "SUGGEST_REPLY_MONTHLY_CAP",
      },
      {
        file: "calls/voicemail-transcript.ts",
        constant: "VOICEMAIL_TRANSCRIPT_MONTHLY_CAP",
      },
      { file: "tasks/enrichment.ts", constant: "ENRICHMENT_MONTHLY_CAP" },
    ];

    for (const { file, constant } of caps) {
      const source = readFileSync(
        join(process.cwd(), "..", "api", "src", file),
        "utf8",
      );
      const match = new RegExp(`${constant}\\s*=\\s*(\\d+)`).exec(source);
      expect(match, `${constant} not found in apps/api/src/${file}`).not.toBeNull();
      const value = Number(match?.[1]);
      // Formatted with a thousands separator in prose, bare below 1000.
      const written = value >= 1000 ? value.toLocaleString("en-US") : String(value);
      expect(
        LLMS,
        `llms.txt does not state ${constant} (${written}). A cap the file gets ` +
          `wrong is worse than one it omits: a machine repeats it as fact.`,
      ).toContain(written);
    }
  });
});
