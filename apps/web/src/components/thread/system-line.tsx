"use client";

import {
  APPOINTMENT_CONFIRMED_EVENT,
  APPOINTMENT_CONFIRMED_LINE,
} from "@loonext/shared";

import type { ConversationEvent } from "@/lib/api/types";

import { VoicemailPlayer } from "@/components/calls/voicemail-player";
import { statusLabel } from "@/components/inbox/status-pill";
import { taskEventSentence } from "@/components/tasks/task-activity";
import { useTaskDrawer } from "@/components/tasks/use-task-drawer";
import { formatCallDuration } from "@/lib/format/call";
import type { ConversationStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { doneEventSentence } from "./done";
import { eventTarget } from "./event-target";

/** Day divider (mockup .daymark): a centered bordered stone chip, not a rule. */
export function DayDivider({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center py-1.5"
      role="separator"
      aria-label={label}
    >
      <span className="rounded-full border border-app-line bg-app-ground px-3 py-[3px] text-[11px] font-semibold text-app-muted-2">
        {label}
      </span>
    </div>
  );
}

/**
 * Timeline event copy (G5: centered 12px stone-400 system lines with the
 * actor's name; G10 plain language). `messageBody` resolves a message id to
 * its live body for the §4.3 done/undone lines — it is joined at render time,
 * never stored in the event payload.
 */
export function eventSentence(
  event: ConversationEvent,
  memberName: (userId: string | null) => string | null,
  messageBody: (messageId: string) => string | undefined = () => undefined,
): string {
  const actor = memberName(event.actor_user_id);
  const by = actor ?? "Loonext";
  switch (event.type) {
    case "status_changed": {
      const to = event.payload.to as ConversationStatus | undefined;
      if (to === "closed") return `${by} closed this conversation`;
      if (event.payload.from === "closed") {
        return `${by} reopened this conversation`;
      }
      // `to` is an unsafe cast of an untrusted event payload; an unmapped
      // status would make statusLabel(...) undefined and .toLowerCase() throw,
      // tearing down the entire thread render. Fall back to the generic line.
      const label = to ? (statusLabel(to) as string | undefined) : undefined;
      return label
        ? `${by} marked this ${label.toLowerCase()}`
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
      // #76: the timeline keeps its when/who audit role but no longer echoes the
      // composer's "This customer opted out of texting. Sends are blocked."
      // banner word-for-word (that banner stays the single present-state surface).
      return actor
        ? `${actor} marked this customer as opted out`
        : "Opted out of texting";
    case "opt_out_revoked":
      return actor
        ? `${actor} marked this customer as opted in`
        : "Opted back in";
    case "consent_attested":
      return `${by} recorded that this customer asked to be texted`;
    case "quiet_hours_confirmed":
      return `${by} sent during this customer's quiet hours`;
    // #237: the actor is the CUSTOMER, who has no user row — so this is the
    // one system line that must not be prefixed with a member's name. "Sam
    // confirmed the appointment" would credit the crew with the customer's
    // answer, which is the whole value of the reply.
    case APPOINTMENT_CONFIRMED_EVENT:
      return APPOINTMENT_CONFIRMED_LINE;
    case "spam_marked":
      return `${by} marked this conversation as spam`;
    case "spam_unmarked":
      return `${by} unmarked spam`;
    // §4.2/§4.3: done audit. The body is joined live from the message the
    // event points at (payload.message_id) — never a stored excerpt.
    case "message_done":
    case "message_undone": {
      const messageId =
        typeof event.payload.message_id === "string"
          ? event.payload.message_id
          : null;
      return doneEventSentence(
        event,
        by,
        messageId ? messageBody(messageId) : undefined,
      );
    }
    // TASKS-V2 D-C: task lifecycle interwoven in the thread as quiet system
    // lines (e.g. "Jordan turned this into a task", "assigned to Marcus",
    // "due today 3:00 PM", "task removed"). Shared copy with the drawer.
    case "task_created":
    case "task_assigned":
    case "task_due_set":
    case "task_deleted":
    case "task_attachment_added":
    case "task_attachment_removed":
      return taskEventSentence(event, by, memberName) ?? `${by} updated a task`;
    // #317 — a file this customer sent that we would not store. There is no
    // attachment row to render, which is the whole point, so this line stands in
    // its place: without it the crew sees a text with no picture and concludes
    // the customer forgot to attach one.
    //
    // Every arm ends in what to DO about it, because that is the only part the
    // crew can act on between jobs. The reasons the customer can fix say so; the
    // one they cannot does not send them back to try the same file again.
    case "media_refused": {
      const reason = event.payload.reason;
      if (reason === "too_large")
        return "A file this customer sent was too big to save — ask them to send a smaller one";
      if (reason === "empty")
        return "A file this customer sent arrived empty — ask them to send it again";
      if (reason === "type_mismatch")
        return "A file this customer sent wasn't the kind of file it claimed to be, so it wasn't saved";
      // #317: the file WAS the type it claimed and the type is allowed — what
      // is inside it is the problem. The crew gets one line and one action:
      // which of a macro project, a packed program or an auto-running script
      // it turned out to be changes nothing they can do about it.
      if (reason === "unsafe_content")
        return "A file this customer sent had something unsafe inside it, so it wasn't saved — ask them for a photo or a plain PDF";
      if (reason === "unreadable")
        return "A file this customer sent couldn't be checked, so it wasn't saved — ask them to send it again";
      if (reason === "too_many_items") {
        const kept = Number(event.payload.index ?? 0);
        return kept > 0
          ? `This message came with more files than we can save — the first ${kept} were kept`
          : "This message came with more files than we can save";
      }
      // unsupported_type, and anything a later server adds: the honest general
      // case, still ending in the thing that works.
      return "A file this customer sent can't be shown here — ask them to send a photo or a PDF";
    }
    // D19 note-attachment audit — a quiet line matching the task attachment copy.
    case "note_attachment_added":
      return `${by} attached a file to a note`;
    case "note_attachment_removed":
      return `${by} removed a file from a note`;
    // FEATURE-GAPS voice wave: the computed-missed call + its auto text-back,
    // in the crew's plain language (the message itself renders just below).
    case "missed_call":
      return "This customer called and no one picked up, so we texted them back";
    // #129 Calls feature: every threaded call leaves one honest line — the
    // thread reads as the full history, texts AND calls. A missed call with
    // text-back shows this line plus the missed_call line above.
    case "call_completed": {
      const outcome = event.payload.outcome as string | undefined;
      const seconds = Number(event.payload.forward_seconds ?? 0);
      // D38: outbound bridge calls speak from the crew's side.
      if (event.payload.direction === "outbound") {
        if (outcome === "missed") return "Called, no answer";
        return seconds > 0
          ? `You called · ${formatCallDuration(seconds)}`
          : "You called";
      }
      // D43 phase 3: the transfer journey line — who handed the call to whom.
      if (event.payload.kind === "transferred") {
        const to = memberName(
          typeof event.payload.to_user_id === "string"
            ? event.payload.to_user_id
            : null,
        );
        const from = memberName(
          typeof event.payload.from_user_id === "string"
            ? event.payload.from_user_id
            : null,
        );
        if (to && from) return `${from} transferred the call to ${to}`;
        return to ? `Call transferred to ${to}` : "Call transferred";
      }
      // D43: the dedicated voicemail line (kind:'voicemail') carries the
      // message duration; SystemLine renders the player under it.
      if (event.payload.kind === "voicemail") {
        const vmSeconds = Number(event.payload.voicemail_seconds ?? 0);
        return vmSeconds > 0
          ? `Left a voicemail · ${formatCallDuration(vmSeconds)}`
          : "Left a voicemail";
      }
      if (outcome === "voicemail") return "Call went to voicemail";
      if (outcome === "missed") return "Missed call";
      // #517: WHO picked up. On a crew, "Call answered" leaves out the one
      // thing the rest of them wanted to know — and the name is what turns the
      // line from a log entry into an answer to "did anyone deal with this?".
      // Falls back to the bare line when the answerer is unknown (a call from
      // before the server started reporting it) or is somebody no longer on
      // the roster: "Call answered by " with nothing after it would be worse
      // than the line it replaced.
      const answeredBy = memberName(
        typeof event.payload.answered_by_user_id === "string"
          ? event.payload.answered_by_user_id
          : null,
      );
      const answered = answeredBy ? `Call answered by ${answeredBy}` : "Call answered";
      return seconds > 0
        ? `${answered} · ${formatCallDuration(seconds)}`
        : answered;
    }
  }
}

/**
 * #465: an event line that goes somewhere.
 *
 * The timeline is deliberately quiet, so the affordance has to be too: a
 * dotted underline in the line's own colour at rest, going solid and olive on
 * hover. The dotted rest state is the part that matters — hover does not
 * exist on the phone, and without it a touch user has no way to learn the
 * line is live short of tapping every one of them.
 */
function ActionableLine({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  /** Says where this goes, for the people who cannot see the underline. */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="py-1 text-center text-xs text-muted-foreground">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "tap-target rounded-full px-1 underline decoration-dotted underline-offset-[3px] transition-colors",
          "decoration-app-line hover:text-app-olive hover:decoration-solid hover:decoration-current",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        {children}
      </button>
    </p>
  );
}

export function SystemLine({
  event,
  memberName,
  messageBody,
  onJumpToMessage,
}: {
  event: ConversationEvent;
  memberName: (userId: string | null) => string | null;
  /** Resolve a message id → its live body for §4.3 done/undone lines. */
  messageBody?: (messageId: string) => string | undefined;
  /**
   * #465: jump the thread to a message this line names. Optional because the
   * line also renders outside the virtualized list (tests, the contact
   * timeline), where there is nothing to scroll.
   */
  onJumpToMessage?: (messageId: string) => void;
}) {
  const { openTask } = useTaskDrawer();
  const sentence = eventSentence(event, memberName, messageBody);

  // Forward/backward compatibility: event types this build doesn't narrate
  // (e.g. historic `review_requested` rows from the removed one-tap review ask,
  // or types added by a newer server) render nothing instead of a blank line.
  if (!sentence) return null;

  // TASKS-V2 D-C + #465: a task line opens the task drawer (`?task=<id>`), and
  // a done/undone line goes to the message it quotes. Both resolved by the
  // shared pure selector, which the Kotlin and Swift ports mirror.
  const target = eventTarget(event);

  if (target?.kind === "task") {
    return (
      <ActionableLine
        onClick={() => openTask(target.id)}
        label={`${sentence}. Open the task`}
      >
        {sentence}
      </ActionableLine>
    );
  }

  // A done line reads like a reference to a specific message and was not one.
  // `onJumpToMessage` is absent wherever there is nothing to scroll, and then
  // the line stays plain rather than offering a click that does nothing.
  if (target?.kind === "message" && onJumpToMessage) {
    const messageId = target.id;
    return (
      <ActionableLine
        onClick={() => onJumpToMessage(messageId)}
        label={`${sentence}. Go to that message`}
      >
        {sentence}
      </ActionableLine>
    );
  }

  // D43: a voicemail line carries its message — the player renders right
  // under the sentence, fetched on demand (signed URL).
  const voicemailSession =
    event.type === "call_completed" &&
    event.payload.kind === "voicemail" &&
    typeof event.payload.call_session_id === "string"
      ? event.payload.call_session_id
      : null;
  if (voicemailSession) {
    const transcript =
      typeof event.payload.transcript === "string" &&
      event.payload.transcript.trim() !== ""
        ? event.payload.transcript
        : null;
    return (
      <div className="space-y-1.5 py-1 text-center">
        <p className="text-xs text-muted-foreground">{sentence}</p>
        <div className="flex justify-center">
          <VoicemailPlayer
            callSessionId={voicemailSession}
            seconds={Number(event.payload.voicemail_seconds ?? 0) || null}
            // Only when this line has no words of its own (an older voicemail,
            // written before transcription existed).
            showTranscript={!transcript}
          />
        </div>
        {/* The words, right where the message is. Without them the line only
            says a voicemail exists, which still leaves the reader having to
            stop and play it. */}
        {transcript && (
          <p className="mx-auto max-w-[36rem] text-[12.5px] leading-[1.45] text-app-muted">
            {transcript}
          </p>
        )}
      </div>
    );
  }

  return (
    // §3.2: timeline events are quiet by design — centered 12px, recede to
    // stone-500. (The spec's "stone-400" tertiary target fails AA at 2.5:1 as
    // read-for-meaning text; §6 mandates stone-500 where meta carries meaning.)
    <p className="py-1 text-center text-xs text-muted-foreground">{sentence}</p>
  );
}
