"use client";

import type { ConversationEvent } from "@/lib/api/types";

import { statusLabel } from "@/components/inbox/status-pill";
import type { ConversationStatus } from "@/lib/api/types";

/** Day divider (G5): "Today", "Yesterday", "Jun 12" — centered, quiet. */
export function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

/**
 * Timeline event copy (G5: centered 12px stone-400 system lines with the
 * actor's name; G10 plain language).
 */
export function eventSentence(
  event: ConversationEvent,
  memberName: (userId: string | null) => string | null,
): string {
  const actor = memberName(event.actor_user_id);
  const by = actor ?? "JobText";
  switch (event.type) {
    case "status_changed": {
      const to = event.payload.to as ConversationStatus | undefined;
      if (to === "closed") return `${by} closed this conversation`;
      if (event.payload.from === "closed") {
        return `${by} reopened this conversation`;
      }
      return to
        ? `${by} marked this ${statusLabel(to).toLowerCase()}`
        : `${by} changed the status`;
    }
    case "assigned": {
      const to = event.payload.to as string | null | undefined;
      if (!to) return `${by} unassigned this conversation`;
      const assignee = memberName(to);
      return assignee
        ? `${by} assigned this to ${assignee}`
        : `${by} assigned this conversation`;
    }
    case "tag_added": {
      const name = event.payload.name;
      return typeof name === "string"
        ? `${by} added the tag “${name}”`
        : `${by} added a tag`;
    }
    case "tag_removed":
      return `${by} removed a tag`;
    case "opted_out":
      return actor
        ? `${actor} marked this customer as opted out`
        : "This customer opted out of texting";
    case "opt_out_revoked":
      return actor
        ? `${actor} marked this customer as opted in`
        : "This customer opted back in";
    case "consent_attested":
      return `${by} recorded that this customer asked to be texted`;
    case "quiet_hours_confirmed":
      return `${by} sent during this customer's quiet hours`;
    case "spam_marked":
      return `${by} marked this conversation as spam`;
    case "spam_unmarked":
      return `${by} unmarked spam`;
  }
}

export function SystemLine({
  event,
  memberName,
}: {
  event: ConversationEvent;
  memberName: (userId: string | null) => string | null;
}) {
  return (
    <p className="py-1 text-center text-xs text-muted-foreground/80">
      {eventSentence(event, memberName)}
    </p>
  );
}
