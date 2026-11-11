import { isCallEndReason, isCallRouting, type CallEndReason } from "@loonext/shared";

import type { MessageKey, Translate } from "@/i18n/provider";
import type { ActivityItem } from "@/lib/api/record-activity";
import { callEndReason, callRoutingReason, formatCallDuration } from "@/lib/format/call";
import { messageAutomationName } from "@/lib/format/message-automation";
import { formatTimestamp } from "@/lib/format/time";
import { threadHref } from "@/lib/inbox/thread-href";

/**
 * #714: what one activity row says, and where it points. Pure, so every
 * surface (contact, job, thread, call) reads one event the same way and the
 * sentences are testable without a DOM.
 */
export type ActivityIcon =
  | "text"
  | "call"
  | "voicemail"
  | "edit"
  | "tag"
  | "person"
  | "link"
  | "stop"
  | "check"
  | "merge"
  | "trash"
  | "mention"
  | "clock";

export interface ActivityLine {
  text: string;
  icon: ActivityIcon;
  /** Where the row goes: the message, the job, the thread or the contact. Null when nothing is there to open. */
  href: string | null;
}

/** The field edit keys the server sends, as catalogue keys. */
const FIELD_KEYS: Record<string, MessageKey> = {
  name: "activity.fieldName",
  email: "activity.fieldEmail",
  business_name: "activity.fieldBusiness",
  address: "activity.fieldAddress",
  notes: "activity.fieldNotes",
  timezone: "activity.fieldTimezone",
  locale: "activity.fieldLocale",
  phone: "activity.fieldPhone",
  custom_fields: "activity.fieldCustom",
  other_phone: "activity.fieldOtherPhone",
  other_address: "activity.fieldOtherAddress",
  status: "activity.fieldStatus",
  spam: "activity.fieldSpam",
  title: "activity.fieldTitle",
  description: "activity.fieldDescription",
  due: "activity.fieldDue",
  reminders: "activity.fieldReminders",
  confirmation: "activity.fieldConfirmation",
  priority: "activity.fieldPriority",
  repeat: "activity.fieldRepeat",
  link_added: "activity.fieldLink",
  link_removed: "activity.fieldLink",
};

const TIME_FIELDS = new Set(["due", "confirmation"]);
const VALUE_MAX = 80;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const present = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== "";

function clip(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > VALUE_MAX ? `${one.slice(0, VALUE_MAX - 1)}…` : one;
}

/** A before or after value, as a reader would say it. */
export function activityValue(field: string, value: unknown, t: Translate): string {
  if (!present(value)) return t("activity.valueNone");
  if (typeof value === "boolean") {
    return value ? t("activity.valueYes") : t("activity.valueNo");
  }
  if (typeof value === "string") {
    if (TIME_FIELDS.has(field)) return formatTimestamp(value, { style: "long", t });
    return clip(value);
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    return clip(
      Object.values(value as Record<string, unknown>)
        .filter((part) => typeof part === "string" && part !== "")
        .join(", "),
    );
  }
  return t("activity.valueNone");
}

function fieldLabel(field: string, t: Translate): string {
  const key = FIELD_KEYS[field];
  return key ? t(key) : field;
}

function editSentence(item: ActivityItem, t: Translate): string {
  const field = str(item.payload.field) ?? "";
  const label = fieldLabel(field, t);
  const change = str(item.payload.change);
  if (change === "added") {
    return t("activity.fieldAdded", { field: label, to: activityValue(field, item.payload.to, t) });
  }
  if (change === "updated") {
    return t("activity.fieldUpdated", { field: label, to: activityValue(field, item.payload.to, t) });
  }
  if (change === "removed") return t("activity.fieldRemoved", { field: label });
  const hasFrom = present(item.payload.from);
  const hasTo = present(item.payload.to) || typeof item.payload.to === "boolean";
  if (hasFrom && hasTo) {
    return t("activity.editedFromTo", {
      field: label,
      from: activityValue(field, item.payload.from, t),
      to: activityValue(field, item.payload.to, t),
    });
  }
  if (hasTo) {
    return t("activity.editedTo", { field: label, to: activityValue(field, item.payload.to, t) });
  }
  if (hasFrom) {
    return t("activity.editedCleared", {
      field: label,
      from: activityValue(field, item.payload.from, t),
    });
  }
  return t("activity.editedBare", { field: label });
}

