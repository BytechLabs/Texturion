import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BLOG_POSTS } from "@/lib/marketing/blog";
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

const LLMS = readFileSync(
  join(fileURLToPath(new URL("../../../", import.meta.url)), "public/llms.txt"),
  "utf8",
);

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
  it("mentions every blog post it claims to list", () => {
    // The sitemap derives this and cannot fall behind. This file states its
    // own list, so it can — the same class of drift, caught the same way.
    const listed = BLOG_POSTS.filter((post) => LLMS.includes(post.slug));
    if (listed.length > 0) {
      expect(listed.length, "llms.txt lists some posts but not all").toBe(
        BLOG_POSTS.length,
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
});
