"use client";

import { memo } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { AlarmClock, Lock, Paperclip, Pin, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { mmsMediaKind, type MmsMediaKind } from "@loonext/shared";
import { attachmentLabel, sharedMediaKind } from "@/lib/attachments/media-label";
import type { ThreadData } from "@/lib/api/cache";
import { keys } from "@/lib/api/keys";
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationSnippet,
  MessageDirection,
  Tag,
} from "@/lib/api/types";
import { useCompanyId } from "@/lib/company/provider";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { isSnoozed } from "@/lib/api/filters";
import { snoozeReturnLabel } from "../thread/snooze-menu";

import { avatarColorClass, avatarInitials } from "../shell/avatar-color";
import { useMemberNames } from "./member-avatar";

/** The fixed row height the virtualizer estimates (avatar + name + 2-line
 * preview + a tag row). Keep in sync with the row's box in ConversationRow. */
export const ROW_HEIGHT = 96;

interface Snippet {
  direction: MessageDirection;
  body: string;
  hasAttachments: boolean;
  /** Shared kind of the attachments, 'file' when mixed, null when there are none. */
  attachmentKind: MmsMediaKind | null;
  attachmentCount: number;
}

/**
 * The G4 snippet source for a row. GET /v1/conversations rows embed
 * `last_message` (routes/conversations.ts — read, not guessed), so every row
 * has its snippet on a cold load. The thread/detail caches — seeded by opening
 * a thread, by sends, and by realtime `message.created` refetches — override
 * it whenever they hold something newer (a just-sent message lands in the
 * thread cache before any list refetch).
 */
function useSnippet(conversation: ConversationListItem): Snippet | null {
  const companyId = useCompanyId();
  const thread = useQuery<ThreadData>({
    queryKey: keys.thread(companyId, conversation.id),
    queryFn: skipToken,
  });
  const detail = useQuery<ConversationDetail>({
    queryKey: keys.conversations.detail(companyId, conversation.id),
    queryFn: skipToken,
  });
  const cached =
    thread.data?.pages[0]?.data[0] ?? detail.data?.messages.data[0] ?? null;
  const row: ConversationSnippet | null = conversation.last_message;

  // Caches win ties (they carry live delivery state); the row wins when the
  // list refetched ahead of a never-opened thread.
  if (
    cached &&
    (!row || Date.parse(cached.created_at) >= Date.parse(row.created_at))
  ) {
    // The cached message carries the attachments themselves, so the kind is
    // derived the same way the server derives it for the snippet.
    const kinds = (cached.attachments ?? []).map((a) =>
      mmsMediaKind(a.content_type),
    );
    return {
      direction: cached.direction,
      body: cached.body,
      hasAttachments: kinds.length > 0,
      attachmentKind: kinds.length > 0 ? (sharedMediaKind(kinds) ?? "file") : null,
      attachmentCount: kinds.length,
    };
  }
  if (row) {
    return {
      direction: row.direction,
      body: row.body,
      hasAttachments: row.has_attachments,
      attachmentKind: row.attachment_kind ?? null,
      // A server that has not shipped the count yet still reports the boolean.
      attachmentCount: row.attachment_count ?? (row.has_attachments ? 1 : 0),
    };
  }
  return null;
}

function snippetText(snippet: Snippet): string {
  const body = snippet.body.trim();
  if (body === "") {
    // Name what actually arrived — a voice message is not a "Photo" (founder
    // report), and "Attachment" told a crew nothing worth scanning for.
    return snippet.hasAttachments
      ? attachmentLabel(snippet.attachmentKind, snippet.attachmentCount)
      : "";
  }
  return body;
}

/** A tag chip (mockup .chip): a small rounded pill. The first tag reads as the
 * petrol "emphasis" chip; the rest are quiet stone chips. */
function TagChip({ tag, emphasis }: { tag: Tag; emphasis: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-[2.5px] text-[11px] font-semibold leading-none",
        emphasis
          ? "border-app-tint-line bg-app-tint text-app-olive-deep"
          : "border-transparent bg-app-line-soft text-app-muted",
      )}
    >
      {tag.name}
    </span>
  );
}

