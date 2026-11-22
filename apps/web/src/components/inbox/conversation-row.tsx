"use client";

import { memo, useEffect, useRef } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  AlarmClock,
  BellOff,
  Lock,
  Paperclip,
  Pin,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { avatarInitials, isFlaggedUrgent, mmsMediaKind, URGENT_BADGE_LABEL } from '@loonext/shared';
import type { MmsMediaKind } from '@loonext/shared';
import { attachmentLabel, sharedMediaKind } from "@/lib/attachments/media-label";
import { useT } from "@/i18n/provider";
import { MemberAvatar } from "./member-avatar";
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
import { formatAbsoluteDateTime } from "@/lib/format/time";
import { inboxHref } from "@/lib/inbox/thread-href";
import { trackThreadLinkFocus, useInboxFocus } from "@/lib/inbox/navigation-focus";
import { RecordContextMenu } from "@/components/ui/record-menu";
import { CopyablePhoneNumber, phoneCopyOnHover } from "@/components/ui/copyable-phone-number";
import { Timestamp } from "@/components/ui/timestamp";
import { cn } from "@/lib/utils";

import { isSnoozed } from "@/lib/api/filters";
import { useConversationActions } from "../thread/conversation-actions";
import { deferralReturnLabel } from "../thread/snooze-menu";

import { avatarColorClass } from "../shell/avatar-color";
import { useMemberNames } from "./member-avatar";

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

function TagChip({ tag }: { tag: Tag }) {
  return (
    <span
      className="max-w-full truncate rounded-full bg-app-line-soft px-2 py-0.5 text-[11px] font-medium leading-tight text-app-muted"
    >
      {tag.name}
    </span>
  );
}

// Memoized: the virtualized inbox list re-renders on every scroll + #11 FLIP
// animation, but each cached `conversation` object + the boolean props are
// referentially stable, so a shallow compare skips re-rendering every row.
export const ConversationRow = memo(ConversationRowView);

