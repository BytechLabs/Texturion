"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import Link from "next/link";

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

import { avatarColorClass, avatarInitials } from "../shell/avatar-color";
import { useMemberNames } from "./member-avatar";

/** The fixed row height the virtualizer estimates (avatar + name + 2-line
 * preview + a tag row). Keep in sync with the row's box in ConversationRow. */
export const ROW_HEIGHT = 96;

interface Snippet {
  direction: MessageDirection;
  body: string;
  hasAttachments: boolean;
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
    return {
      direction: cached.direction,
      body: cached.body,
      hasAttachments: (cached.attachments?.length ?? 0) > 0,
    };
  }
  if (row) {
    return {
      direction: row.direction,
      body: row.body,
      hasAttachments: row.has_attachments,
    };
  }
  return null;
}

function snippetText(snippet: Snippet): string {
  const body = snippet.body.trim();
  if (body === "") {
    return snippet.hasAttachments ? "Photo" : "";
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
          ? "border-app-tint-line bg-app-tint text-app-petrol-deep"
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
 * to two tag chips. Hover lifts the row (fill + soft shadow); the SELECTED row is
 * a lifted white card with a petrol-tint ring + shadow (NOT a left accent bar).
 * All behavior (the /inbox/:id link, active state, spam view) is preserved.
 */
export function ConversationRow({
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
  const assigneeName = conversation.assigned_user_id
    ? memberNames.get(conversation.assigned_user_id)
    : undefined;

  const name = contactDisplayName(conversation.contact);
  const tags = conversation.tags.slice(0, 2);

  const previewText = snippet
    ? `${snippet.direction === "outbound" ? "You: " : ""}${snippetText(snippet)}`
    : conversation.contact.name
      ? formatPhone(conversation.contact.phone_e164)
      : "";

  return (
    <Link
      href={`/inbox/${conversation.id}`}
      aria-current={active ? "page" : undefined}
      aria-label={`Conversation with ${name}${unread ? ", unread" : ""}`}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "relative flex items-start gap-[11px] rounded-app-card border p-[11px] transition-[background,box-shadow,border-color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-app-line bg-app-white"
          : "border-transparent hover:border-app-line-soft hover:bg-app-stone-1",
      )}
    >
      {/* Colored-initial avatar (stable per contact). */}
      <span
        aria-hidden
        className={cn(
          "grid size-[38px] shrink-0 place-items-center rounded-xl text-[13px] font-bold text-app-petrol-deep",
          avatarColorClass(conversation.contact_id || name),
        )}
      >
        {avatarInitials(name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-[14px] text-app-ink",
              unread ? "font-bold" : "font-semibold",
            )}
          >
            {name}
          </span>
          <span
            className="shrink-0 text-[11.5px] tabular-nums text-app-muted-2"
            title={formatAbsoluteDateTime(conversation.last_message_at)}
          >
            {formatRelativeTime(conversation.last_message_at)}
          </span>
        </span>

        <span
          className={cn(
            "mt-[3px] flex items-start gap-1 text-[12.5px] leading-[1.45]",
            active ? "text-[#4A544F] dark:text-app-muted" : "text-app-muted",
          )}
        >
          {snippet?.direction === "note" && (
            <Lock
              className="mt-0.5 size-3 shrink-0 text-app-amber"
              strokeWidth={1.75}
              aria-label="Note"
            />
          )}
          <span className="line-clamp-2 min-w-0 break-words">
            {previewText}
          </span>
        </span>

        {(tags.length > 0 || spamView || assigneeName) && (
          <span className="mt-[7px] flex flex-wrap items-center gap-[5px]">
            {spamView && (
              <span className="inline-flex items-center rounded-full border border-app-line px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-clay">
                Spam
              </span>
            )}
            {tags.map((tag, i) => (
              <TagChip key={tag.id} tag={tag} emphasis={i === 0 && !spamView} />
            ))}
            {assigneeName && (
              <span className="inline-flex items-center gap-1 rounded-full border border-app-line bg-app-stone-0 px-2 py-[2.5px] text-[11px] font-semibold leading-none text-app-muted dark:text-app-muted">
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
}
