import type {
  MessageDirection,
  MessageStatus,
  NumberStatus,
  RegistrationStatus,
} from "@/lib/api/types";

/**
 * SPEC §8 Broadcast events — ID-only payloads published by the database
 * triggers into the private topic `company:{id}`; clients refetch the
 * referenced resources through the API so authorization stays in one place.
 */

export interface MessageCreatedEvent {
  conversation_id: string;
  message_id: string;
  direction: MessageDirection;
}

export interface MessageStatusEvent {
  message_id: string;
  status: MessageStatus;
}

export interface ConversationUpdatedEvent {
  conversation_id: string;
}

export interface NumberUpdatedEvent {
  number_id: string;
  status: NumberStatus;
}

export interface RegistrationUpdatedEvent {
  kind: "brand" | "campaign";
  status: RegistrationStatus;
}

export const REALTIME_EVENTS = [
  "message.created",
  "message.status",
  "conversation.updated",
  "number.updated",
  "registration.updated",
] as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];
