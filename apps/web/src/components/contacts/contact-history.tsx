"use client";

import {
  Download,
  FileText,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  Phone,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { CallRow } from "@/components/calls/call-row";
import { ConversationRow } from "@/components/inbox/conversation-row";
import { fileLabel, formatBytes } from "@/components/thread/gallery-grouping";
import { LinkedTasks } from "@/components/tasks/linked-tasks";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/list-skeleton";
import { LoadError } from "@/components/ui/load-error";
import { Timestamp } from "@/components/ui/timestamp";
import { useT } from "@/i18n/provider";
import { useCalls } from "@/lib/api/calls";
import { useConversations } from "@/lib/api/conversations";
import { useAttachmentGallery } from "@/lib/api/gallery";
import { flattenPages } from "@/lib/api/pagination";
import type { ContactDetail } from "@/lib/api/types";

import type { ContactPane } from "./contact-tabs";

/** Rows a list shows before "Show all". */
export const CONTACT_LIST_CAP = 5;

/**
 * #740: one list of what happened with this customer, picked by the segmented
 * control above it so a long history is one list at a time rather than five
 * stacked. Every list is capped, with "Show all" for the rest.
 */
export function ContactHistory({
  contact,
  pane,
  conversationId,
}: {
  contact: ContactDetail;
  pane: ContactPane;
  /** The contact's existing thread, when there is one; the Files list reads it. */
  conversationId: string | null;
}) {
  switch (pane) {
    case "activity":
      return (
        <ActivityTimeline
          recordType="contact"
          recordId={contact.id}
          hideHeading
        />
      );
    case "conversations":
      return <ConversationsList contact={contact} />;
    case "calls":
      return <CallsList contact={contact} />;
    case "tasks":
      return (
        <LinkedTasks
          kind="contact"
          id={contact.id}
          limit={CONTACT_LIST_CAP}
          empty={<ListEmpty kind="tasks" icon={<ListChecks />} />}
        />
      );
    case "files":
      return <FilesList conversationId={conversationId} />;
  }
}

function ListEmpty({
  kind,
  icon,
}: {
  kind: "conversations" | "calls" | "tasks" | "files";
  icon: React.ReactNode;
}) {
  const t = useT();
  const text = {
    conversations: [
      t("appShell.contactNoConversations"),
      t("appShell.contactNoConversationsDetail"),
    ],
    calls: [t("appShell.contactNoCalls"), t("appShell.contactNoCallsDetail")],
    tasks: [t("appShell.contactNoTasks"), t("appShell.contactNoTasksDetail")],
    files: [t("appShell.contactNoFiles"), t("appShell.contactNoFilesDetail")],
  }[kind];
  return (
    <EmptyState
      size="panel"
      icon={icon}
      title={text[0]}
      description={text[1]}
    />
  );
}

function ListLoading() {
  const t = useT();
  return (
    <ListSkeleton
      rows={3}
      avatar
      lines={2}
      label={t("activity.loading")}
      className="p-3"
    />
  );
}

/** The first rows of a list and a "Show all" for the rest. */
function Capped<T>({
  rows,
  render,
  hasMore,
  fetchMore,
  fetching,
}: {
  rows: T[];
  render: (row: T) => React.ReactNode;
  hasMore: boolean;
  fetchMore: () => void;
  fetching: boolean;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, CONTACT_LIST_CAP);
  const capped = !all && rows.length > CONTACT_LIST_CAP;
  return (
    <div className="overflow-hidden rounded-app-card border border-app-line bg-app-paper">
      <ul className="divide-y divide-app-line-soft">{shown.map(render)}</ul>
      {capped || (all && hasMore) ? (
        <div className="border-t border-app-line-soft p-2 text-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={fetching}
            onClick={() => {
              if (capped) setAll(true);
              else fetchMore();
            }}
          >
            {capped
              ? t("appShell.contactShowAll", { count: rows.length })
              : t("activity.showEarlier")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ConversationsList({ contact }: { contact: ContactDetail }) {
  const conversations = useConversations({ q: contact.phone_e164 });
  const rows = useMemo(
    () => flattenPages(conversations.data),
    [conversations.data],
  );
  if (conversations.isPending) return <ListLoading />;
  if (conversations.isError) {
    return <LoadError onRetry={() => void conversations.refetch()} />;
  }
  if (rows.length === 0) {
    return <ListEmpty kind="conversations" icon={<MessageSquare />} />;
  }
  return (
    <Capped
      rows={rows}
      hasMore={conversations.hasNextPage ?? false}
      fetching={conversations.isFetchingNextPage}
      fetchMore={() => void conversations.fetchNextPage()}
      render={(conversation) => (
        <li key={conversation.id}>
          <ConversationRow
            conversation={conversation}
            active={false}
            spamView={false}
          />
        </li>
      )}
    />
  );
}

function CallsList({ contact }: { contact: ContactDetail }) {
  const calls = useCalls(undefined, undefined, contact.id);
  const rows = useMemo(() => flattenPages(calls.data), [calls.data]);
  if (calls.isPending) return <ListLoading />;
  if (calls.isError) return <LoadError onRetry={() => void calls.refetch()} />;
  if (rows.length === 0) return <ListEmpty kind="calls" icon={<Phone />} />;
  return (
    <Capped
      rows={rows}
      hasMore={calls.hasNextPage ?? false}
      fetching={calls.isFetchingNextPage}
      fetchMore={() => void calls.fetchNextPage()}
      render={(call) => (
        <li key={call.id}>
          <CallRow call={call} />
        </li>
      )}
    />
  );
}

function FilesList({ conversationId }: { conversationId: string | null }) {
  const gallery = useAttachmentGallery(
    conversationId ?? "",
    conversationId !== null,
  );
  const rows = useMemo(() => flattenPages(gallery.data), [gallery.data]);
  if (conversationId === null) {
    return <ListEmpty kind="files" icon={<ImageIcon />} />;
  }
  if (gallery.isPending) return <ListLoading />;
  if (gallery.isError) {
    return <LoadError onRetry={() => void gallery.refetch()} />;
  }
  if (rows.length === 0) return <ListEmpty kind="files" icon={<ImageIcon />} />;
  return (
    <Capped
      rows={rows}
      hasMore={gallery.hasNextPage ?? false}
      fetching={gallery.isFetchingNextPage}
      fetchMore={() => void gallery.fetchNextPage()}
      render={(item) => {
        const size = formatBytes(item.size_bytes);
        return (
          <li key={item.id}>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 p-3 hover:bg-app-tint/60"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-app-tint text-app-muted-2">
                {item.kind === "image" ? (
                  <ImageIcon
                    className="size-4"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                ) : (
                  <FileText className="size-4" strokeWidth={1.75} aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-app-ink">
                  {fileLabel(item)}
                </span>
                <span className="block text-xs text-app-muted-2">
                  {size ? `${size} · ` : ""}
                  <Timestamp at={item.created_at} style="long" />
                </span>
              </span>
              <Download
                className="size-4 shrink-0 text-app-muted-2"
                strokeWidth={1.75}
                aria-hidden
              />
            </a>
          </li>
        );
      }}
    />
  );
}
