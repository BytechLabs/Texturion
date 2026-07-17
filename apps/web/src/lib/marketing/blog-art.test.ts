/**
 * Blog plate generator invariants: deterministic, bounded, unique per slug,
 * and accent-mark discipline (cards carry none; banner/og exactly one pair).
 */
import { describe, expect, it } from "vitest";

import { blogArt, type BlogArtVariant } from "./blog-art";
import { BLOG_POSTS } from "./blog";

const VARIANTS: BlogArtVariant[] = ["card", "banner", "og"];

/** Every numeric token in a path, for bounds/NaN checks. */
function pathNumbers(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe("blogArt", () => {
  it("is deterministic: same inputs, identical spec", () => {
    for (const variant of VARIANTS) {
      const a = blogArt("stop-giving-customers-your-personal-cell-number", "GUIDE", variant);
      const b = blogArt("stop-giving-customers-your-personal-cell-number", "GUIDE", variant);
      expect(a).toEqual(b);
    }
  });

  it("differs across slugs (each post owns its plate)", () => {
    const seen = new Set<string>();
    for (const post of BLOG_POSTS) {
      const spec = blogArt(post.slug, post.dateline, "card");
      const lead = spec.trails.find((t) => t.role === "lead")!.d;
      expect(seen.has(lead)).toBe(false);
      seen.add(lead);
    }
    expect(seen.size).toBe(BLOG_POSTS.length);
  });

  it("generates sane geometry for every registry post and variant", () => {
    for (const post of BLOG_POSTS) {
      for (const variant of VARIANTS) {
        const spec = blogArt(post.slug, post.dateline, variant);
        expect(spec.trails.length).toBeGreaterThanOrEqual(6);
        // Exactly one lead trail; the rest recede.
        expect(spec.trails.filter((t) => t.role === "lead")).toHaveLength(1);
        for (const trail of spec.trails) {
          expect(trail.d).toMatch(/^M-?\d/);
          const nums = pathNumbers(trail.d);
          expect(nums.length).toBeGreaterThan(8);
          for (const n of nums) {
            expect(Number.isFinite(n)).toBe(true);
            // Trails may start slightly off-canvas left but never fly away.
            expect(n).toBeGreaterThan(-spec.width * 0.2);
            expect(n).toBeLessThan(spec.width * 1.2);
          }
        }
        // Dock inside the canvas.
        expect(spec.dock.x).toBeGreaterThan(0);
        expect(spec.dock.x).toBeLessThan(spec.width);
        expect(spec.dock.y).toBeGreaterThan(0);
        expect(spec.dock.y).toBeLessThan(spec.height);
        // Ticks on-canvas.
        for (const tick of spec.ticks) {
          expect(tick.x).toBeGreaterThan(0);
          expect(tick.x).toBeLessThan(spec.width);
          expect(tick.y).toBeGreaterThan(0);
          expect(tick.y).toBeLessThan(spec.height);
        }
      }
    }
  });

  it("keeps accent marks off cards and puts exactly one pair on banner/og", () => {
    for (const post of BLOG_POSTS) {
      const card = blogArt(post.slug, post.dateline, "card");
      expect(card.waiting).toBeUndefined();
      expect(card.docked).toBeUndefined();
      for (const variant of ["banner", "og"] as const) {
        const spec = blogArt(post.slug, post.dateline, variant);
        expect(spec.waiting).toBeDefined();
        expect(spec.docked).toBeDefined();
        // The pair sits on-canvas (waiting rides the lead trail's 60% point).
        expect(spec.waiting!.x).toBeGreaterThan(-spec.width * 0.1);
        expect(spec.waiting!.x).toBeLessThan(spec.width);
      }
    }
  });

  it("survives an unknown dateline category (future posts never crash art)", () => {
    const spec = blogArt("some-future-post", "FIELD NOTES", "card");
    expect(spec.trails.length).toBeGreaterThan(0);
  });
});
