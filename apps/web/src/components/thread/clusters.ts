import { format, isSameDay, isSameYear, subDays } from "date-fns";

import type { ConversationEvent, Message } from "@/lib/api/types";

/**
 * Pure thread-timeline builder (G5): messages group into clusters (same
 * sender within 3 minutes), day dividers split calendar days ("Today",
 * "Yesterday", "Jun 12"), and conversation events render as centered system
 * lines in chronological position. Unit-tested directly.
 */

export const CLUSTER_GAP_MS = 3 * 60_000;

export interface DividerItem {
  kind: "divider";
  key: string;
  label: string;
}

export interface ClusterItem {
  kind: "cluster";
  key: string;
  direction: Message["direction"];
  /** Outbound/note author id; null for inbound (the contact). */
  senderUserId: string | null;
  messages: Message[];
}

export interface EventItem {
  kind: "event";
  key: string;
  event: ConversationEvent;
}

export type ThreadItem = DividerItem | ClusterItem | EventItem;

export function dayDividerLabel(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return "Today";
  if (isSameDay(date, subDays(now, 1))) return "Yesterday";
  if (isSameYear(date, now)) return format(date, "MMM d");
  return format(date, "MMM d yyyy");
}

interface Entry {
  at: number;
  id: string;
  message?: Message;
  event?: ConversationEvent;
}

function senderKey(message: Message): string {
  // Inbound is always "the contact"; outbound and notes cluster per author.
  if (message.direction === "inbound") return "inbound";
  return `${message.direction}:${message.sent_by_user_id ?? "system"}`;
}

/**
 * Build the render list from chronology: `messages` and `events` may arrive
 * in any order; output is ascending (created_at, id) with dividers injected
 * at day boundaries. A system event between two messages breaks the cluster
 * (the timeline stays honest about ordering).
 */
export function buildThreadItems(
  messages: readonly Message[],
  events: readonly ConversationEvent[],
  now: Date = new Date(),
): ThreadItem[] {
  const entries: Entry[] = [
    ...messages.map((message) => ({
      at: Date.parse(message.created_at),
      id: message.id,
      message,
    })),
    ...events.map((event) => ({
      at: Date.parse(event.created_at),
      id: event.id,
      event,
    })),
  ].sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id < b.id ? -1 : 1));

  const items: ThreadItem[] = [];
  let lastDay: Date | null = null;
  let cluster: ClusterItem | null = null;
  let clusterKey: string | null = null;
  let lastMessage: Message | null = null;

  for (const entry of entries) {
    const date = new Date(entry.at);

    if (lastDay === null || !isSameDay(date, lastDay)) {
      items.push({
        kind: "divider",
        key: `divider:${format(date, "yyyy-MM-dd")}`,
        label: dayDividerLabel(date, now),
      });
      lastDay = date;
      cluster = null;
      clusterKey = null;
      lastMessage = null;
    }

    if (entry.event) {
      items.push({ kind: "event", key: `event:${entry.id}`, event: entry.event });
      cluster = null; // an event line visually separates message runs
      clusterKey = null;
      lastMessage = null;
      continue;
    }

    const message = entry.message as Message;
    const sameCluster =
      cluster !== null &&
      lastMessage !== null &&
      clusterKey === senderKey(message) &&
      entry.at - Date.parse(lastMessage.created_at) <= CLUSTER_GAP_MS;

    if (sameCluster && cluster) {
      cluster.messages.push(message);
    } else {
      cluster = {
        kind: "cluster",
        key: `cluster:${message.id}`,
        direction: message.direction,
        senderUserId:
          message.direction === "inbound" ? null : message.sent_by_user_id,
        messages: [message],
      };
      clusterKey = senderKey(message);
      items.push(cluster);
    }
    lastMessage = message;
  }

  return items;
}
