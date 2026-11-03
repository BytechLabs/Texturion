/**
 * #303 — telling somebody a signup might be in a prohibited category.
 *
 * The screen itself is in `@loonext/shared` because it is a pure function over
 * a string and belongs where the policy's vocabulary lives. This file is the
 * part that reaches a person, and it exists as its own module for one reason:
 * the signup route must never fail because an alert could not be sent.
 *
 * It is an ops notice, so the PostHog issue is the review queue: one per
 * workspace screened, with its status and history (D146). The notice names
 * the workspace by id and the categories matched, never the business name.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: block provisioning. A keyword match on a
 * business name is weak evidence, and holding a real contractor's number until
 * somebody reads a notice would punish them for being called Colt Plumbing.
 * The window between signup and a first send is hours at minimum; that is the
 * time a reviewer has, and it is enough.
 */
import { screeningSummary, type CategoryMatch } from "@loonext/shared";

import type { Env } from "../env";
import { opsNotice } from "../observability/capture";

export async function alertProhibitedCategory(
  env: Env,
  args: { companyId: string; matches: CategoryMatch[] },
): Promise<void> {
  if (args.matches.length === 0) return;

  await opsNotice(env, {
    key: "aup-signup-screen",
    // "Check", not "violation". Whoever opens this is about to look at a real
    // business, and a title that has already decided makes that harder to do
    // fairly.
    summary: "Check a new workspace: its name matches a prohibited category",
    detail: `company ${args.companyId}: ${screeningSummary(args.matches)}`,
    action:
      "/legal/aup section 4 prohibits these categories outright, and a carrier complaint " +
      "against one lands on our account and every other customer's deliverability. Look " +
      "at the workspace before it sends. If it is what the name suggests, the ladder in " +
      "docs/AUP-ENFORCEMENT.md starts with asking. If it is a plumber called Colt, " +
      "nothing happens.",
  });
}
