/**
 * #303 — telling somebody a signup might be in a prohibited category.
 *
 * The screen itself is in `@loonext/shared` because it is a pure function over
 * a string and belongs where the policy's vocabulary lives. This file is the
 * part that reaches a person, and it exists as its own module for one reason:
 * the signup route must never fail because an alert could not be sent.
 *
 * WHY AN EMAIL AND NOT A QUEUE. There is no ops UI, and inventing a review
 * table nobody opens would be worse than the email that already reaches
 * whoever reads the watch job's alerts. When there is a queue, this is one
 * call site to move.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: block provisioning. A keyword match on a
 * business name is weak evidence, and holding a real contractor's number until
 * somebody reads an email would punish them for being called Colt Plumbing.
 * The window between signup and a first send is hours at minimum; that is the
 * time a reviewer has, and it is enough.
 */
import type { CategoryMatch } from "@loonext/shared";
import { screeningSummary } from "@loonext/shared";

import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

export async function alertProhibitedCategory(
  env: Env,
  args: { companyId: string; name: string; matches: CategoryMatch[] },
): Promise<void> {
  if (args.matches.length === 0) return;

  const summary = screeningSummary(args.name, args.matches);
  const categories = [...new Set(args.matches.map((m) => m.category))].join(", ");

  const text = [
    summary,
    "",
    `Workspace: ${args.name}`,
    `ID: ${args.companyId}`,
    "",
    "Why you are seeing this: /legal/aup §4 prohibits these categories",
    "outright, and a carrier complaint against one of them lands on our",
    "account and every other customer's deliverability — not on theirs.",
    "Catching it now is worth a great deal; catching it at the complaint is",
    "worth nothing.",
    "",
    "What to do: look at the workspace before it sends. If it is what the",
    "name suggests, the ladder in docs/AUP-ENFORCEMENT.md starts with",
    "asking. If it is a plumber called Colt, nothing happens and this alert",
    "did its job.",
  ].join("\n");

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    // The subject says "check", not "violation". Whoever opens this is about
    // to look at a real business, and a subject line that has already decided
    // makes that harder to do fairly.
    subject: `Check a new workspace: possible ${categories}`,
    text,
    html: renderEmailHtml(text),
  });
}