/**
 * The APP-SHELL-REDESIGN inbox row (mockup .row): a colored-initial avatar, the
 * contact name + a 2-line preview + a tabular time, an unread petrol dot, and up
 * to two tag chips. Differentiation is calm and hairline-only (PORTAL-UX: no
 * shadows): hover fills the row (stone tint + soft hairline); the SELECTED row
 * lifts to a white card with a solid hairline border (NOT a left accent bar).
 * All behavior (the /inbox/:id link, active state, spam view) is preserved.
 */
// Memoized: the virtualized inbox list re-renders on every scroll + #11 FLIP
// animation, but each cached `conversation` object + the boolean props are
// referentially stable, so a shallow compare skips re-rendering every row.
export const ConversationRow = memo(function ConversationRow({
  conversation,
  active,
  spamView,
}: {
  conversation: ConversationListItem;
  active: boolean;
  spamView: boolean;
}) {
  const memberNames = useMemberNames();
  const snippet = useSnippet(conversation);
  const unread = conversation.unread;
  const pinned = conversation.pinned_at !== null;
  // #414: flagged until the crew closes the thread. A badge that never clears
  // is decoration; closing is the product's existing word for "handled", so
  // it is the honest thing to clear on — no second notion of resolved, and no
  // timer quietly deciding an emergency stopped mattering.
  const emergency =
    conversation.emergency_at !== null && conversation.closed_at === null;
  const assigneeName = conversation.assigned_user_id
    ? memberNames.get(conversation.assigned_user_id)
    : undefined;

  const name = contactDisplayName(conversation.contact);
  const tags = conversation.tags.slice(0, 2);
  // #293: only in the Snoozed view does this row exist at all — but it also
  // survives a mid-session return, and a row that came back with no explanation
  // is the thing that makes people stop trusting the list.
  const snoozedUntil = isSnoozed(conversation)
    ? (conversation.snoozed_until ?? null)
    : null;

  const previewText = snippet
    ? `${snippet.direction === "outbound" ? "You: " : ""}${snippetText(snippet)}`
    : conversation.contact.name
      ? formatPhone(conversation.contact.phone_e164)
      : "";
  // With a caption, the preview shows the text and the clip icon carries the
  // media — so the attachment has to be spelled out for screen readers, which
  // never see the icon.
  const attachmentNote =
    snippet?.hasAttachments && snippet.body.trim() !== ""
      ? `, with ${attachmentLabel(snippet.attachmentKind, snippet.attachmentCount).toLowerCase()}`
      : "";

  return (
    <Link
      href={`/inbox/${conversation.id}`}
      aria-current={active ? "page" : undefined}
      // An explicit aria-label overrides the row's inner text for screen
      // readers, so EVERY state a sighted user sees (unread, pinned, internal
      // note, assignee, spam) plus the latest message must be folded in here —
      // otherwise those indicators (and the sr-only assignee span below) are
      // silent for AT.
      aria-label={`Conversation with ${name}${unread ? ", unread" : ""}${
        pinned ? ", pinned" : ""
      }${snippet?.direction === "note" ? ", internal note" : ""}${
        assigneeName ? `, assigned to ${assigneeName}` : ""
      }${spamView ? ", spam" : ""}${
        snoozedUntil
          ? `, snoozed, ${snoozeReturnLabel(snoozedUntil)}${
              conversation.snooze_note ? `, ${conversation.snooze_note}` : ""
            }`
          : ""
      }${attachmentNote}${previewText ? `. ${previewText}` : ""}`}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "relative flex items-start gap-[11px] rounded-app-card border p-[11px] transition-[background,box-shadow,border-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-app-line bg-app-paper"
          : "border-transparent hover:border-app-line-soft hover:bg-app-hover",
      )}
    >
      {/* Colored-initial avatar (stable per contact). */}
      <span
        aria-hidden
        className={cn(
          "grid size-[38px] shrink-0 place-items-center rounded-xl text-[13px] font-semibold text-app-olive-deep",
          avatarColorClass(conversation.contact_id || name),
        )}
      >
        {avatarInitials(name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              // §2.2 weight ceiling (#65): unread 600 vs read 500 — hierarchy
              // from one weight step, never 700.
              "truncate text-[14px] text-app-ink",
              unread ? "font-semibold" : "font-medium",
            )}
          >
            {name}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {/* #414 ask 2 — "visibly flagged in the inbox". A fourth quiet
                icon beside the pin and the clip would blend into the row's
                own rhythm, which is the opposite of what this state needs.
                Breaking that rhythm on purpose is what makes the thread
                findable at 11pm, and this is the one row state worth it. */}
            {emergency && (
              <span className="flex items-center gap-1 rounded-full bg-app-clay/12 px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-app-clay uppercase">
                <TriangleAlert className="size-3" strokeWidth={2.25} />
                Urgent
              </span>
            )}
            {pinned && (
              <Pin
                className="size-3 text-app-muted-2"
                strokeWidth={2}
                aria-label="Pinned"
              />
            )}
            <span
              className="text-[11.5px] tabular-nums text-app-muted-2"
              title={formatAbsoluteDateTime(conversation.last_message_at)}
            >
              {formatRelativeTime(conversation.last_message_at)}
            </span>
          </span>
        </span>

        <span
          // #61: --app-muted now clears AA on the white active card too
          // (5.87:1), so the old hardcoded darker hex for the active row is
          // gone — one token, both states, both themes.
          className="mt-[3px] flex items-start gap-1 text-[12.5px] leading-[1.45] text-app-muted"
        >
          {snippet?.direction === "note" && (
            <Lock
              className="mt-0.5 size-3 shrink-0 text-app-amber"
              strokeWidth={1.75}
              aria-label="Note"
            />
          )}
          {/* A message carrying media reads differently at a glance from one
              that is only text. The clip shows whenever there is an
              attachment — including alongside a caption, where the label alone
              would be invisible. The row's aria-label already names it. */}
          {snippet?.hasAttachments && (
            <Paperclip
              className="mt-0.5 size-3 shrink-0 text-app-muted-2"
              strokeWidth={1.75}
              aria-hidden
            />
          )}
          <span className="line-clamp-2 min-w-0 break-words">
            {previewText}
          </span>
        </span>

        {(tags.length > 0 || spamView || assigneeName || snoozedUntil) && (
          <span className="mt-[7px] flex flex-wrap items-center gap-[5px]">
            {/* The return time IS the row's reason for being in this view, so
                it leads — "Snoozed" without a when is the vanishing act #293
                calls worse than the problem. */}
            {snoozedUntil && (
              <span className="inline-flex items-center gap-1 rounded-full border border-app-line bg-app-ground px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-muted">
                <AlarmClock className="size-3" strokeWidth={1.75} aria-hidden />
                {snoozeReturnLabel(snoozedUntil)}
                {/* The reason, when one was left. "Waiting on the supplier"
                    three days later is the difference between a list you can
                    read and a list of names. */}
                {conversation.snooze_note && (
                  <span className="max-w-40 truncate font-normal text-app-muted-2">
                    · {conversation.snooze_note}
                  </span>
                )}
              </span>
            )}
            {spamView && (
              <span className="inline-flex items-center rounded-full border border-app-line px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-clay">
                Spam
              </span>
            )}
            {tags.map((tag, i) => (
              <TagChip key={tag.id} tag={tag} emphasis={i === 0 && !spamView} />
            ))}
            {assigneeName && (
              <span
                title={`Assigned to ${assigneeName}`}
                className="inline-flex items-center gap-1 rounded-full border border-app-line bg-app-ground px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-muted dark:text-app-muted"
              >
                {/* The chip shows only initials (title tooltip for pointer
                    users); the full name is announced to AT via the row's
                    aria-label, so no sr-only span here — it would be dead code
                    (the aria-label overrides all descendants). */}
                {avatarInitials(assigneeName)}
              </span>
            )}
          </span>
        )}
      </span>

      {/* Unread petrol dot, top-right (mockup .unread). */}
      {unread && (
        <span
          aria-hidden
          className="absolute right-3 top-[14px] size-2 rounded-full bg-primary"
        />
      )}
    </Link>
  );
});
