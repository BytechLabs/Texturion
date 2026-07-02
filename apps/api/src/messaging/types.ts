/**
 * Row and payload shapes shared across the messaging pipelines (SPEC §6–§8).
 * These mirror the §6 schema columns the pipelines read/write — not a full
 * ORM layer, just the fields this track touches.
 */

export interface MessageRow {
  id: string;
  company_id: string;
  conversation_id: string;
  direction: "inbound" | "outbound" | "note";
  body: string;
  telnyx_message_id: string | null;
  status: "received" | "queued" | "sent" | "delivered" | "failed" | null;
  segments: number | null;
  encoding: string | null;
  sent_by_user_id: string | null;
  error_code: string | null;
  error_detail: string | null;
  idempotency_key: string | null;
  provider_cost: number | string | null;
  /** D14 done state: set/cleared together (messages_done_consistency). */
  done_at: string | null;
  done_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Summary shape message objects carry everywhere (SPEC §7). */
export interface AttachmentSummary {
  id: string;
  content_type: string;
  size_bytes: number | null;
}

/**
 * The slice of a Telnyx `message.*` webhook payload (`data.payload`) the
 * pipelines consume. Every field is optional: webhook input is untrusted
 * until checked (§10), and unknown shapes must degrade to acked no-ops (§7).
 */
export interface TelnyxMessagePayload {
  id?: string;
  type?: string; // 'SMS' | 'MMS'
  direction?: string;
  text?: string;
  parts?: number;
  encoding?: string;
  cost?: { amount?: string; currency?: string } | null;
  from?: { phone_number?: string };
  to?: { phone_number?: string; status?: string }[];
  errors?: { code?: string; title?: string; detail?: string }[];
  media?: { url?: string; content_type?: string; size?: number }[];
}

/** Envelope shape of a verified Telnyx webhook event (SPEC §7). */
export interface TelnyxEvent {
  data?: {
    id?: string;
    event_type?: string;
    occurred_at?: string;
    payload?: TelnyxMessagePayload & Record<string, unknown>;
  };
  meta?: Record<string, unknown>;
}

/** Typed outcome of the gate_outbound_send RPC (SPEC §7, §10). */
export type GateResult =
  | { error: string }
  | { message: MessageRow; existing: boolean };

/** Typed outcome of the thread_inbound_message RPC (SPEC §4, §6, §8). */
export interface ThreadResult {
  message_id: string;
  conversation_id: string;
  created: boolean;
  opted_out: boolean;
  /**
   * The §8 debounce claim, decided (and last_notified_at stamped) atomically
   * inside the threading transaction: true exactly when this delivery must
   * run the notification pipeline.
   */
  notify: boolean;
}
