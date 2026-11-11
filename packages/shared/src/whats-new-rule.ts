/**
 * #756: a release that ships a feature says so in What's new.
 *
 * `scripts/check-whats-new.mjs` reads git and `packages/shared/whats-new.json`
 * and hands the window since the previous release to {@link judgeWhatsNew}. On
 * the push that merges a release the verdict can fail the gates, so nothing is
 * tagged or shipped until an entry lands; on any other push it only warns.
 *
 * Kept free of imports so the script can load it with Node's type stripping.
 */

export interface ReleaseWindow {
  /** Subjects of the commits since the previous release, the release commit itself excluded. */
  subjects: readonly string[];
  /** Entries and quiet-release records added to whats-new.json in the same window. */
  added: number;
  /** This push merges a release (its commit is `chore: release main`). */
  releasing: boolean;
}

export type WhatsNewVerdict =
  | { kind: "ok"; features: string[] }
  | { kind: "warn" | "fail"; features: string[] };

/** A conventional-commit feature, with or without a scope or a `!`. */
const FEATURE = /^feat(\([^)]*\))?!?:/;

/** The subject release-please gives the commit that merges a release. */
export const RELEASE_SUBJECT = /^chore: release main\b/;

export function judgeWhatsNew(window: ReleaseWindow): WhatsNewVerdict {
  const features = window.subjects.filter((subject) => FEATURE.test(subject));
  if (features.length === 0 || window.added > 0) return { kind: "ok", features };
  return { kind: window.releasing ? "fail" : "warn", features };
}
