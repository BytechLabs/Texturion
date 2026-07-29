/**
 * #339 — comparing app versions, in one place, because five places would
 * disagree.
 *
 * The same question is asked by the SQL constraint (`version_key`), the ops
 * script that sets a floor, and each of the three clients deciding whether to
 * prompt or block. A disagreement between any two of them is not a cosmetic
 * bug: it is a client that exempts itself from a floor, or one that blocks
 * itself against a floor nobody set.
 *
 * TWO RULES, and both exist to fail safe:
 *
 *   1. UNPARSEABLE IS NEVER NEWER. A version we cannot read compares as
 *      "unknown", and every caller here treats unknown as "do not act". A
 *      lenient parser that read `1.4.0-beta` as 1.4.0 would let a build claim
 *      compliance it does not have; one that read garbage as Infinity would
 *      exempt it entirely.
 *   2. A MISSING POLICY DEMANDS NOTHING. No floor, no prompt. The endpoint
 *      fails open, the clients fail open, and the two agree — because the cost
 *      of a missed prompt is one person on last week's build, and the cost of
 *      a false block is every customer's business phone at once.
 *
 * Hand-ported to Kotlin (`AppVersion.kt`) and Swift (`AppVersion.swift`). The
 * ports are covered by their own tests asserting the same table of cases,
 * because shared logic that is hand-copied drifts silently otherwise.
 */

/** Up to four dot-separated numeric segments. Mirrors the SQL CHECK exactly. */
const VERSION_PATTERN = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$/;

/**
 * A version as four comparable integers, or `null` when it is not a version.
 *
 * Padded to four so `2` and `2.0.0.0` are the same build, and compared
 * segment-wise so 1.10.0 outranks 1.9.0 — which a string compare gets
 * backwards, and which is exactly the shape of a real release sequence.
 */
export function versionKey(version: string | null | undefined): number[] | null {
  if (!version || !VERSION_PATTERN.test(version)) return null;
  const parts = version.split(".").map((segment) => Number(segment));
  return [0, 1, 2, 3].map((index) => parts[index] ?? 0);
}

/**
 * Is `version` strictly older than `floor`?
 *
 * `false` whenever either side is unreadable. That is the whole safety
 * property: an unknown version is never judged to be behind, so a parse
 * failure can never lock somebody out.
 */
export function isOlderThan(
  version: string | null | undefined,
  floor: string | null | undefined,
): boolean {
  const a = versionKey(version);
  const b = versionKey(floor);
  if (!a || !b) return false;
  for (let i = 0; i < 4; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/** The policy as the public GET /app-release returns it. */
export interface AppReleasePolicy {
  platform: string;
  recommended_version: string | null;
  minimum_version: string | null;
  message: string | null;
  update_url: string | null;
}

/**
 * What the app should do about the build it is running.
 *
 * - `"none"`  — nothing to say. The overwhelmingly common answer.
 * - `"soft"`  — an update exists and is worth having. Dismissible, never
 *               blocking, and it costs the user nothing to ignore.
 * - `"block"` — below the floor. This takes somebody's business phone away
 *               until they act, so D71 reserves it for security or genuine
 *               incompatibility.
 */
export type UpdateRequirement = "none" | "soft" | "block";

/**
 * Decide once, so three clients cannot decide differently.
 *
 * BLOCK WINS over soft, but only when the floor is both set and genuinely
 * newer than what is installed. Every uncertainty — no policy, no version, an
 * unreadable version on either side — resolves to "none", which is the answer
 * that leaves the person working.
 */
export function updateRequirement(
  current: string | null | undefined,
  policy: AppReleasePolicy | null | undefined,
): UpdateRequirement {
  if (!policy) return "none";
  // A client that does not know its own version cannot be judged behind. In
  // practice this is a misconfigured build, and blocking it would turn a build
  // mistake into a customer outage.
  if (!versionKey(current)) return "none";

  if (isOlderThan(current, policy.minimum_version)) return "block";
  if (isOlderThan(current, policy.recommended_version)) return "soft";
  return "none";
}
