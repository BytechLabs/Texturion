import type { ConversationFilters } from "./filters";

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

  search: (companyId: string, q: string) => [companyId, "search", q] as const,
  attachmentUrl: (companyId: string, attachmentId: string) =>
    [companyId, "attachments", attachmentId, "url"] as const,
} as const;
