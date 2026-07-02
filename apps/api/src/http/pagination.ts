import { z } from "zod";

import { ApiError } from "./errors";

/**
 * Cursor pagination (SPEC §7, D10): lists are cursor-based only — an opaque
 * base64url encoding of the composite sort key `(timestamptz, id)`.
 * Conversations key on (last_message_at, id) DESC; messages and events on
 * (created_at, id) DESC.
 */
const cursorSchema = z.object({
  ts: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export type Cursor = z.infer<typeof cursorSchema>;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Encode a sort key into an opaque cursor. Validates the key shape first. */
export function encodeCursor(cursor: Cursor): string {
  return toBase64Url(JSON.stringify(cursorSchema.parse(cursor)));
}

/**
 * Decode and validate an opaque cursor from a query param. Garbage, tampered,
 * or wrong-shape cursors are a client error: 422 `validation_failed`.
 */
export function decodeCursor(raw: string): Cursor {
  let candidate: unknown;
  try {
    candidate = JSON.parse(fromBase64Url(raw));
  } catch {
    throw new ApiError("validation_failed", "Invalid cursor.");
  }
  const result = cursorSchema.safeParse(candidate);
  if (!result.success) {
    throw new ApiError("validation_failed", "Invalid cursor.");
  }
  return result.data;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

/**
 * Build the SPEC §7 list envelope `{ data, next_cursor }` from rows fetched
 * with `limit + 1` (the extra row only signals that a next page exists — it is
 * trimmed from the response). `timestampColumn` names the timestamptz half of
 * the sort key: 'created_at' (default) for messages/events, 'last_message_at'
 * for conversations.
 */
export function buildPage<T extends { id: string }>(
  rows: readonly T[],
  limit: number,
  timestampColumn: Extract<keyof T, string> = "created_at" as Extract<
    keyof T,
    string
  >,
): Page<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ApiError("validation_failed", "limit must be a positive integer.");
  }
  if (rows.length <= limit) {
    return { data: [...rows], next_cursor: null };
  }
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  const ts = (last as Record<string, unknown>)[timestampColumn];
  if (typeof ts !== "string") {
    // Programmer error (wrong column for the row shape) — surface loudly.
    throw new Error(
      `buildPage: row is missing string timestamp column "${timestampColumn}"`,
    );
  }
  return { data, next_cursor: encodeCursor({ ts, id: last.id }) };
}