function ConversationRowView({
  compact = false,
  conversation,
  active,
  cursor = false,
  spamView,
  listQuery = "",
}: {
  compact?: boolean;
  conversation: ConversationListItem;
  active: boolean;
  /** #694: the keyboard cursor (j/k) is on this row. */
  cursor?: boolean;
  spamView: boolean;
  listQuery?: string;
}) {
  const t = useT();
  const focus = useInboxFocus();
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!focus || !link.current || active || window.location.pathname !== "/inbox") return;
    if (link.current.closest('[aria-hidden="true"]')) return;
    const request = focus.current;
    if (request?.conversationId !== conversation.id || request.headingPending || request.searchResultId) return;
    focus.current = null;
    link.current.focus({ preventScroll: true });
  }, [active, conversation.id, focus]);
  const memberNames = useMemberNames();
  const snippet = useSnippet(conversation);
  const href = inboxHref({ conversationId: conversation.id, listQuery });
  // #712: the conversation's one action list, shared with the thread header's ⋯.
  const { actions, dialogs } = useConversationActions({
    conversation,
    openHref: href,
  });
  const {unread} = conversation;
  const pinned = conversation.pinned_at !== null;
  // #694: THIS member muted the thread. It still counts as unread; it only
  // stops making noise, so the mark sits beside the time rather than replacing
  // the unread dot.
  const muted = conversation.muted === true;
  // #414: flagged until the crew closes the thread. The rule and the reasoning
  // moved to packages/shared/src/emergency-flag.ts (#565) when the thread header
  // became the sixth place asking it.
  const emergency = isFlaggedUrgent(conversation);
  const assigneeName = conversation.assigned_user_id
    ? memberNames.get(conversation.assigned_user_id)
    : undefined;

  const name = contactDisplayName(conversation.contact);
  const tags = compact ? [] : conversation.tags.slice(0, 2);
  const visibleAssignee = compact ? undefined : assigneeName;
  // #293: only in the Snoozed view does this row exist at all — but it also
  // survives a mid-session return, and a row that came back with no explanation
  // is the thing that makes people stop trusting the list.
  const snoozedUntil = isSnoozed(conversation)
    ? (conversation.snoozed_until ?? null)
    : null;

  const previewText = snippet
    ? `${snippet.direction === "outbound" ? t("inbox.rowPreviewYou") : ""}${snippetText(snippet)}`
    : (conversation.contact.name
      ? formatPhone(conversation.contact.phone_e164)
      : "");
  // With a caption, the preview shows the text and the clip icon carries the
  // media — so the attachment has to be spelled out for screen readers, which
  // never see the icon.
  const attachmentNote =
    snippet?.hasAttachments && snippet.body.trim() !== ""
      ? t("inbox.rowAriaWithAttachment", {
          label: attachmentLabel(
            snippet.attachmentKind,
            snippet.attachmentCount,
          ).toLowerCase(),
        })
      : "";

  const tagNames = conversation.tags.map((tag) => tag.name).join(", ");
  const deliveryFailure = conversation.last_outbound_failed_at ? t("inbox.rowNotDelivered") : null;
  const rowLabel = `${t("inbox.rowAriaConversationWith", { name })}${
    emergency ? t("inbox.rowAriaUrgent") : ""
  }${
    unread ? t("inbox.rowAriaUnread") : ""
  }${pinned ? t("inbox.rowAriaPinned") : ""}${muted ? t("inbox.rowAriaMuted") : ""}${
    snippet?.direction === "note" ? t("inbox.rowAriaInternalNote") : ""
  }${
    assigneeName ? t("inbox.rowAriaAssignedTo", { name: assigneeName }) : ""
  }${spamView ? t("inbox.rowAriaSpam") : ""}${
    snoozedUntil
      ? `${t("inbox.rowAriaSnoozed", {
          until: deferralReturnLabel(snoozedUntil, "back", t),
        })}${conversation.snooze_note ? `, ${conversation.snooze_note}` : ""}`
      : ""
  }${tagNames ? t("inbox.rowAriaTags", { tags: tagNames }) : ""}${attachmentNote}${deliveryFailure ? `. ${deliveryFailure}` : ""}${previewText ? `. ${previewText}` : ""}`;

  return (
    // The link is the contact's name, stretched over the card by its ::after,
    // so the whole card still opens (and middle-clicks) the thread while the
    // link's own text is just the name its label starts with (WCAG 2.5.3).
    // Its focus ring is drawn on that ::after, around the whole card.
    // Everything else on the card is hidden from screen readers because the
    // label carries it: EVERY state a sighted user sees (unread, pinned,
    // internal note, assignee, spam, snooze) plus the latest message.
    <>
    <RecordContextMenu actions={actions}>
    <div
      className={cn(
        "relative flex min-h-11 items-start gap-3 rounded-app-card border px-3 transition-colors duration-150 ease-out",
        compact ? "py-2" : "py-3",
        active
          ? "border-app-tint-line bg-app-tint"
          : "border-transparent hover:border-app-line-soft hover:bg-app-hover",
        cursor && "ring-2 ring-ring",
      )}
    >
      {/* Colored-initial avatar (stable per contact). */}
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-xl text-[13px] font-semibold text-app-olive-deep",
          compact ? "size-8" : "size-10",
          avatarColorClass(conversation.contact_id || name),
        )}
      >
        {avatarInitials(name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="group/phone flex items-baseline justify-between gap-2">
          <Link
            href={href}
            ref={link}
            onClick={(event) => trackThreadLinkFocus(event, focus, conversation.id, active)}
            aria-current={active ? "page" : undefined}
            aria-label={rowLabel}
            // The time's own tooltip sits under the stretched link, so the
            // exact time of the last message is the link's tooltip instead.
            title={formatAbsoluteDateTime(conversation.last_message_at, undefined, t.locale)}
            className={cn(
              // §2.2 weight ceiling (#65): unread 600 vs read 500 — hierarchy
              // from one weight step, never 700.
              "truncate text-[14px] text-app-ink outline-none after:absolute after:inset-0 after:rounded-app-card focus-visible:after:ring-2 focus-visible:after:ring-ring",
              unread ? "font-semibold" : "font-medium",
            )}
          >
            {name}
          </Link>
          {(!conversation.contact.name || !snippet) && conversation.contact.phone_e164 && (
            <CopyablePhoneNumber
              number={conversation.contact.phone_e164}
              iconOnly
              className={cn("relative z-[1] mr-auto size-6 shrink-0 justify-center text-app-muted", phoneCopyOnHover)}
            />
          )}
          <span aria-hidden className="flex shrink-0 items-center gap-1.5">
            {unread && <span className="size-1.5 rounded-full bg-primary" />}
            {/* #414 ask 2 — "visibly flagged in the inbox". A fourth quiet
                icon beside the pin and the clip would blend into the row's
                own rhythm, which is the opposite of what this state needs.
                Breaking that rhythm on purpose is what makes the thread
                findable at 11pm, and this is the one row state worth it. */}
            {emergency && (
              <span className="flex items-center gap-1 rounded-full bg-app-clay/12 px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-app-clay uppercase">
                <TriangleAlert className="size-3" strokeWidth={2.25} />
                {URGENT_BADGE_LABEL}
              </span>
            )}
            {pinned && (
              <Pin
                className="size-3 text-app-muted-2"
                strokeWidth={2}
                aria-label={t("inbox.rowPinnedAria")}
              />
            )}
            {muted && (
              <BellOff
                className="size-3 text-app-muted-2"
                strokeWidth={2}
                aria-label={t("inbox.rowMutedAria")}
              />
            )}
            <Timestamp
              at={conversation.last_message_at}
              style="short"
              className={cn("text-[11.5px]", active ? "text-app-muted" : "text-app-muted-2")}
            />
            {compact && assigneeName && (
              <span className="relative z-[1]" title={t("inbox.rowAssignedToTitle", { name: assigneeName })}>
                <MemberAvatar name={assigneeName} memberId={conversation.assigned_user_id} />
              </span>
            )}
          </span>
        </span>

        {(previewText || deliveryFailure || snippet?.hasAttachments || snippet?.direction === "note") && <span
          aria-hidden
          className="mt-0.5 flex items-start gap-1 text-[13px] leading-snug text-app-muted"
        >
          {deliveryFailure && (
            <span className="flex shrink-0 items-center gap-1 font-medium text-destructive">
              <TriangleAlert className="size-3" aria-hidden />
              {deliveryFailure}
            </span>
          )}
          {snippet?.direction === "note" && (
            <Lock
              className="mt-0.5 size-3 shrink-0 text-app-amber"
              strokeWidth={1.75}
              aria-label={t("inbox.rowNoteAria")}
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
          <span className={cn("min-w-0 break-words", compact ? "line-clamp-1" : "line-clamp-2")}>
            {previewText}
          </span>
        </span>}

        {(spamView || snoozedUntil || tags.length > 0 || visibleAssignee) && (
          <span aria-hidden className="mt-1.5 flex flex-wrap items-center gap-1">
            {/* The return time IS the row's reason for being in this view, so
                it leads — "Snoozed" without a when is the vanishing act #293
                calls worse than the problem. */}
            {snoozedUntil && (
              <span className="inline-flex items-center gap-1 rounded-full border border-app-line bg-app-ground px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-muted">
                <AlarmClock className="size-3" strokeWidth={1.75} aria-hidden />
                {deferralReturnLabel(snoozedUntil, "back", t)}
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
                {t("inbox.spamLabel")}
              </span>
            )}
            {tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
            {visibleAssignee && (
              // The chip shows only initials, so pointer users read the name
              // from its tooltip; it sits above the stretched link so the
              // tooltip can open. Screen readers hear it in the row's label.
              <span
                title={t("inbox.rowAssignedToTitle", { name: visibleAssignee })}
                className="relative z-[1]"
              >
                <MemberAvatar name={visibleAssignee} memberId={conversation.assigned_user_id} />
              </span>
            )}
          </span>
        )}
      </span>

    </div>
    </RecordContextMenu>
    {dialogs}
    </>
  );
}
