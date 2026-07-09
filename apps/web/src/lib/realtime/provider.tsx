"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  listApplyConversation,
  snippetFromMessage,
  threadPatchMessage,
  threadUpsertMessages,
  type ThreadData,
} from "@/lib/api/cache";
import {
  fetchConversationDetail,
  patchConversationLists,
  seedThreadFromDetail,
} from "@/lib/api/conversations";
import { keys } from "@/lib/api/keys";
import { fetchMessagesPage } from "@/lib/api/messages";
import { trimToFirstPage } from "@/lib/api/pagination";
import type {
  ConversationDetail,
  ConversationListItem,
  Message,
  Page,
} from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { contactDisplayName } from "@/lib/format/phone";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

import {
  messageStatusPatch,
  type ConversationUpdatedEvent,
  type MessageCreatedEvent,
  type MessageStatusEvent,
  type TaskChangedEvent,
} from "./events";
import { activeConversationFromPath } from "./path";

function findListRow(
  queryClient: QueryClient,
  companyId: string,
  conversationId: string,
): ConversationListItem | undefined {
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: keys.conversations.lists(companyId) })) {
    const data = query.state.data as
      | { pages: Page<ConversationListItem>[] }
      | undefined;
    const row = data?.pages
      .flatMap((page) => page.data)
      .find((r) => r.id === conversationId);
    if (row) return row;
  }
  return undefined;
}

/** Build a list row from a detail response, preserving per-user unread. */
function listItemFromDetail(
  detail: ConversationDetail,
  unread: boolean,
): ConversationListItem {
  const { contact, tags, messages, ...conversation } = detail;
  const newest = messages.data[0]; // page is newest-first (SPEC §7)
  return {
    ...conversation,
    contact: {
      id: contact.id,
      name: contact.name,
      phone_e164: contact.phone_e164,
    },
    tags,
    unread,
    last_message: newest ? snippetFromMessage(newest) : null,
  };
}

const TOAST_SNIPPET_LENGTH = 80;

function toastSnippet(message: Message | undefined): string {
  if (!message) return "New message";
  const body = message.body.trim();
  if (body.length === 0) return "Photo";
  if (body.length <= TOAST_SNIPPET_LENGTH) return body;
  return `${body.slice(0, TOAST_SNIPPET_LENGTH - 1)}…`;
}

