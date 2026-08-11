import { DEFAULT_LOCALE } from "@loonext/shared";

import { makeTranslate, type Translate } from "@/i18n/provider";
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
 *
 * ## #228: where the words are, and why the sentence is in pieces
 *
 * Every sentence below lives in `i18n/sections/appShell.ts`, next to the rest
 * of Settings › History. `t` arrives as an argument rather than from a hook,
 * because this module is read by the CSV column as well as the list and a
 * React dependency would put a screen inside a file format.
 *
 * The line is assembled from keyed pieces rather than one key per row because
 * the parts vary independently — who, which settings, how many people — and
 * each piece is a whole clause a translator can move. What is NOT keyed is what
 * the server wrote: a role name, a plan name, an email address and an unknown
 * action all interpolate verbatim, because a log that renames the things it
 * describes stops agreeing with the screen that changed them.
 */

/**
 * The default lookup, for the CSV column and for a test calling these bare.
 *
 * English is what every reader saw before this existed, so it is the right
 * failure. Built once at module load, matching the pattern the rest of the
 * extraction uses.
 */
const EN = makeTranslate(DEFAULT_LOCALE);

/** Actions, with the label a filter dropdown offers for each. */
export function auditActionLabels(t: Translate = EN): Record<string, string> {
  return {
    "member.invited": t("appShell.auditActionInvited"),
    "member.invite_revoked": t("appShell.auditActionInviteRevoked"),
    "member.joined": t("appShell.auditActionJoined"),
    "member.role_changed": t("appShell.auditActionRoleChanged"),
    "member.deactivated": t("appShell.auditActionDeactivated"),
    "member.reactivated": t("appShell.auditActionReactivated"),
    "number_access.changed": t("appShell.auditActionNumberAccess"),
    "settings.changed": t("appShell.auditActionSettings"),
    "billing.plan_changed": t("appShell.auditActionPlan"),
    "billing.module_changed": t("appShell.auditActionModule"),
    "contacts.imported": t("appShell.auditActionContactsImported"),
    "contacts.exported": t("appShell.auditActionContactsExported"),
    "contacts.bulk_deleted": t("appShell.auditActionContactsBulkDeleted"),
  };
}

/**
 * The same labels in English, for the filter dropdown until it is handed a `t`.
 *
 * Kept as a named export because the ACTION IDS are the dropdown's values as
 * well as its labels, and a screen iterating this needs the set whether or not
 * it has a lookup yet. Call {@link auditActionLabels} to get the reader's own.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = auditActionLabels();

/**
 * "Sam" / "Someone" / "Loonext" — never a bare uuid in a sentence.
 *
 * `Loonext` is the product's name and is not translated: a cron or a webhook is
 * a legitimate actor, and it is called the same thing in every language.
 */
export function auditActor(entry: AuditEntry, t: Translate = EN): string {
  if (entry.actor_user_id === null) return "Loonext";
  return entry.actor_name?.trim() || t("appShell.auditActorSomeone");
}

function roleWord(value: unknown, t: Translate): string {
  return typeof value === "string" ? value : t("appShell.auditRoleFallback");
}