function callSentence(item: ActivityItem, t: Translate): string {
  const direction =
    item.payload.direction === "outbound" ? t("activity.callOutgoing") : t("activity.callIncoming");
  const outcome =
    item.payload.outcome === "answered"
      ? t("activity.outcomeAnswered")
      : item.payload.outcome === "voicemail"
        ? t("activity.outcomeVoicemail")
        : t("activity.outcomeMissed");
  const parts = [t("activity.callLine", { direction, outcome })];
  const talked = typeof item.payload.talk_seconds === "number" ? item.payload.talk_seconds : 0;
  if (talked > 0) parts.push(t("activity.callTalked", { duration: formatCallDuration(talked) }));
  const why = callEndReason((str(item.payload.ended_reason) as CallEndReason | null) ?? null, t);
  if (why) parts.push(why);
  return parts.join(" · ");
}

/** #725: why the call went to voicemail, from the machine or from the arrival route. */
function voicemailCause(cause: unknown, t: Translate): string | null {
  if (isCallEndReason(cause)) return callEndReason(cause, t);
  if (isCallRouting(cause)) return callRoutingReason(cause, t);
  return null;
}

/** #725: a step on a call's own timeline, or null when the kind is not one. */
function callStepSentence(
  item: ActivityItem,
  t: Translate,
  person: (id: unknown) => string,
): ActivityLine["text"] | null {
  const withWhy = (text: string, why: string | null) => (why ? `${text} · ${why}` : text);
  switch (item.kind) {
    case "call_arrived":
      return withWhy(
        t("activity.stepArrived"),
        isCallRouting(item.payload.routing) ? callRoutingReason(item.payload.routing, t) : null,
      );
    case "call_placed":
      return t("activity.stepPlaced");
    case "call_rang": {
      const ids = Array.isArray(item.payload.user_ids) ? item.payload.user_ids : [];
      const names = ids.map(person).join(", ");
      return item.payload.asked === true
        ? t("activity.stepAskedToRing", { names })
        : t("activity.stepRang", { names });
    }
    case "call_declined":
      return t("activity.stepDeclined");
    case "call_answered":
      return t("activity.stepAnswered");
    case "call_voicemail":
      return withWhy(t("activity.stepVoicemail"), voicemailCause(item.payload.cause, t));
    case "call_ended": {
      const seconds = typeof item.payload.seconds === "number" ? item.payload.seconds : 0;
      const parts = [t("activity.stepEnded")];
      if (seconds > 0) parts.push(t("activity.stepLasted", { duration: formatCallDuration(seconds) }));
      const why = isCallEndReason(item.payload.reason) ? callEndReason(item.payload.reason, t) : null;
      if (why) parts.push(why);
      return parts.join(" · ");
    }
    default:
      return null;
  }
}

function optOutSentence(item: ActivityItem, t: Translate): string {
  switch (str(item.payload.source)) {
    case "stop_keyword":
      return t("activity.optedOutStop");
    case "manual":
      return t("activity.optedOutManual");
    case "carrier":
      return t("activity.optedOutCarrier");
    case "import":
      return t("activity.optedOutImport");
    default:
      return t("activity.optedOut");
  }
}

/** Where a row's source lives, or null. */
export function activityHref(
  item: ActivityItem,
  recordType: string,
  recordId: string,
): string | null {
  const source = item.source;
  if (!source) return null;
  switch (source.type) {
    case "message":
      return source.conversation_id
        ? threadHref(source.conversation_id, { messageId: source.id })
        : null;
    case "call":
    case "conversation_event":
    case "scheduled_message":
      return source.conversation_id ? threadHref(source.conversation_id) : null;
    case "task":
      return source.id === recordId && recordType === "task" ? null : `/tasks?task=${source.id}`;
    case "task_comment":
      return null;
    case "contact":
      return source.id === recordId ? null : `/contacts/${source.id}`;
    default:
      return null;
  }
}

/**
 * @param nameOf resolves a member's user id to a display name, or null when
 *               the member has left or is not loaded.
 */
