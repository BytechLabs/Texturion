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

  company: (companyId: string) => [companyId, "company"] as const,
  usage: (companyId: string) => [companyId, "usage"] as const,
  numbers: (companyId: string) => [companyId, "numbers"] as const,
  registration: (companyId: string) => [companyId, "registration"] as const,
  portRequests: {
    /** Root for the company's port list + every port detail. */
    all: (companyId: string) => [companyId, "port-requests"] as const,
    list: (companyId: string) => [companyId, "port-requests", "list"] as const,
    detail: (companyId: string, portId: string) =>
      [companyId, "port-requests", "detail", portId] as const,
  },
  tags: (companyId: string) => [companyId, "tags"] as const,
  templates: (companyId: string) => [companyId, "templates"] as const,
  members: (companyId: string) => [companyId, "members"] as const,
  invites: (companyId: string) => [companyId, "invites"] as const,
  notificationPrefs: (companyId: string) =>
    [companyId, "notification-prefs"] as const,

  conversations: {
    /** Root for every conversation list (all filter combinations). */
    lists: (companyId: string) => [companyId, "conversations", "list"] as const,
    list: (companyId: string, filters: ConversationFilters) =>
      [companyId, "conversations", "list", filters] as const,
    detail: (companyId: string, conversationId: string) =>
      [companyId, "conversations", "detail", conversationId] as const,
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

  search: (companyId: string, q: string) => [companyId, "search", q] as const,
  attachmentUrl: (companyId: string, attachmentId: string) =>
    [companyId, "attachments", attachmentId, "url"] as const,
} as const;
