import type { AuditEntry } from "@/lib/api/types";

/**
 * #231 — turn one audit row into the sentence an owner actually reads.
 *
 * A log that renders `member.role_changed / member / 4f2a…` is technically a
 * record and practically unusable: the person reading it is usually not
 * technical, is often stressed, and needs to scan a page for the one line that
 * matters. So each row reads as something that happened, in the words the
 * product uses everywhere else.
 *
 * Pure and exported so it is unit-testable and shared: the web list, the CSV
 * column and any future mobile list must not drift into three different
 * descriptions of the same event.
 */

/** Actions, with the label a filter dropdown offers for each. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "member.invited": "Invited someone",
  "member.invite_revoked": "Cancelled an invite",
  "member.joined": "Joined the workspace",
  "member.role_changed": "Changed a role",
  "member.deactivated": "Removed a member",
  "member.reactivated": "Restored a member",
  "number_access.changed": "Changed number access",
  "settings.changed": "Changed settings",
  "billing.plan_changed": "Changed the plan",
  "billing.module_changed": "Changed an add-on",
  "contacts.imported": "Imported contacts",
  "contacts.exported": "Exported contacts",
  "contacts.bulk_deleted": "Deleted contacts in bulk",
};

/** "Sam" / "Someone" / "Loonext" — never a bare uuid in a sentence. */
export function auditActor(entry: AuditEntry): string {
  if (entry.actor_user_id === null) return "Loonext";
  return entry.actor_name?.trim() || "Someone";
}

function roleWord(value: unknown): string {
  return typeof value === "string" ? value : "their role";
}

/** The settings keys that moved, in words, e.g. "the caller ID and voicemail". */
function changedSettings(after: Record<string, unknown>): string {
  const NAMES: Record<string, string> = {
    name: "the workspace name",
    timezone: "the timezone",
    business_hours: "business hours",
    away_enabled: "the away reply",
    away_message: "the away message",
    mctb_enabled: "the missed-call text-back",
    mctb_message: "the missed-call message",
    first_message_identification: "first-message identification",
    quiet_hours_confirm_enabled: "the night-texting confirmation",
    voicemail_greeting: "the voicemail greeting",
    call_screening: "call screening",
    cnam_display_name: "the caller ID",
    cnam_submitted_at: "",
    caller_id_lookup: "caller ID lookup",
    overage_cap_multiplier: "the spending cap",
    enrich_task_address: "Lou's address pre-fill",
    enrich_task_due: "Lou's due-date pre-fill",
    suggest_replies: "Lou's reply drafts",
    transcribe_voicemail: "voicemail transcripts",
    voicemail_intake: "asking callers what the job is",
  };
  const named = Object.keys(after)
    .map((key) => NAMES[key] ?? key.replace(/_/g, " "))
    .filter((label) => label !== "");
  if (named.length === 0) return "settings";
  if (named.length === 1) return named[0];
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

function accessPhrase(after: Record<string, unknown>): string {
  if (after.access === "everyone") return "opened a number to everyone";
  if (after.access === "role") {
    return `limited a number to ${String(after.role ?? "a role")}s`;
  }
  const people = Number(after.people ?? 0);
  return `limited a number to ${people} ${people === 1 ? "person" : "people"}`;
}

/**
 * The full sentence, actor included. Falls back to the raw action for a row
 * written by a newer server than this build — an unknown action must still
 * read as something rather than vanish from the page.
 */
export function auditSentence(entry: AuditEntry): string {
  const who = auditActor(entry);
  const after = entry.after ?? {};
  const before = entry.before ?? {};

  switch (entry.action) {
    case "member.invited":
      return `${who} invited ${String(after.email ?? "someone")} as ${roleWord(after.role)}`;
    case "member.invite_revoked":
      return `${who} cancelled an invite`;
    case "member.joined":
      return `${who} joined as ${roleWord(after.role)}`;
    case "member.role_changed":
      return `${who} changed a member from ${roleWord(before.role)} to ${roleWord(after.role)}`;
    case "member.deactivated":
      return `${who} removed a member from the workspace`;
    case "member.reactivated":
      return `${who} restored a member`;
    case "number_access.changed":
      return `${who} ${accessPhrase(after)}`;
    case "settings.changed":
      return `${who} changed ${changedSettings(after)}`;
    case "billing.plan_changed":
      return `${who} changed the plan to ${String(after.plan ?? "another plan")}`;
    case "billing.module_changed":
      return `${who} changed an add-on`;
    case "contacts.imported":
      return `${who} imported ${String(after.count ?? "some")} contacts`;
    case "contacts.exported":
      return `${who} exported ${String(after.count ?? "some")} contacts`;
    case "contacts.bulk_deleted":
      return `${who} deleted ${String(after.count ?? "some")} contacts`;
    default:
      return `${who} — ${entry.action.replace(/[._]/g, " ")}`;
  }
}
