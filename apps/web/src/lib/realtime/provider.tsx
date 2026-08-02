"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  listApplyConversation,
  snippetFromMessage,
  threadPatchMessage,
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
import type { ReadStateEvent } from "./events";
import type {
  ConversationDetail,
  ConversationListItem,
  Message,
  Page,
} from "@/lib/api/types";
import { useActiveCompany } from "@/lib/company/provider";
import { contactDisplayName } from "@/lib/format/phone";
import { useMeCompany } from "@/lib/api/me-company";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

import { applyLiveThreadAppend } from "./apply";
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
  if (body.length === 0) return "Attachment"; // #189: not photos-only anymore
  if (body.length <= TOAST_SNIPPET_LENGTH) return body;
  return `${body.slice(0, TOAST_SNIPPET_LENGTH - 1)}…`;
}

/**
 * #480: the numbers this client subscribes to, as ONE by-value comparable
 * string. Sorted, so the same set in a different order is the same key.
 *
 * The socket effect depends on this, and every /v1/me refetch hands back a
 * fresh array — depending on the array would rebuild the socket on each
 * refetch, while this rebuilds it only when the set actually changed. Ids only,
 * for the same reason: `number.updated` invalidates /v1/me on every provisioning
 * tick, and a number going pending → active is not a reason to re-open a socket.
 *
 * Takes the rows VERBATIM. The company view is already access-filtered
 * server-side (routes/core/company-view.ts drops `access.hiddenNumberIds`), and
 * deciding again here would be a second implementation of the rule D88 put in
 * exactly one place.
 */
export function numberTopicKey(numbers: readonly { id: string }[]): string {
  return numbers
    .map((n) => n.id)
    .sort()
    .join(",");
}

/**
 * #480: every topic one client joins — `company:{id}` plus
 * `company:{id}:number:{n}` for each number it may see.
 *
 * The per-number shape must match `broadcast_number_scoped` character for
 * character; `is_company_topic_member` admits it only when
 * `member_number_level` is not 'none' (D88).
 *
 * The company topic is always present, and not only for the three events that
 * stay company-wide (`registration.updated`, `read.notifications`,
 * `access.changed`): `call.updated` for a call whose number was DELETED has no
 * per-number topic at all — `calls.phone_number_id` is `on delete set null`, so
 * the company topic is that event's only route (D88 addendum). A member with no
 * visible numbers therefore joins this one topic and works normally.
 */
export function realtimeTopics(companyId: string, key: string): string[] {
  const company = `company:${companyId}`;
  if (key === "") return [company];
  return [company, ...key.split(",").map((id) => `${company}:number:${id}`)];
}

/**
 * #483: the waits before each retry of a bootstrap number list that FAILED to
 * read, longest last.
 *
 * The hydrated `/v1/me` is the ONLY source of the access-filtered number list,
 * and when it fails `topicKey` below is "" — this client holds the company topic
 * and not one per-number topic. Nothing re-derived it. React Query gives up after
 * its own two retries and then sits on the error: `useMeCompany` has a 60s
 * staleTime, `refetchOnWindowFocus` is off globally, the focus resync invalidates
 * only the `[companyId]` prefix while the list lives at `["me", ...]`, and the one
 * path that does invalidate `keys.me` (`refetchFirstPages`) runs only after a
 * connectivity gap — which on a healthy socket may never come.
 *
 * So one transient 5xx or cold isolate on /v1/me at page load cost that tab its
 * whole session of per-number realtime — and since #484's contract step that is
 * no messages, conversations, calls, tasks or read state at all, with a green
 * socket, no error anywhere, and a reload as the only recovery.
 *
 * Three tries across ~17s, the same ladder Android uses for the same read
 * (`NUMBER_LIST_RETRY_DELAYS_MS` in RootViewModel.kt). Waits FIRST: the read that
 * just failed fails the same way if it is repeated in the same millisecond.
 * Bounded, because a /v1/me still down after seventeen seconds is an outage the
 * reconnect path already heals, not a blip worth polling through.
 */