export function activityLine(
  item: ActivityItem,
  ctx: {
    t: Translate;
    recordType: string;
    recordId: string;
    nameOf: (userId: string | null) => string | null;
  },
): ActivityLine {
  const { t } = ctx;
  const href = activityHref(item, ctx.recordType, ctx.recordId);
  const person = (id: unknown) =>
    (typeof id === "string" ? ctx.nameOf(id) : null) ?? t("activity.someone");
  const line = (text: string, icon: ActivityIcon): ActivityLine => ({ text, icon, href });
  const title = str(item.payload.title);

  switch (item.kind) {
    case "text_in":
      return line(t("activity.textIn"), "text");
    case "text_out": {
      if (item.payload.automated !== true) return line(t("activity.textOut"), "text");
      const which = messageAutomationName(item.payload.automation, t);
      const sent = t("activity.textOutAutomated");
      return line(which ? `${sent} · ${which}` : sent, "text");
    }
    case "scheduled_queued":
      return line(t("activity.scheduledQueued"), "clock");
    case "scheduled_sent":
      return line(t("activity.scheduledSent"), "clock");
    case "scheduled_cancelled":
      return line(t("activity.scheduledCancelled"), "clock");
    case "call":
      return line(callSentence(item, t), "call");
    case "call_arrived":
    case "call_placed":
    case "call_rang":
    case "call_declined":
    case "call_answered":
    case "call_ended":
      return line(callStepSentence(item, t, person) ?? t("activity.unknownKind"), "call");
    case "call_voicemail":
      return line(callStepSentence(item, t, person) ?? t("activity.unknownKind"), "voicemail");
    case "voicemail": {
      const seconds =
        typeof item.payload.voicemail_seconds === "number" ? item.payload.voicemail_seconds : 0;
      return line(
        seconds > 0
          ? t("activity.voicemailLeftFor", { duration: formatCallDuration(seconds) })
          : t("activity.voicemailLeft"),
        "voicemail",
      );
    }
    case "created":
      return line(title ? t("activity.createdNamed", { title }) : t("activity.created"), "check");
    case "edited":
      return line(editSentence(item, t), "edit");
    case "tagged":
      return line(t("activity.tagged", { name: str(item.payload.name) ?? "" }), "tag");
    case "untagged":
      return line(t("activity.untagged", { name: str(item.payload.name) ?? "" }), "tag");
    case "merged":
      return line(
        t(item.payload.role === "merged_away" ? "activity.mergedAway" : "activity.mergedSurvivor", {
          name: str(item.payload.other_name) ?? t("activity.someone"),
        }),
        "merge",
      );
    case "unmerged":
      return line(t("activity.unmerged"), "merge");
    case "deleted":
      return line(t("activity.deleted"), "trash");
    case "restored":
      return line(t("activity.restored"), "trash");
    case "assigned":
      return line(t("activity.assignedTo", { name: person(item.payload.to_user_id) }), "person");
    case "unassigned":
      return line(
        item.payload.from_user_id
          ? t("activity.unassignedFrom", { name: person(item.payload.from_user_id) })
          : t("activity.unassigned"),
        "person",
      );
    case "mentioned":
      return line(t("activity.mentioned", { name: person(item.payload.user_id) }), "mention");
    case "referenced": {
      const kind = item.source?.type;
      return line(
        kind === "message"
          ? t("activity.referencedNote")
          : kind === "task"
            ? t("activity.referencedTask")
            : kind === "task_comment"
              ? t("activity.referencedComment")
              : t("activity.referenced"),
        "link",
      );
    }
    case "opted_out":
      return line(optOutSentence(item, t), "stop");
    case "opted_in":
      return line(t("activity.optedIn"), "stop");
    case "blocked":
      return line(t("activity.blocked"), "stop");
    case "unblocked":
      return line(t("activity.unblocked"), "stop");
    case "task_created":
      return line(
        title ? t("activity.taskCreated", { title }) : t("activity.taskCreatedBare"),
        "check",
      );
    case "task_completed":
      return line(
        title ? t("activity.taskCompleted", { title }) : t("activity.taskCompletedBare"),
        "check",
      );
    case "completed":
      return line(t("activity.completed"), "check");
    case "reopened":
      return line(t("activity.reopened"), "check");
    default:
      return line(t("activity.unknownKind"), "edit");
  }
}
