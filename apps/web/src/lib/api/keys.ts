import type { ConversationFilters } from "./filters";
import type { TaskListFilters } from "./task-filters";

/**
 * Query-key factory. Every company-scoped key starts with the company id
 * (G12: query keys per company) so switching workspaces never bleeds data
 * and realtime invalidation can target one tenant's cache.
 */
export const keys = {
  /** Company-exempt. */
  me: ["me"] as const,
  /** Company-exempt (#109): the caller's own pending invites, all companies. */
  myInvites: ["my-invites"] as const,
  /** Company-exempt (#236): your signed-in devices belong to you, not a workspace. */
  mySessions: ["my-sessions"] as const,
  /** Company-exempt (#314): your second factor is yours, in every workspace. */
  mfa: ["mfa"] as const,
  /** Company-exempt (public Telnyx inventory) — the number-picker feed. */
  availableNumbers: (
    country: string,
    areaCode: string | null,
    bestEffort: boolean,
    // #513: part of the key, or typing digits would keep serving the cached
    // unfiltered batch and the search would look broken all over again.
    contains?: string,
  ) =>
    ["available-numbers", country, areaCode, bestEffort, contains ?? null] as const,

  company: (companyId: string) => [companyId, "company"] as const,
  usage: (companyId: string) => [companyId, "usage"] as const,
  modules: (companyId: string) => [companyId, "modules"] as const,
  /** #490: calls that reached a line which could not take them. */
  missedWhileOff: (companyId: string) =>
    [companyId, "missed-while-off"] as const,
  /**
   * #523: numbers this workspace holds that its plan does not cover.
   *
   * Its own root rather than a segment under `company`, because it is read on
   * TWO screens (billing and numbers) that must agree, and both a reinstate and
   * a plan upgrade change it. A key under `company` would be swept by every
   * routine company invalidation — a module toggle, a dismissed win-back — and
   * this is a question only a workspace with a suspended number ever asks.
   */
  heldNumbers: (companyId: string) => [companyId, "held-numbers"] as const,
  numbers: (companyId: string) => [companyId, "numbers"] as const,
  /** #106: one number's access shape (who can use it, at what level). */
  numberAccess: (companyId: string, numberId: string) =>
    [companyId, "numbers", "access", numberId] as const,
  /** #307: one line's identity, resolved with what it inherits. */
  numberIdentity: (companyId: string, numberId: string) =>
    [companyId, "numbers", numberId, "identity"] as const,
  registration: (companyId: string) => [companyId, "registration"] as const,
  portRequests: {
    /** Root for the company's port list + every port detail. */
    all: (companyId: string) => [companyId, "port-requests"] as const,
    list: (companyId: string) => [companyId, "port-requests", "list"] as const,
    detail: (companyId: string, portId: string) =>
      [companyId, "port-requests", "detail", portId] as const,
  },
  textEnablements: {
    /** Root for the company's text-enablement list + every order detail. */
    all: (companyId: string) => [companyId, "text-enablements"] as const,
    list: (companyId: string) =>
      [companyId, "text-enablements", "list"] as const,
    detail: (companyId: string, orderId: string) =>
      [companyId, "text-enablements", "detail", orderId] as const,
  },
  tags: (companyId: string) => [companyId, "tags"] as const,
  /** #298: usage counts, read only on the tag-management screen. */
  tagUsage: (companyId: string) => [companyId, "tags", "usage"] as const,
  /** #280: one key per surface — the two lists are fetched independently. */
  savedViews: (companyId: string, surface: string) =>
    [companyId, "saved-views", surface] as const,
  /** Badges are keyed on the ids ASKED FOR, so a changed set refetches. */
  savedViewCounts: (companyId: string, surface: string, ids: string[]) =>
    [companyId, "saved-views", surface, "counts", ids.join(",")] as const,
  /** #243: the workspace API keys, live and revoked. */
  apiKeys: (companyId: string) => [companyId, "api-keys"] as const,
  /** #243: the endpoint list, and one delivery log per endpoint. */
  webhookEndpoints: (companyId: string) =>
    [companyId, "webhook-endpoints"] as const,
  webhookDeliveries: (companyId: string, endpointId: string) =>
    [companyId, "webhook-endpoints", endpointId, "deliveries"] as const,
  templates: (companyId: string) => [companyId, "templates"] as const,
  /**
   * #274: the picker's use-sorted list and the settings alphabetical one
   * are different lists, so they get different keys. Sharing one would
   * have a picker open in whatever order the settings page last fetched.
   * Prefixed with `templates` so one invalidation still clears both.
   */
  templatesSorted: (companyId: string, sort: "name" | "use") =>
    [companyId, "templates", sort] as const,
  members: (companyId: string) => [companyId, "members"] as const,
  /** #236: every active member's live devices, workspace-wide. */
  workspaceSessions: (companyId: string) =>
    ["workspace-sessions", companyId] as const,
  /** #332: who owns the workspace, and any handover in flight. */
  ownership: (companyId: string) => [companyId, "ownership"] as const,
  mentionableMembers: (companyId: string, conversationId: string) =>
    [companyId, "conversation", conversationId, "mentionable-members"] as const,
  invites: (companyId: string) => [companyId, "invites"] as const,
  notificationPrefs: (companyId: string) =>
    [companyId, "notification-prefs"] as const,
  /** #214 per-company AI enrichment opt-in (Settings → AI). */
  aiSettings: (companyId: string) => [companyId, "ai-settings"] as const,

  conversations: {
    /** Root for every conversation list (all filter combinations). */
    lists: (companyId: string) => [companyId, "conversations", "list"] as const,
    list: (companyId: string, filters: ConversationFilters) =>
      [companyId, "conversations", "list", filters] as const,
    /** Root for every pinned-only supplement query (#13). */
    pinnedRoot: (companyId: string) =>
      [companyId, "conversations", "pinned"] as const,
    /** #13 pinned-only supplement — surfaces pins past the loaded pages. */
    pinned: (companyId: string, filters: ConversationFilters) =>
      [companyId, "conversations", "pinned", filters] as const,
    detail: (companyId: string, conversationId: string) =>
      [companyId, "conversations", "detail", conversationId] as const,
    /** #13 part 2: the conversation's full pinned-message set for the banner. */
    pinnedMessages: (companyId: string, conversationId: string) =>
      [companyId, "conversations", "pinned-messages", conversationId] as const,
    events: (companyId: string, conversationId: string) =>
      [companyId, "conversations", "events", conversationId] as const,
    /** The attachments gallery — union of message + note + task media (§5.2). */
    attachments: (companyId: string, conversationId: string) =>
      [companyId, "conversations", "attachments", conversationId] as const,
  },

  /** Root for every message thread in the company. */
  threads: (companyId: string) => [companyId, "messages"] as const,
  thread: (companyId: string, conversationId: string) =>
    [companyId, "messages", conversationId] as const,

  contacts: {
    lists: (companyId: string) => [companyId, "contacts", "list"] as const,
    /** #246: the likely duplicates. Under `contacts` so a merge clears both. */
    duplicates: (companyId: string) =>
      [companyId, "contacts", "duplicates"] as const,
    list: (companyId: string, q: string) =>
      [companyId, "contacts", "list", q] as const,
    detail: (companyId: string, contactId: string) =>
      [companyId, "contacts", "detail", contactId] as const,
  },

  /**
   * Tasks (D17). `checklist` is the per-conversation checklist (T5.2); `lists`
   * / `list` cover the /tasks page's filtered views (T6.1); `detail` is one
   * task (T6.2). Both the checklist and the /tasks list refetch on the
   * `task.changed` broadcast, which carries only `conversation_id` — so the
   * checklist key is conversation-scoped and the lists key is the invalidation
   * root for every filter combination.
   */
  tasks: {
    /** Root for every /tasks page list (all filter combinations). */
    lists: (companyId: string) => [companyId, "tasks", "list"] as const,
    list: (companyId: string, filters: TaskListFilters) =>
      [companyId, "tasks", "list", filters] as const,
    detail: (companyId: string, taskId: string) =>
      [companyId, "tasks", "detail", taskId] as const,
    /** The conversation checklist (T5.2) — one thread's live tasks. */
    checklist: (companyId: string, conversationId: string) =>
      [companyId, "tasks", "checklist", conversationId] as const,
  },

  /**
   * The /for-you focus queue (D23) — one derived four-section object per
   * company+user. Company-scoped like everything else; the user is implicit in
   * the caller's token, so no user segment is needed in the key.
   */
  forYou: (companyId: string) => [companyId, "for-you"] as const,
  /** #342: spam marks that do not look like spam. */
  spamReview: (companyId: string) => [companyId, "spam-review"] as const,

  /**
   * #129 /calls — the call log, one cursor list per outcome filter
   * ("all" | "missed" | "answered" | "voicemail").
   */
  calls: (companyId: string, outcome: string) =>
    [companyId, "calls", outcome] as const,

  /**
   * #239 response-time report, one entry per window. Keyed by the window so
   * switching 7/30/90 days does not show the previous window's number while the
   * new one loads — a stale median next to a fresh label is a number the crew
   * would reasonably believe.
   */
  /** #354: the pipeline report, keyed like its neighbour. */
  pipeline: (companyId: string, days: number) =>
    [companyId, "reports", "pipeline", days] as const,
  responseTime: (companyId: string, days: number) =>
    [companyId, "response-time", days] as const,
  /** #244: the on-call rota — one list per workspace, no window. */
  onCall: (companyId: string) => [companyId, "on-call"] as const,
  /** #313: satisfaction, keyed like its two neighbours on the same surface. */
  satisfaction: (companyId: string, days: number) =>
    [companyId, "reports", "satisfaction", days] as const,

  /**
   * Notifications read-model (D24). `feed` is the popover's cursor list;
   * `unreadCount` is the bell badge. Both derive from the same union server-side
   * and are invalidated together whenever the watermark moves or realtime fires.
   */
  notifications: {
    feed: (companyId: string) => [companyId, "notifications", "feed"] as const,
    unreadCount: (companyId: string) =>
      [companyId, "notifications", "unread-count"] as const,
  },

  /**
   * #224 text-to-pay. The two keys are shaped DIFFERENTLY on purpose, and #607
   * is what made the difference load-bearing.
   *
   * `requests` is one thread's payment requests, and it sits INSIDE the
   * `[companyId]` prefix. Since #607 the payment strip is live off the
   * `payment.updated` broadcast, and every self-heal path in the realtime
   * provider — the reconnect backfill and the away-tab resync — invalidates that
   * prefix and nothing else. A key outside it would receive the broadcast and
   * have no net under it, so one dropped frame would leave "Requested" on screen
   * for money that already arrived, until somebody reopened the thread. Of every
   * surface in this app that is the worst one to be quietly wrong on.
   *
   * `account` is deliberately OUTSIDE it and must stay there. GET
   * /v1/payments/account refreshes from Stripe on EVERY read (routes/payments.ts
   * says so and means it), and `usePayoutAccount` is mounted by the composer —
   * so on every open thread, for every member. Under the company prefix, each
   * away-tab resync would spend a Stripe API call per member to re-read a
   * workspace setting that only moves when an owner finishes onboarding.
   */
  // #287: quotes are per-thread on the composer strip and workspace-wide in
  // the outstanding queue, so the two lists are keyed separately - sending a
  // draft has to invalidate both.
  quotes: {
    forConversation: (companyId: string, conversationId: string) =>
      [companyId, "quotes", "conversation", conversationId] as const,
    outstanding: (companyId: string) => [companyId, "quotes", "outstanding"] as const,
  },

  payments: {
    requests: (companyId: string, conversationId: string) =>
      [companyId, "payments", "requests", conversationId] as const,
    account: (companyId: string) => ["payments", "account", companyId] as const,
  },

  search: (companyId: string, q: string) => [companyId, "search", q] as const,
  /**
   * #240: the variant is part of the key. A row has two objects behind one id —
   * a preview and the original — and caching them together would hand a
   * lightbox the thumbnail it already had, or worse, hand a thread scroll the
   * 25 MB original because a lightbox happened to open first.
   */
  attachmentUrl: (
    companyId: string,
    attachmentId: string,
    variant: "preview" | "original" = "preview",
  ) => [companyId, "attachments", attachmentId, "url", variant] as const,
  /**
   * The generic (note/task) attachment list for one owner (D19 —
   * GET /v1/attachments?owner_type=&owner_id=). Keyed by owner so a note's and
   * a task's attachments never share a cache entry; the upload mutation
   * invalidates exactly this key.
   */
  ownerAttachments: (
    companyId: string,
    ownerType: string,
    ownerId: string,
  ) => [companyId, "attachments", "owner", ownerType, ownerId] as const,
} as const;

/**
 * The query keys a task metadata change (create / assign / due / delete) on one
 * thread must invalidate: the thread's checklist, the /tasks page lists, AND the
 * /for-you "Your tasks" section (#89).
 *
 * The /for-you queue is a SEPARATE query (`forYou`) — it must be invalidated
 * DIRECTLY, not left to the cache-subscription in useForYouNotificationsRealtime.
 * That subscription only fires when a tasks-list/checklist query is currently
 * cached, so a task created while sitting on /for-you (with the /tasks page never
 * opened, or its cache GC'd) would not refresh For-you: the new task would only
 * appear after a manual reload. Kept here (the pure key factory, no client/env
 * imports) so the invalidation set is unit-testable.
 */
export function taskMetadataInvalidationKeys(
  companyId: string,
  conversationId: string,
): readonly (readonly unknown[])[] {
  return [
    keys.tasks.checklist(companyId, conversationId),
    keys.tasks.lists(companyId),
    keys.forYou(companyId),
  ];
}