/**
 * One Supabase Realtime private Broadcast channel per company (SPEC §8,
 * G12): `company:{id}`, authorized by RLS on realtime.messages via
 * `realtime.setAuth(session token)`. The §8 events patch/invalidate the Query
 * cache by ID (including `task.changed`, TASKS.md T1.3 — the cross-client task
 * signal that refetches the affected conversation's checklist + the /tasks
 * lists); reconnect refetches page 1 of active queries; inbound messages in
 * conversations you are NOT viewing raise a quiet toast (G9).
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { companyId } = useActiveCompany();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  const activeConversationRef = useRef<string | null>(null);
  activeConversationRef.current = activeConversationFromPath(pathname);

  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let disposed = false;
    // Trailing per-conversation coalescing for conversation.updated bursts.
    const pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

    const isViewing = (conversationId: string) =>
      activeConversationRef.current === conversationId;

    async function handleMessageCreated(event: MessageCreatedEvent) {
      const { conversation_id, message_id, direction } = event;

      const cachedRow = findListRow(queryClient, companyId, conversation_id);
      // Spam-thread appends stay silent outside the spam view (SPEC §6.3).
      if (cachedRow?.is_spam) return;

      // Fetch the message via the API (ID-only payload, §8) — the newest
      // thread page carries it plus anything else we missed.
      let page: Page<Message> | null = null;
      try {
        page = await fetchMessagesPage(companyId, conversation_id, undefined, 25);
      } catch {
        // Unreachable API right now: staleness is handled on reconnect.
        return;
      }
      if (disposed) return;
      const message = page.data.find((m) => m.id === message_id);

      // Patch the thread cache when this thread has ever been opened.
      const threadKey = keys.thread(companyId, conversation_id);
      if (queryClient.getQueryData<ThreadData>(threadKey)) {
        queryClient.setQueryData<ThreadData>(threadKey, (thread) =>
          threadUpsertMessages(thread, page.data),
        );
      }

      const unreadBump = direction === "inbound" && !isViewing(conversation_id);
      let contactName: string;

      if (cachedRow) {
        const next: ConversationListItem = {
          ...cachedRow,
          last_message_at: message?.created_at ?? new Date().toISOString(),
          last_message: message
            ? snippetFromMessage(message)
            : cachedRow.last_message,
          unread: unreadBump ? true : cachedRow.unread,
        };
        patchConversationLists(queryClient, companyId, (list, filters) =>
          listApplyConversation(list, next, filters),
        );
        contactName = contactDisplayName(cachedRow.contact);
      } else {
        // Brand-new conversation (INSERTs don't broadcast conversation.updated):
        // one detail fetch builds the list row and seeds the caches.
        let detail: ConversationDetail;
        try {
          detail = await fetchConversationDetail(companyId, conversation_id);
        } catch {
          return;
        }
        if (disposed || detail.is_spam) return;
        queryClient.setQueryData(
          keys.conversations.detail(companyId, conversation_id),
          detail,
        );
        seedThreadFromDetail(queryClient, companyId, detail);
        patchConversationLists(queryClient, companyId, (list, filters) =>
          listApplyConversation(
            list,
            listItemFromDetail(detail, unreadBump),
            filters,
          ),
        );
        contactName = contactDisplayName(detail.contact);
      }

      // Quiet in-page toast for messages you are NOT viewing (G9); the
      // message just appears when you are.
      if (direction === "inbound" && !isViewing(conversation_id)) {
        toast(contactName, {
          description: toastSnippet(message),
          action: {
            label: "View",
            onClick: () => routerRef.current.push(`/inbox/${conversation_id}`),
          },
        });
      }
    }

    async function applyConversationUpdate(conversationId: string) {
      let detail: ConversationDetail;
      try {
        detail = await fetchConversationDetail(companyId, conversationId);
      } catch {
        return;
      }
      if (disposed) return;

      // Targeted patches: detail cache (when opened), thread page merge,
      // list rows re-evaluated against each list's own filters.
      if (
        queryClient.getQueryData(
          keys.conversations.detail(companyId, conversationId),
        )
      ) {
        queryClient.setQueryData(
          keys.conversations.detail(companyId, conversationId),
          detail,
        );
      }
      seedThreadFromDetail(queryClient, companyId, detail);
      const cachedRow = findListRow(queryClient, companyId, conversationId);
      patchConversationLists(queryClient, companyId, (list, filters) =>
        listApplyConversation(
          list,
          listItemFromDetail(detail, cachedRow?.unread ?? false),
          filters,
        ),
      );
      // #13: a pin/unpin from another client moves the thread in/out of the
      // pinned-first supplement (usePinnedConversations) — refresh it when the
      // pin state actually changed, so a teammate's pin floats live.
      if ((cachedRow?.pinned_at ?? null) !== (detail.pinned_at ?? null)) {
        void queryClient.invalidateQueries({
          queryKey: keys.conversations.pinnedRoot(companyId),
          refetchType: "active",
        });
      }
      // Status/assign/tag changes also append timeline events (G5).
      queryClient.invalidateQueries({
        queryKey: keys.conversations.events(companyId, conversationId),
        refetchType: "active",
      });
    }

    function handleConversationUpdated(event: ConversationUpdatedEvent) {
      const id = event.conversation_id;
      const existing = pendingUpdates.get(id);
      if (existing) clearTimeout(existing);
      pendingUpdates.set(
        id,
        setTimeout(() => {
          pendingUpdates.delete(id);
          void applyConversationUpdate(id);
        }, 250),
      );
    }

    function handleMessageStatus(event: MessageStatusEvent) {
      // Payload carries the status AND the D14 done fields — pure cache
      // patch, no fetch (§8; done toggles broadcast this same event).
      const patch = messageStatusPatch(event);
      queryClient.setQueriesData<ThreadData>(
        { queryKey: keys.threads(companyId) },
        (thread) =>
          thread
            ? threadPatchMessage(thread, event.message_id, patch)
            : thread,
      );
      // Detail responses embed a message page too — keep badges in sync.
      queryClient.setQueriesData<ConversationDetail>(
        { queryKey: [companyId, "conversations", "detail"] },
        (detail) => {
          if (!detail) return detail;
          let changed = false;
          const data = detail.messages.data.map((message) => {
            if (message.id !== event.message_id) return message;
            changed = true;
            return { ...message, ...patch };
          });
          if (!changed) return detail;
          return { ...detail, messages: { ...detail.messages, data } };
        },
      );
      // AUDITABLE (§4.2/§4.3): a done toggle writes a message_done /
      // message_undone row into conversation_events and broadcasts THIS same
      // event (the payload carries done fields; a plain delivery-status tick
      // does not). The payload is ID-only — no conversation_id — so locate the
      // owning conversation from the thread cache that holds this message and
      // invalidate its events query so the timeline line lands live for other
      // viewers, mirroring the conversation.updated status/assign/tag path.
      if ("done_at" in event || "done_by_user_id" in event) {
        for (const query of queryClient
          .getQueryCache()
          .findAll({ queryKey: keys.threads(companyId) })) {
          const data = query.state.data as ThreadData | undefined;
          const hasMessage = data?.pages.some((page) =>
            page.data.some((m) => m.id === event.message_id),
          );
          if (!hasMessage) continue;
          // keys.thread(companyId, id) === [companyId, "messages", id]
          const conversationId = query.queryKey[2] as string;
          queryClient.invalidateQueries({
            queryKey: keys.conversations.events(companyId, conversationId),
            refetchType: "active",
          });
        }
      }
    }

    function handleTaskChanged(event: TaskChangedEvent) {
      // TASKS.md T1.3: a task metadata change (create / assign / due / delete)
      // by ANY crew member — the ID-only payload carries just the source
      // conversation_id (D9). Refetch the two derived task reads through the
      // API so authorization stays server-side: the affected conversation's
      // checklist (the context-panel Tasks list) and the /tasks page lists root
      // (every filter combination — List/Board/Calendar/Map). This is the exact
      // invalidation the acting client's own mutation hooks run (lib/api/tasks.ts
      // invalidateTasks), now driven cross-client off the broadcast. The
      // for-you queue + notifications bell ride the resulting tasks-cache change
      // via useForYouNotificationsRealtime, so they refresh too — no extra work
      // here. Done toggles are NOT this event (they ride message.status), so the
      // derived done-state on the checklist already updates via that path.
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.checklist(companyId, event.conversation_id),
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.lists(companyId),
        refetchType: "active",
      });
      // #81: the source message's Task chip (has_task / promoted_task) rides the
      // thread read, so a task created/removed by another crew member updates the
      // message live too — not just the checklist and the /tasks page.
      void queryClient.invalidateQueries({
        queryKey: keys.thread(companyId, event.conversation_id),
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.detail(companyId, event.conversation_id),
        refetchType: "active",
      });
    }

    function handleProvisioningUpdate() {
      // number.updated / registration.updated (§8): onboarding + settings
      // states re-read their sources of truth.
      queryClient.invalidateQueries({ queryKey: keys.me });
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.numbers(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.registration(companyId),
        refetchType: "active",
      });
    }

    function refetchFirstPages() {
      // Reconnect (G12): drop pages >1 of company-scoped infinite queries,
      // then refetch whatever is actively rendered.
      for (const query of queryClient
        .getQueryCache()
        .findAll({ queryKey: [companyId] })) {
        const data = query.state.data as
          | { pages?: unknown[]; pageParams?: unknown[] }
          | undefined;
        if (Array.isArray(data?.pages) && Array.isArray(data?.pageParams)) {
          queryClient.setQueryData(
            query.queryKey,
            trimToFirstPage(
              data as Parameters<typeof trimToFirstPage>[0],
            ),
          );
        }
      }
      queryClient.invalidateQueries({
        queryKey: [companyId],
        refetchType: "active",
      });
    }

    let hadDrop = false;
    let everSubscribed = false;

    // Private-topic authorization uses the Supabase session token; keep the
    // realtime connection's token fresh across refreshes (SPEC §8).
    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    const channel = supabase.channel(`company:${companyId}`, {
      config: { private: true },
    });
    channel
      .on("broadcast", { event: "message.created" }, ({ payload }) =>
        void handleMessageCreated(payload as MessageCreatedEvent),
      )
      .on("broadcast", { event: "conversation.updated" }, ({ payload }) =>
        handleConversationUpdated(payload as ConversationUpdatedEvent),
      )
      .on("broadcast", { event: "message.status" }, ({ payload }) =>
        handleMessageStatus(payload as MessageStatusEvent),
      )
      .on("broadcast", { event: "task.changed" }, ({ payload }) =>
        handleTaskChanged(payload as TaskChangedEvent),
      )
      .on("broadcast", { event: "number.updated" }, handleProvisioningUpdate)
      .on(
        "broadcast",
        { event: "registration.updated" },
        handleProvisioningUpdate,
      );

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (everSubscribed && hadDrop) refetchFirstPages();
          everSubscribed = true;
          hadDrop = false;
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          hadDrop = true;
        }
      });
    })();

    return () => {
      disposed = true;
      for (const timer of pendingUpdates.values()) clearTimeout(timer);
      pendingUpdates.clear();
      authSubscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  return <>{children}</>;
}
