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
} from "@/lib/api/types";
import { useCompanyId } from "@/lib/company/provider";
import { contactDisplayName, formatPhone } from "@/lib/format/phone";
import { formatAbsoluteDateTime, formatRelativeTime } from "@/lib/format/time";
import { cn } from "@/lib/utils";

import { MemberAvatar, useMemberNames } from "./member-avatar";
import { SpamPill, StatusPill } from "./status-pill";

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

/** G4 row anatomy, 68px: dot → name + snippet → time / avatar / pill. */
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

  return (
    <Link
      href={`/inbox/${conversation.id}`}
      aria-current={active ? "page" : undefined}
      aria-label={`Conversation with ${name}${unread ? ", unread" : ""}`}
      className={cn(
        // §3.1: 12px vertical rhythm, subtle stone-100 interior hairline so
        // the list reads as one calm column, not a stack of boxes. Hover is a
        // fill change only (stone-50→stone-100), no border/shadow shift.
        "flex h-[68px] items-center gap-3 border-b border-border-subtle px-4 py-3 transition-colors duration-150 ease-out",
        active ? "bg-secondary" : "hover:bg-secondary/60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm text-foreground",
            unread ? "font-semibold" : "font-medium",
          )}
        >
          {name}
        </span>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          {snippet?.direction === "note" && (
            <Lock
              className="size-3 shrink-0 text-amber-700 dark:text-warning"
              strokeWidth={1.75}
              aria-label="Note"
            />
          )}
          <span className="truncate">
            {snippet
              ? `${snippet.direction === "outbound" ? "You: " : ""}${snippetText(snippet)}`
              : conversation.contact.name
                ? formatPhone(conversation.contact.phone_e164)
                : " "}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {/* §3.1: time drops to tertiary stone-400 (dark stone-500) — chrome,
            not content. The unread petrol dot is the row's only accent. */}
        <span
          className="text-xs tabular-nums text-foreground-tertiary"
          title={formatAbsoluteDateTime(conversation.last_message_at)}
        >
          {formatRelativeTime(conversation.last_message_at)}
        </span>
        <span className="flex items-center gap-1.5">
          {assigneeName && <MemberAvatar name={assigneeName} />}
          {spamView ? (
            <SpamPill />
          ) : (
            <StatusPill status={conversation.status} />
          )}
        </span>
      </span>
    </Link>
  );
}
