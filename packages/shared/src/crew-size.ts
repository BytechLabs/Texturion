/**
 * #370 — how big is the crew, asked once at signup.
 *
 * # Why this is the question worth asking
 *
 * Every competitor in `docs/marketing/competitor-site-teardowns.md` bills per
 * seat; we do not. So our price advantage is not a fixed discount — it widens
 * with every person the customer hires. At one user we are cheaper; at three we
 * are a third of Heymarket's worked example; at ten we are $79 against roughly
 * $150–490. Crew size is therefore the single fact that most changes how strong
 * our own pitch is, and until now nothing in the funnel knew it.
 *
 * # Why buckets and not a number
 *
 * A number invites a question the asker cannot answer confidently — does the
 * owner count themselves? the part-timer? the bookkeeper who only does
 * invoices? — and produces false precision in the reporting that follows. The
 * buckets are chosen to match the decisions they inform: solo is a different
 * product conversation, 2–3 fits Starter's three seats, 4–10 is where Pro and
 * the per-seat comparison start to matter, and 11+ is past D12's stated ICP and
 * past what the product currently serves well.
 *
 * That last one is the important one. #370's own scope says to check the
 * ceiling before promoting to larger crews, and a bucket that names the segment
 * we serve WORSE is how we notice we are selling to it.
 */

/** The buckets, in order. Stored as text; the order is the display order. */
export const CREW_SIZE_BUCKETS = ["solo", "2_3", "4_10", "11_plus"] as const;

export type CrewSizeBucket = (typeof CREW_SIZE_BUCKETS)[number];

/** True when a string is one of the buckets. */
export function isCrewSizeBucket(value: string): value is CrewSizeBucket {
  return (CREW_SIZE_BUCKETS as readonly string[]).includes(value);
}

/**
 * What the customer sees. Phrased as people rather than "seats" or "users",
 * because a plumber has a crew and a licence count is our word, not theirs.
 */
export const CREW_SIZE_LABELS: Record<CrewSizeBucket, string> = {
  solo: "Just me",
  "2_3": "2 to 3 of us",
  "4_10": "4 to 10",
  "11_plus": "More than 10",
};

/**
 * Which plan the bucket implies, for the signup hint and for plan-fit
 * reporting (#255).
 *
 * `null` for 11+ deliberately: Pro's seat limit is 15, so a crew past ten is
 * approaching a ceiling rather than comfortably inside a plan, and pretending
 * otherwise would recommend a plan the customer may outgrow during onboarding.
 * Saying nothing is the honest answer until #366 and #244 raise the ceiling.
 */
export function planFitForCrew(bucket: CrewSizeBucket): "starter" | "pro" | null {
  switch (bucket) {
    case "solo":
    case "2_3":
      return "starter";
    case "4_10":
      return "pro";
    case "11_plus":
      return null;
  }
}

/**
 * Whether this crew is past what the product currently serves well.
 *
 * #370 is explicit: "we should not market to a segment we serve worse." The
 * ceiling is real — MAX_LEGS_PER_SESSION is 24, Pro seats stop at 15, and #244's
 * on-call routing does not exist, so ring-all across a large crew is a worse
 * experience rather than a better one. This is the flag that lets a funnel
 * report say how much of the pipeline is in that segment before anybody decides
 * to chase it.
 */
export function isBeyondSupportedCrew(bucket: CrewSizeBucket): boolean {
  return bucket === "11_plus";
}
