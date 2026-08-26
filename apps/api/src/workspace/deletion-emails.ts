/**
 * #371 — the paper trail for a deletion.
 *
 * An export emails when it is ready; a deletion said nothing at all. Under
 * PIPEDA and Law 25 the evidence that a request was honoured, and when, is the
 * artefact a regulator asks for — and until now the only record was a
 * `purged_at` timestamp and an audit row, neither of which the customer has.
 *
 * It matters outside compliance too. Closing a workspace takes effect at once
 * but finishes 30 days later, and the person who clicked had nothing in
 * writing saying which date that is or that it can still be undone until then.
 *
 * ONE SOURCE FOR THE COPY. The consequences below are docs/DELETION.md's
 * "What the customer is told", written once here and used by all three
 * emails, because the failure this file exists to prevent is the emails, the
 * confirmation screens and the public page drifting into three different
 * promises about the same operation.
 *
 * NOTHING HERE CAN FAIL A DELETION. Every send goes through
 * {@link sendDeletionEmail}, which swallows the error into Sentry. A deletion
 * that reversed itself because Resend was down would be the worse bug by far:
 * the customer asked to leave, and telling them about it is our problem.
 */
import * as Sentry from "@sentry/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";

import { emailLayout, escapeHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/**
 * What outlives the workspace, and why. docs/DELETION.md, *What survives*:
 * total erasure is not available to us, and a deletion feature that claims it
 * is lying. Said in every deletion email, so nobody learns it later.
 */
const WHAT_SURVIVES = [
  "Anyone who told you to stop texting stays on the do-not-text list. That is " +
    "the law, and it protects them rather than us: a STOP belongs to the " +
    "person who sent it, not to the business they sent it to.",
  "A record that consent existed is kept for three years, with names and " +
    "message contents removed. Canadian anti-spam law sets that floor.",
] as const;

/** A date a person can read, in the one form both stores and regulators use. */
function readableDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "the scheduled date";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export interface DeletionEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Plain-text copy is written first and the HTML renders the same sentences —
 * a bulleted list rather than one paragraph, because these are the terms of
 * the thing and a wall of text is how terms go unread.
 */
function build(
  subject: string,
  opening: string[],
  bullets: readonly string[],
  closing: string[],
): DeletionEmail {
  const text = [
    ...opening,
    ...bullets.map((line) => `- ${line}`),
    ...closing,
  ].join("\n\n");
  const paragraph = (line: string) => `<p>${escapeHtml(line)}</p>`;
  const html = emailLayout(
    opening.map(paragraph).join("") +
      `<ul style="padding-left:20px;margin:16px 0;">` +
      bullets
        .map(
          (line) =>
            `<li style="margin-bottom:8px;">${escapeHtml(line)}</li>`,
        )
        .join("") +
      `</ul>` +
      closing
        .map(
          (line) =>
            `<p style="font-size:14px;color:#6E7163;">${escapeHtml(line)}</p>`,
        )
        .join(""),
  );
  return { subject, text, html };
}

/**
 * Sent the moment a workspace closes. Its job is to be the written version of
 * a screen the person has already navigated away from: what stopped now, what
 * happens on which date, and that there is still a way back until then.
 */
export function workspaceClosedEmail(args: {
  companyName: string;
  purgeAfter: string | null;
  numbersReleased: number;
  subscriptionCancelled: boolean;
}): DeletionEmail {
  const when = args.purgeAfter ? readableDate(args.purgeAfter) : null;
  return build(
    `${args.companyName} is closed`,
    [
      `You closed ${args.companyName}. This email is your record of it.`,
      "Here is what that means.",
    ],
    [
      "Access ended immediately, for everyone on the crew. Nobody can sign in.",
      args.numbersReleased > 0
        ? "Your phone number has been released back to the carrier. That step " +
          "cannot be undone, and the number cannot be got back."
        : "Any phone number on the account is being released back to the " +
          "carrier. That step cannot be undone.",
      args.subscriptionCancelled
        ? "Billing is cancelled. You will not be charged again."
        : "There is no active subscription to cancel, so there is nothing " +
          "further to be charged.",
      when
        ? `Everything in the workspace is erased on ${when}: messages, ` +
          "photos, voicemails, contacts, tasks and notes."
        : "Everything in the workspace is erased after 30 days: messages, " +
          "photos, voicemails, contacts, tasks and notes.",
      ...WHAT_SURVIVES,
    ],
    [
      when
        ? `Closed by mistake? Reply to this email before ${when} and we can ` +
          "undo it. After that date nobody can, including us."
        : "Closed by mistake? Reply to this email within 30 days and we can " +
          "undo it. After that nobody can, including us.",
      "We will email you once more, on the day the erasure finishes.",
    ],
  );
}

/**
 * The receipt proper: sent when the purge completes. This is the one a
 * regulator asks for, so it names the date the erasure finished rather than
 * the date it was requested.
 */
export function workspacePurgedEmail(args: {
  companyName: string;
  purgedAt: Date;
  calendarCleanupUnconfirmed?: boolean;
  calendarCleanupUnconfirmedCount?: number;
}): DeletionEmail {
  const calendarWarning = args.calendarCleanupUnconfirmed
    ? [
        `We could not confirm removal of ${Math.max(
          1,
          args.calendarCleanupUnconfirmedCount ?? 1,
        )} linked calendar ${
          Math.max(1, args.calendarCleanupUnconfirmedCount ?? 1) === 1
            ? "copy"
            : "copies"
        } at the calendar provider. Check the connected calendar account and remove any remaining Loonext event. This receipt confirms erasure from Loonext only.`,
      ]
    : [];
  return build(
    "Your Loonext data has been erased",
    [
      `The erasure of ${args.companyName} finished on ${readableDate(args.purgedAt)}.`,
      "Keep this email. It is your confirmation that the deletion was carried out, and on what date.",
    ],
    [
      "Messages, photos, voicemails, contacts, tasks and notes are gone from " +
        "our database and our file storage.",
      "Your billing records at our payment provider are deleted.",
      ...calendarWarning,
      ...WHAT_SURVIVES,
    ],
    [
      "This is the last email you will get from us about this account. " +
        "There is nothing left to sign in to.",
      "If you have a question about it, replying to this email still reaches us.",
    ],
  );
}

/**
 * Sent to the address being deleted, and therefore BEFORE the identity is
 * severed — after `severAuthIdentity` runs there is no address left to send
 * to. Easy ordering to get wrong, so it is stated here and asserted in the
 * tests.
 */
export function accountDeletedEmail(args: {
  workspacesLeft: number;
}): DeletionEmail {
  const crews =
    args.workspacesLeft === 1
      ? "the crew you were on"
      : `the ${args.workspacesLeft} crews you were on`;
  return build(
    "Your Loonext account is deleted",
    [
      "Your Loonext account has been deleted. This email is your record of it.",
      "It was sent to this address before the address itself was removed, so it is the last one you will receive.",
    ],
    [
      "You can no longer sign in, and your name, email and phone number are " +
        "gone from our systems.",
      args.workspacesLeft > 0
        ? `You have been removed from ${crews}. Anything you had open — ` +
          "conversations and jobs — went back to them rather than being " +
          "deleted, because it is the business's work rather than yours."
        : "You were not on any crew, so there was nothing to hand back.",
      "The texts you sent to customers stay with the business that sent " +
        "them, attributed to a former member with no name attached. They are " +
        "that business's records, and part of them is a consent record " +
        "Canadian anti-spam law requires be kept for three years.",
    ],
    [
      "If you come back later, you will be signing up as a new person. " +
        "Nothing carries over.",
    ],
  );
}

/**
 * Send one, and never let it break the thing it is describing.
 *
 * A deletion is already done by the time we mail about it. Throwing here would
 * either fail a request whose work has completed or, worse, look like a reason
 * to roll one back. It raises in Sentry instead: an unsent receipt is our
 * obligation to chase, not the customer's problem to retry.
 */
export async function sendDeletionEmail(
  env: Env,
  to: string | null,
  email: DeletionEmail,
  context: string,
): Promise<{ sent: boolean; emailId: string | null }> {
  // No address is a legitimate outcome, not an error: an account with no email
  // on it, or one already severed by an earlier attempt. Callers pass the
  // lookup straight through rather than branching on it.
  if (!to) return { sent: false, emailId: null };
  try {
    // #386: the id comes back so the caller can store it against the row this
    // receipt belongs to. PIPEDA and Law 25 care that we RESPONDED, and an
    // accepted-id only proves we handed a message to a queue — the id is what
    // turns that into "delivered at 14:02" once the webhook lands.
    const { id } = await sendEmail(env, {
      to: [to],
      subject: email.subject,
      text: `${email.text}\n`,
      html: email.html,
    });
    return { sent: true, emailId: id };
  } catch (cause) {
    Sentry.captureMessage(
      `deletion receipt not sent (${context}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "error",
    );
    return { sent: false, emailId: null };
  }
}

/**
 * The address behind a user id. Returns null rather than throwing when the
 * identity is already gone — a second delivery attempt against a severed
 * account is a no-op, not a failure.
 */
export async function lookupUserEmail(
  db: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error) throw new Error(error.message);
    const email = data.user?.email;
    // Severed identities are parked on `.invalid` (RFC 2606) by
    // `severAuthIdentity`; mailing one is guaranteed to bounce.
    if (!email || email.endsWith("@account.invalid")) return null;
    return email;
  } catch (cause) {
    Sentry.captureMessage(
      `deletion receipt: could not resolve an address for ${userId}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      "warning",
    );
    return null;
  }
}