/** The settings keys that moved, in words, e.g. "the caller ID and voicemail". */
function changedSettings(after: Record<string, unknown>, t: Translate): string {
  const NAMES: Record<string, string> = {
    name: t("appShell.auditSettingName"),
    timezone: t("appShell.auditSettingTimezone"),
    business_hours: t("appShell.auditSettingBusinessHours"),
    away_enabled: t("appShell.auditSettingAwayEnabled"),
    away_message: t("appShell.auditSettingAwayMessage"),
    mctb_enabled: t("appShell.auditSettingMctbEnabled"),
    mctb_message: t("appShell.auditSettingMctbMessage"),
    first_message_identification: t("appShell.auditSettingFirstMessageId"),
    quiet_hours_confirm_enabled: t("appShell.auditSettingQuietHours"),
    tags_locked: t("appShell.auditSettingTagsLocked"),
    voicemail_greeting: t("appShell.auditSettingVoicemailGreeting"),
    call_screening: t("appShell.auditSettingCallScreening"),
    cnam_display_name: t("appShell.auditSettingCnam"),
    // Bookkeeping that rides along with the caller ID, not a thing anybody
    // changed. Empty rather than absent so the filter below drops it.
    cnam_submitted_at: "",
    caller_id_lookup: t("appShell.auditSettingCallerIdLookup"),
    overage_cap_multiplier: t("appShell.auditSettingOverageCap"),
    enrich_task_address: t("appShell.auditSettingEnrichAddress"),
    enrich_task_due: t("appShell.auditSettingEnrichDue"),
    suggest_replies: t("appShell.auditSettingSuggestReplies"),
    transcribe_voicemail: t("appShell.auditSettingTranscribeVoicemail"),
    voicemail_intake: t("appShell.auditSettingVoicemailIntake"),
    call_wrapup: t("appShell.auditSettingCallWrapup"),
    summarize_threads: t("appShell.auditSettingSummarizeThreads"),
  };
  const named = Object.keys(after)
    // A key this build has no name for reads as itself with the underscores
    // opened out — untranslated, because it is a column name rather than copy.
    .map((key) => NAMES[key] ?? key.replace(/_/g, " "))
    .filter((label) => label !== "");
  if (named.length === 0) return t("appShell.auditSettingsFallback");
  if (named.length === 1) return named[0];
  // Two and three-or-more are the same shape: everything but the last, joined
  // by commas, then the last one after the conjunction.
  return t("appShell.auditListAnd", {
    items: named.slice(0, -1).join(", "),
    last: named[named.length - 1],
  });
}

function accessPhrase(after: Record<string, unknown>, t: Translate): string {
  if (after.access === "everyone") return t("appShell.auditAccessEveryone");
  if (after.access === "role") {
    return t("appShell.auditAccessRole", {
      role: String(after.role ?? t("appShell.auditAccessRoleFallback")),
    });
  }
  const people = Number(after.people ?? 0);
  // One and many are separate keys rather than one sentence with a plural
  // suffix: French agrees differently, and a sentence built by appending an
  // "s" is a sentence that only works in English.
  return people === 1
    ? t("appShell.auditAccessOnePerson")
    : t("appShell.auditAccessPeople", { count: people });
}

/**
 * The full sentence, actor included. Falls back to the raw action for a row
 * written by a newer server than this build — an unknown action must still
 * read as something rather than vanish from the page.
 */
export function auditSentence(entry: AuditEntry, t: Translate = EN): string {
  const who = auditActor(entry, t);
  const after = entry.after ?? {};
  const before = entry.before ?? {};

  switch (entry.action) {
    case "member.invited":
      return t("appShell.auditInvited", {
        who,
        email: String(after.email ?? t("appShell.auditEmailFallback")),
        role: roleWord(after.role, t),
      });
    case "member.invite_revoked":
      return t("appShell.auditInviteRevoked", { who });
    case "member.joined":
      return t("appShell.auditJoined", { who, role: roleWord(after.role, t) });
    case "member.role_changed":
      return t("appShell.auditRoleChanged", {
        who,
        before: roleWord(before.role, t),
        after: roleWord(after.role, t),
      });
    case "member.deactivated":
      return t("appShell.auditDeactivated", { who });
    case "member.reactivated":
      return t("appShell.auditReactivated", { who });
    case "number_access.changed":
      return t("appShell.auditNumberAccessChanged", {
        who,
        phrase: accessPhrase(after, t),
      });
    case "settings.changed":
      return t("appShell.auditSettingsChanged", {
        who,
        what: changedSettings(after, t),
      });
    case "billing.plan_changed":
      return t("appShell.auditPlanChanged", {
        who,
        plan: String(after.plan ?? t("appShell.auditPlanFallback")),
      });
    case "billing.module_changed":
      return t("appShell.auditModuleChanged", { who });
    case "contacts.imported":
      return t("appShell.auditContactsImported", {
        who,
        count: String(after.count ?? t("appShell.auditCountFallback")),
      });
    case "contacts.exported":
      return t("appShell.auditContactsExported", {
        who,
        count: String(after.count ?? t("appShell.auditCountFallback")),
      });
    case "contacts.bulk_deleted":
      return t("appShell.auditContactsDeleted", {
        who,
        count: String(after.count ?? t("appShell.auditCountFallback")),
      });
    default:
      return t("appShell.auditUnknownAction", {
        who,
        action: entry.action.replace(/[._]/g, " "),
      });
  }
}