const NUMBER_LIST_RETRY_DELAYS_MS = [1_000, 4_000, 12_000];

/**
 * One Supabase Realtime private Broadcast channel for the company (SPEC §8,
 * G12) — `company:{id}` — plus one per number this member may see (#480),
 * authorized by RLS on realtime.messages via
 * `realtime.setAuth(session token)`. The §8 events patch/invalidate the Query
 * cache by ID (including `task.changed`, TASKS.md T1.3 — the cross-client task
 * signal that refetches the affected conversation's checklist + the /tasks
 * lists, and `call.updated`, #133 — the calls read model changed, so the
 * /calls log and the for-you Recent calls section refetch); reconnect
 * refetches page 1 of active queries; inbound messages in conversations you
 * are NOT viewing raise a quiet toast (G9).
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { companyId } = useActiveCompany();
  // undefined while /me is in flight or on a server that predates the field —
  // both mean "no statement", and the socket opens as it always did.
  const meCompany = useMeCompany();
  const realtimeEnabled = meCompany.data?.flags?.["kill:realtime"];
  /**
   * #480: which per-number topics this client joins, as a stable key.
   *
   * A real DEPENDENCY of the socket effect, and the exact mirror of
   * `meUserIdRef` below: that one is a ref precisely so the socket does NOT
   * rebuild when /v1/me resolves, and this one cannot be, because the ids decide
   * which channels EXIST rather than what a handler does with an event. So it
   * costs one teardown+rebuild when /v1/me resolves after mount, and one more
   * whenever the list actually moves — `access.changed` and `number.updated`
   * both invalidate `keys.me`, so a revoked or added number re-derives here and
   * the subscription set follows.
   *
   * The `?? []` is a REAL state and not only a loading one: a member restricted
   * out of every number derives "" and joins the company topic alone, which is
   * correct and must keep working. It is a BUG when it comes from a failed read —
   * see `numberListFailed` below, which is why that is read separately rather
   * than inferred from an empty key.
   */
  const topicKey = numberTopicKey(meCompany.data?.company?.numbers ?? []);
  /**
   * #483: the number list could not be READ. Not the same thing as an empty one,
   * and the two must never be conflated — they produce an identical `topicKey`
   * and want opposite treatment. "Restricted out of everything" is settled and
   * must be left alone; "we do not know yet" needs asking again, because nothing
   * else will (see `NUMBER_LIST_RETRY_DELAYS_MS`).
   *
   * `isError` and not `!data`: React Query reports error status only when there
   * is no successful data to fall back on, so a background refetch failing while
   * a good list is cached does not arm the ladder — that list is still the right
   * one to be subscribed to.
   */
  const numberListFailed = meCompany.isError;
  /**
   * #358: whose read state this client cares about. The events ride the
   * company topic, so a colleague's reading must be ignored.
   *
   * A REF, not a dependency. /v1/me resolves after this effect first runs, so
   * a handler closing over the value would capture null and ignore its own
   * events for the life of the subscription — while adding it to the deps
   * would tear down and rebuild the socket the moment the profile arrived.
   * The ref gives the handler today's value without either.
   */
  /**
   * #483: bumped when a per-number channel is given up on, purely to make the
   * socket effect rebuild.
   *
   * Giving up used to be PERMANENT, and the comment justifying it was wrong: it
   * claimed `access.changed` would bring the number back by rebuilding the set,
   * but the effect's dependency is `topicKey` — a sorted-id string. When the
   * refetched list is unchanged the string is identical, the effect never re-runs,
   * and `removeChannel` has already dropped the channel from realtime-js, so a
   * socket reconnect does not rejoin it either.
   *
   * That mattered because refusal and a transient error are indistinguishable at
   * this seam. A laptop waking with an expired JWT can push two joins with the
   * stale token before the refresh lands — two CHANNEL_ERRORs on a connected
   * socket, which the refusal branch reads as "access was taken away". The tab
   * then received nothing for that number for the rest of its life, with a green
   * socket and no error anywhere.
   *
   * So the ambiguous case is treated as slow rather than final: one rebuild a
   * minute instead of a join every ten seconds, and a real revocation settles into
   * that cadence rather than a hot loop.
   */
  const [retryGeneration, setRetryGeneration] = useState(0);
  const meUserIdRef = useRef<string | null>(null);
  meUserIdRef.current = meCompany.data?.user_id ?? null;
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  const activeConversationRef = useRef<string | null>(null);
  activeConversationRef.current = activeConversationFromPath(pathname);

  const routerRef = useRef(router);
  routerRef.current = router;

  /**
   * #483: ask /v1/me again, on a bounded ladder, when the read that decides the
   * subscription set failed.
   *
   * Its own effect rather than a branch inside the socket effect below, because
   * the two want opposite lifecycles: the socket must open on the company topic
   * immediately — `access.changed` and `number_set.changed` arrive there, and
   * they are how this client learns its number list is wrong — while this keeps
   * working behind it until the list arrives. Folding it in would tie the retry
   * clock to a teardown-and-rebuild.
   *
   * `invalidateQueries` rather than `meCompany.refetch`: it is the same primitive
   * `access.changed` and `refetchFirstPages` already use for exactly this
   * re-derivation, and it needs no assumption about the identity stability of a
   * function handed back by a hook. The extra `["me"]`-prefixed queries it
   * refetches (`me/firsts`) are a harmless extra on a path that only runs after a
   * failure.
   *
   * A success flips `numberListFailed` and this effect's cleanup cancels whatever
   * was still scheduled, so the ladder stops at the first read that works instead
   * of firing its remaining rungs at a server that already answered.
   */
  useEffect(() => {
    if (!numberListFailed) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = () => {
      timer = setTimeout(() => {
        attempt += 1;
        void queryClient.invalidateQueries({ queryKey: keys.me });
        // Chained rather than three timers armed at once, so the delays are waits
        // BETWEEN attempts. Armed together they would be offsets from the same
        // instant, and a slow /v1/me would have all three in flight.
        if (attempt < NUMBER_LIST_RETRY_DELAYS_MS.length) scheduleNext();
      }, NUMBER_LIST_RETRY_DELAYS_MS[attempt]);
    };
    scheduleNext();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [numberListFailed, queryClient]);

  useEffect(() => {
    // #283: the realtime kill switch, and it can only be honoured here. The
    // Worker is not in this path — the browser holds its own Supabase token and
    // opens its own socket — so the switch travels on GET /v1/me and is obeyed
    // by not subscribing at all. React Query keeps polling, so the inbox is
    // slower and never wrong.
    //
    // `!== false` rather than a truthiness check: an absent flag means "no
    // statement", which must read as ON. Only an explicit false stops us.
    if (realtimeEnabled === false) return;

    const supabase = getSupabaseBrowser();
    let disposed = false;
    // Trailing per-conversation coalescing for conversation.updated bursts.
    const pendingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

    const isViewing = (conversationId: string) =>
      activeConversationRef.current === conversationId;

    async function handleMessageCreated(event: MessageCreatedEvent) {
      const { conversation_id, message_id, direction } = event;

      const cachedRow = findListRow(queryClient, companyId, conversation_id);

      // #215 efficiency: a spam conversation the user does NOT have open has
      // nothing to update — the open-thread append below would no-op (no thread
      // cache) and the inbox list stays spam-gated (SPEC §6.3). Skip the wasted
      // message fetch. An OPEN spam thread still live-appends (its thread cache
      // exists, so we fall through and patch it).
      if (
        cachedRow?.is_spam &&
        !queryClient.getQueryData<ThreadData>(
          keys.thread(companyId, conversation_id),
        )
      ) {
        return;
      }

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

      // Patch the thread cache when this thread has ever been opened — INCLUDING
      // a spam thread the user has open (reachable from the spam filter): a live
      // append into the OPEN thread must not depend on spam state (#215). Only the
      // inbox LIST / unread surfacing stays spam-gated below (SPEC §6.3).
      applyLiveThreadAppend(queryClient, companyId, conversation_id, page.data);

      // Spam-thread appends stay silent OUTSIDE the open thread — no inbox-list
      // row bump, no unread increment (SPEC §6.3). The open-thread patch above
      // already ran, so the viewer sees the message live either way.
      if (cachedRow?.is_spam) return;

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
        // #5: the pinned-conversations banner is a SEPARATE query (not part of
        // the paged lists this patch touches), so refresh it too when a live
        // message hits a pinned thread — otherwise its preview + unread dot go
        // stale. Only fires for the handful of pinned rows.
        if (cachedRow.pinned_at) {
          void queryClient.invalidateQueries({
            queryKey: keys.conversations.pinnedRoot(companyId),
          });
        }
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
      // Unread is per-viewer and the detail response does not carry it, so it
      // is only knowable from a row already on a loaded page. When there is no
      // such row, inserting one meant GUESSING read, and the guess stuck: it
      // became what the next lookup returned and what later updates carried
      // forward. A thread that was genuinely unread appeared at the top of the
      // inbox with no dot, while the server, the focus queue and the bell all
      // still counted it.
      //
      // So patch the rows that exist and leave the list alone otherwise. The
      // conversation is still reachable, and the next real fetch places it with
      // its true unread state.
      if (cachedRow) {
        patchConversationLists(queryClient, companyId, (list, filters) =>
          listApplyConversation(
            list,
            listItemFromDetail(detail, cachedRow.unread),
            filters,
          ),
        );
      }
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
      // #13: the pinned-message banner has its own query, and a message past
      // the loaded pages has no cached thread row for the patch above to hit.
      // Without this, a teammate pinning or unpinning something far up a long
      // thread never reached the other viewers' banner at all: the stale copy
      // from the pinned query simply survived.
      //
      // Every status broadcast carries the pin fields, so refetching on all of
      // them would put the banner behind a request per delivery receipt. The
      // cached list already says what the banner believes, so compare against
      // it and only refetch when this event actually disagrees.
      if ("pinned_at" in patch) {
        const nowPinned = patch.pinned_at != null;
        for (const query of queryClient.getQueryCache().findAll({
          queryKey: [companyId, "conversations", "pinned-messages"],
        })) {
          const cached = query.state.data as Message[] | undefined;
          if (!cached) continue;
          const listed = cached.some((row) => row.id === event.message_id);
          if (listed !== nowPinned) {
            void queryClient.invalidateQueries({ queryKey: query.queryKey });
          }
        }
      }
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

    /**
     * #358: this person's own read state moved, probably on another device.
     *
     * IGNORES EVERYBODY ELSE'S. The event rides the company topic, so without
     * this filter every member would refetch their counts whenever anybody
     * opened a thread.
     *
     * Safe against the #201 race by construction: `unread` is derived
     * server-side from a watermark, and the broadcast is an AFTER trigger, so
     * this refetch is guaranteed to observe the committed value. It is
     * strictly safer than the five-minute poll already running, which can fire
     * mid-write.
     */
    function handleReadState(event: ReadStateEvent) {
      if (event.user_id !== meUserIdRef.current) return;
      void queryClient.invalidateQueries({
        queryKey: keys.notifications.unreadCount(companyId),
      });
      void queryClient.invalidateQueries({
        queryKey: keys.notifications.feed(companyId),
      });
      // The focus queue counts unread threads too, so it moves with them.
      void queryClient.invalidateQueries({ queryKey: keys.forYou(companyId) });
      void queryClient.invalidateQueries({
        queryKey: keys.conversations.lists(companyId),
      });
    }

    function handleTaskChanged(event: TaskChangedEvent) {
      // TASKS.md T1.3: a task metadata change (create / assign / due / delete)
      // by ANY crew member — the ID-only payload carries just the source
      // conversation_id (D9). Refetch the two derived task reads through the
      // API so authorization stays server-side: the affected conversation's
      // checklist (the context-panel Tasks list) and the /tasks page lists root
      // (every filter combination — List/Board/Calendar/Map). This is the exact
      // invalidation the acting client's own mutation hooks run (lib/api/tasks.ts
      // invalidateTasks), now driven cross-client off the broadcast. Done toggles
      // are NOT this event (they ride message.status), so the derived done-state
      // on the checklist already updates via that path.
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.checklist(companyId, event.conversation_id),
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: keys.tasks.lists(companyId),
        refetchType: "active",
      });
      // #89: refresh the /for-you "Your tasks" section DIRECTLY (a teammate
      // assigning ME a task must move it into my For-you at once). We no longer
      // lean on useForYouNotificationsRealtime's cache-subscription for this: it
      // only fires when a tasks query happens to be cached, so a client sitting
      // on /for-you with the /tasks page never opened would miss the update.
      void queryClient.invalidateQueries({
        queryKey: keys.forYou(companyId),
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

    function handleCallUpdated() {
      // #133: the calls read model changed (new session, outcome merge). The
      // /calls surface is a plain server list — refetch it whole rather than
      // patching rows; the [companyId, "calls"] prefix intentionally covers
      // every outcome filter (keys.calls) and also matches the outbound-cell
      // query ([companyId, "calls", "cell"]), which is a harmless extra.
      void queryClient.invalidateQueries({
        queryKey: [companyId, "calls"],
        refetchType: "active",
      });
      // For-you hosts the ambient "Recent calls" section (#133); invalidated
      // DIRECTLY here because useForYouNotificationsRealtime only watches
      // conversations/messages/tasks keys — 'calls' is not watched (which is
      // also why this can never loop back through that cache subscription).
      void queryClient.invalidateQueries({
        queryKey: keys.forYou(companyId),
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
      // #480: RE-DERIVE THE NUMBER LIST, not just the data. Broadcasts are not
      // replayed, so an `access.changed` published while this tab was offline is
      // gone — and `keys.me` lives outside the `[companyId]` prefix above, has a
      // 60s staleTime, and `refetchOnWindowFocus` is off globally. Without this
      // the caches refresh while `topicKey` keeps whichever numbers were visible
      // before the gap, so a number granted (or provisioned) during an outage is
      // never subscribed to for the life of the page.
      //
      // Harmless while the company topic still carries everything; the moment
      // that send is removed it is the difference between self-healing and a
      // silently dead subscription.
      queryClient.invalidateQueries({ queryKey: keys.me });
    }

    // #215 Part A — the resync-on-focus safety net. A broadcast frame can be
    // dropped/missed/late (a transient CHANNEL_ERROR, a token-reauth window, a
    // backpressure drop on a client transport), and the only self-heal today is a
    // full socket re-JOIN (refetchFirstPages above). So an inbound message to the
    // OPEN conversation could sit unrendered until the user navigated away and
    // back — the reported #215 symptom. Refetch whatever is actively rendered
    // whenever the tab regains focus/visibility, so a lost frame self-heals within
    // seconds. Unlike refetchFirstPages this does NOT trim to page 1 — a routine
    // focus must never collapse a user's scrolled-back pagination — it just
    // invalidates the ACTIVE company-scoped queries (React Query refetches every
    // loaded page of each, picking up anything missed). Same primitive the
    // conversation list/calls/tasks surfaces use, so the whole class is closed.
    //
    // RATE-LIMITED (request cost). Firing this on every focus/visibility event
    // was a real load problem: a single tab switch raises BOTH `visibilitychange`
    // AND `focus`, so one glance sent two full invalidations — every active
    // company query (for-you, unread, conversations, tasks, calls…) refetching at
    // once, twice. And a two-second alt-tab cannot have missed anything: the
    // socket stayed connected and delivered live. So resync only when the tab was
    // genuinely AWAY long enough for a frame to plausibly be lost, and never more
    // than once per throttle window (which also collapses the duplicate
    // focus/visibility pair into one). The safety net is preserved for the case
    // it was built for — a long absence — at a fraction of the requests.
    const RESYNC_MIN_AWAY_MS = 30_000;
    const RESYNC_THROTTLE_MS = 60_000;
    let awaySince: number | null = null;
    let lastResyncAt = 0;

    function resyncActive() {
      queryClient.invalidateQueries({
        queryKey: [companyId],
        refetchType: "active",
      });
    }
    const markAway = () => {
      if (awaySince === null) awaySince = Date.now();
    };
    const maybeResync = () => {
      const now = Date.now();
      const awayFor = awaySince === null ? 0 : now - awaySince;
      awaySince = null;
      if (awayFor < RESYNC_MIN_AWAY_MS) return;
      if (now - lastResyncAt < RESYNC_THROTTLE_MS) return;
      lastResyncAt = now;
      resyncActive();
    };
    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") maybeResync();
      else markAway();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // A window blur/focus without a visibility change (another app on top) is
    // the same "was I away?" question — routed through the same gate.
    window.addEventListener("blur", markAway);
    window.addEventListener("focus", maybeResync);

    // #299: THE TAB THAT NEVER LEFT. Every trigger above asks "was I away?",
    // and the answer during a mid-session network drop is no — the office
    // manager watched the whole outage with the tab focused. So the #215 net
    // does not fire, the socket may reconnect without a JOIN that arms the gap
    // flag, and the only recovery was a manual reload. That is the exact case
    // #299 reports: "reconnect requires a reload."
    //
    // Routed through the SAME away-gate rather than resyncing directly, which
    // is what keeps it cheap and honest: a two-second blip cannot have lost a
    // frame worth refetching for, and a flapping connection must not turn into
    // a refetch storm. `offline` marks the start of the absence exactly as a
    // blur does — the tab was present, but the data was not.
    const onOffline = () => markAway();
    const onOnline = () => maybeResync();
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    // ONE gap flag for the whole socket rather than one per channel (#480).
    // Every channel drops and rejoins together, so a per-channel flag would run
    // the backfill N times for a single outage; the first channel back clears it
    // and the rest ride along.
    //
    // ARMED BY THE COMPANY TOPIC, and by a per-number topic only when its failure
    // is unambiguously a transport one (#483 finding 3). A per-number
    // CHANNEL_ERROR on a live socket is refusal-shaped, and treating that as a
    // gap pinned the flag for the life of the page: the refused channel re-joins
    // every ~10s forever, re-arming it, while nothing ever cleared it — so the
    // next legitimate join trimmed every infinite query to page 1 and collapsed
    // the user's scrolled-back pagination for an outage that never happened. The
    // company topic loses its transport at the same instant as everybody else and
    // can never be refused (`is_company_topic_member` admits every member), so it
    // is a complete and unambiguous witness for the case the backfill is for.
    //
    // Deliberately NOT hoisted into a ref across effect runs. The cleanup below
    // removes every channel, which reports CLOSED, so a rebuilt effect that
    // inherited the flag would trim everybody's pagination to page 1 on every
    // rebuild — and a rebuild is not what the backfill is for. It means the topic
    // set moved (/v1/me resolving at mount, a number added or removed, an
    // `access.changed`, a workspace switch): a deliberate re-join, with whatever
    // moved the set already refetching the reads it affects. The backfill exists
    // for a connectivity gap, which has events lost inside it.
    let hadDrop = false;

    // Private-topic authorization uses the Supabase session token; keep the
    // realtime connection's token fresh across refreshes (SPEC §8).
    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    /**
     * #480: the SAME handler set on every topic — the company channel and each
     * per-number channel alike.
     *
     * No de-duplication, on purpose. Since #484's contract step each event
     * arrives exactly once — a number-scoped one on its number's topic, a
     * company-wide one on the company topic — so there is nothing to de-duplicate
     * and never was anything worth building for it. Every handler below is an
     * idempotent id-only refetch trigger and `conversation.updated` coalesces, so
     * even a repeat would cost one redundant read rather than a wrong cache. A
     * seen-set would be new state to get wrong, and it would break the one
     * delivery that MUST come through the company topic: `call.updated` for a call
     * whose number was deleted has no per-number topic to arrive on.
     *
     * Three of these only ever arrive on the company topic —
     * `registration.updated` (one 10DLC brand/campaign per company),
     * `read.notifications` (one watermark per person) and `access.changed`. They
     * are registered uniformly anyway: one registration site is what keeps
     * "which events go where" a server decision, so the contract step needs no
     * edit here.
     */
    function openTopic(topic: string) {
      const channel = supabase.channel(topic, { config: { private: true } });
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
        // #133: {call_id, conversation_id} — ID-only like everything else, and
        // the handler needs neither: the calls list refetches whole.
        .on("broadcast", { event: "call.updated" }, handleCallUpdated)
        .on("broadcast", { event: "number.updated" }, handleProvisioningUpdate)
        .on(
          "broadcast",
          { event: "registration.updated" },
          handleProvisioningUpdate,
        )
        // #358: read state, filtered to this person inside the handler.
        .on("broadcast", { event: "read.conversation" }, ({ payload }) =>
          handleReadState(payload as ReadStateEvent),
        )
        .on("broadcast", { event: "read.notifications" }, ({ payload }) =>
          handleReadState(payload as ReadStateEvent),
        )
        // #480: somebody's number access changed. The payload deliberately names
        // NOTHING but the company — naming the number or the member would
        // broadcast the shape of the restriction to every member on the topic — so
        // a client cannot tell whether it was the subject and simply asks again.
        //
        // Everything a member may see is filtered by access server-side: the
        // conversation lists, the calls list, the numbers, and the company view's
        // embedded numbers. A revoked member currently keeps reading whatever they
        // had cached until something else happens to refetch it. This is the
        // signal that it should be now.
        .on("broadcast", { event: "access.changed" }, () => {
          // `keys.me` FIRST, and it is load-bearing, not housekeeping (#480): the
          // company view embeds the access-filtered number list that decides
          // WHICH topics this client joins, and its key is `["me", "company", id]`
          // — outside the `[companyId]` prefix below. Without it the caches would
          // refresh while the subscription set kept the number that was just taken
          // away, and realtime authorization is a join-time handshake, so nothing
          // else would drop it until the JWT refreshed (D88 addendum).
          void queryClient.invalidateQueries({ queryKey: keys.me });
          void queryClient.invalidateQueries({
            queryKey: [companyId],
            refetchType: "active",
          });
        });
      return channel;
    }

    // The company topic is torn down and re-opened under the SAME name whenever
    // this effect rebuilds, and that is only safe because of one realtime-js
    // property worth naming: `supabase.channel(topic)` returns the EXISTING
    // channel when the client still holds one for that topic, and
    // `removeChannel` drops it from the client's registry synchronously (phoenix
    // `leave()` sets the state to leaving, so its own `canPush()` is false and it
    // closes without waiting for the server's ack). React runs the cleanup and
    // the next effect body in one tick, so the removal has already landed and we
    // get a fresh channel. If that ever became asynchronous we would instead
    // register a second set of handlers on the channel being torn down, and
    // `subscribe()` — a no-op unless the channel is closed — would leave the
    // company topic dead for the rest of the session.
    const companyTopic = `company:${companyId}`;
    // Paired with its topic rather than read back off the channel: realtime-js
    // prefixes `channel.topic` with `realtime:`, and leaning on
    // `realtimeTopics` putting the company topic first would make the gap-flag
    // rule below depend on an array order nothing enforces.
    const channels = realtimeTopics(companyId, topicKey).map((topic) => ({
      topic,
      channel: openTopic(topic),
    }));

    /**
     * #483 finding 3: how many times a per-number join must be refused on a live
     * socket before we stop asking and drop the channel.
     *
     * TWO, not one, and the second one is what makes `isConnected()` below safe
     * to trust. Phoenix errors every channel from `heartbeatTimeout()` while the
     * socket's readyState is still `open` and only then tears it down — so that
     * path produces exactly ONE error on a seemingly-live socket and can never
     * produce a second (the channel is `errored` by then, and `triggerChanError`
     * skips errored channels). A refusal is re-pushed on the rejoin ladder and
     * refused again, every time, for the life of the page.
     */
    const REFUSALS_BEFORE_GIVING_UP = 2;
    /**
     * How long before a given-up per-number topic is tried again.
     *
     * A minute, not ten seconds: the original bug was a `phx_join` every ~10s
     * for the life of the page, each running the access policy against Postgres.
     * A genuinely revoked number settles into one cheap refusal a minute, and a
     * number lost to a token-refresh race comes back within one.
     */
    const GIVE_UP_RETRY_MS = 60_000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      for (const { topic, channel } of channels) {
        const isCompanyTopic = topic === companyTopic;
        // Consecutive refusals of THIS topic. Per channel, because one number
        // being taken away says nothing about the others.
        let refusals = 0;
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            refusals = 0;
            // Backfill whenever there WAS a gap, whether or not this channel had
            // joined before. The old guard also required a previous successful
            // join, which swallowed the case that needs the backfill most: a
            // first join that FAILED and succeeded on a retry. There a gap is
            // open from page load until the retry lands, and nothing else closes
            // it — mounted queries stay fresh for thirty seconds and the
            // away-tab resync never fires for someone who never left. A clean
            // first join records no gap, so it still refetches nothing.
            if (hadDrop) refetchFirstPages();
            hadDrop = false;
            return;
          }
          if (isCompanyTopic) {
            // Every failure of this topic is a real one — it cannot be refused
            // for a member who is in the company — so realtime-js keeps retrying
            // it and the gap is recorded.
            hadDrop = true;
            return;
          }
          // A per-number CHANNEL_ERROR on a socket that is still connected is the
          // policy answering: access was taken away between the /v1/me read and
          // the join. Retrying that forever costs a `phx_join` every ~10s for the
          // life of the page, each one running `is_company_topic_member` →
          // `member_number_level` → `member_number_levels` against Postgres, and
          // it can never succeed — only an access edit can bring the number back,
          // and that arrives as `access.changed`, which rebuilds this whole set
          // from the list the server now agrees with. So give up on it and drop
          // it; the siblings are already joined and stay joined.
          if (status === "CHANNEL_ERROR" && supabase.realtime.isConnected()) {
            refusals += 1;
            // On the threshold crossing exactly: `removeChannel` reports CLOSED
            // back into this callback, and a leave in flight can still surface an
            // error, so a `>=` test would try to remove the channel twice.
            if (refusals === REFUSALS_BEFORE_GIVING_UP) {
              void supabase.removeChannel(channel);
              // #483: and come back to it. Without this the channel is gone for
              // the life of the page — see `retryGeneration`. Cleared on
              // teardown so a rebuild cannot be scheduled against a disposed
              // effect.
              retryTimer = setTimeout(() => {
                if (!disposed) setRetryGeneration((g) => g + 1);
              }, GIVE_UP_RETRY_MS);
            }
            return;
          }
          refusals = 0;
          // What is left is a per-number failure that is NOT refusal-shaped: the
          // socket had already gone (so this number's events were being lost with
          // everybody else's) or the join timed out unanswered (so they were
          // being lost for this number alone, which the company topic would not
          // have noticed). Both are gaps. CLOSED is not — nothing leaves a
          // per-number topic except this file.
          if (status !== "CLOSED") hadDrop = true;
        });
      }
    })();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", markAway);
      window.removeEventListener("focus", maybeResync);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      for (const timer of pendingUpdates.values()) clearTimeout(timer);
      pendingUpdates.clear();
      // #483: a rebuild scheduled for a given-up topic must not outlive the run
      // that scheduled it — the `disposed` guard already refuses it, but leaving
      // the timer would keep a company switch alive for a minute for nothing.
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      authSubscription.unsubscribe();
      for (const { channel } of channels) void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient, realtimeEnabled, topicKey, retryGeneration]);

  return <>{children}</>;
}
