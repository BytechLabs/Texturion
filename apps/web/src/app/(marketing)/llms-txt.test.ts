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

  it("does NOT claim the AI features are off by default, because they are not", () => {
    // The defect found while closing #434, and worse than the omission it
    // reported: the file said "opt-in, off by default" and "every AI feature is
    // off until an owner turns it on". All four settings default to TRUE
    // server-side — 20260723020000_ai_settings_default_on.sql flipped enrichment
    // deliberately. So the file understated what the product does with message
    // text, which is the one direction a privacy claim must never be wrong in.
    // Scoped to the AI section: "off by default" is a legitimate and accurate
    // claim elsewhere in the file (the optional temporary number offered during a
     // port really is off by default), so a whole-file match would forbid a true
    // sentence to catch a false one.
    const aiSection = LLMS.slice(
      LLMS.indexOf("## AI features"),
      LLMS.indexOf("## Optional add-on modules"),
    );
    expect(aiSection.length).toBeGreaterThan(100);
    expect(aiSection).not.toMatch(/off by default/i);
    expect(aiSection).not.toMatch(/every AI feature is off/i);
    // And it says the true thing, including that each one can be switched off.
    expect(aiSection).toMatch(/on by default/i);
    expect(aiSection).toMatch(/switch/i);
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
