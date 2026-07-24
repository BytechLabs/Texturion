/**
 * Shared request/response helpers for the /v1 route sub-apps (SPEC §7
 * conventions). Everything here throws ApiError so the app-level onError hook
 * renders the stable `{ error: { code, message } }` envelope.
 */
import type { Context } from "hono";
import { z } from "zod";

import { ApiError } from "../../http/errors";
import { decodeCursor, type Cursor } from "../../http/pagination";

/** Parse and zod-validate a JSON body; any failure is 422 `validation_failed`. */
export async function parseJsonBody<S extends z.ZodType>(
  c: Context,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError("validation_failed", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError("validation_failed", summarizeIssues(result.error));
  }
  return result.data;
}

/** Zod-validate an already-parsed value (query params etc.) — 422 on failure. */
export function parseWith<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError("validation_failed", summarizeIssues(result.error));
  }
  return result.data;
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

/**
 * Cheap DoS guard for multipart routes (SPEC §10): reject an oversized upload
 * from its declared Content-Length BEFORE `formData()` buffers the whole body
 * into Worker memory. Best-effort by design — a chunked request carries no
 * Content-Length and falls through to the per-file size checks that run after
 * parsing — but a declared length over the cap is refused without reading a
 * single body byte.
 */
export function assertBodyWithinLimit(c: Context, maxBytes: number): void {
  const header = c.req.header("Content-Length");
  if (header === undefined) return;
  const declared = Number(header);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(
      "validation_failed",
      `Request body exceeds the ${Math.ceil(maxBytes / (1024 * 1024))} MB upload limit.`,
    );
  }
}

/**
 * `limit` query param: positive integer, capped at `max`, `fallback` when
 * absent (SPEC §7: conversations default 25; messages default 50, max 100).
 */
export function parseLimit(c: Context, fallback: number, max: number): number {
  const raw = c.req.query("limit");
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ApiError(
      "validation_failed",
      `limit must be an integer between 1 and ${max}.`,
    );
  }
  return value;
}

/** Optional opaque cursor query param → decoded sort key (422 on garbage). */
export function parseCursor(c: Context): Cursor | null {
  const raw = c.req.query("cursor");
  return raw === undefined ? null : decodeCursor(raw);
}

const uuidSchema = z.uuid();

/**
 * Path :id params. A malformed UUID names a resource that cannot exist, so it
 * is 404 `not_found` (and never reaches PostgREST, which would 500 on an
 * unparsable uuid input).
 */
export function pathUuid(c: Context, name: string): string {
  const raw = c.req.param(name);
  const result = uuidSchema.safeParse(raw);
  if (!result.success) {
    throw new ApiError("not_found", "No such resource.");
  }
  return result.data;
}

/**
 * Minimal shape of a supabase-js result this layer cares about. `data` is
 * `unknown` on purpose: without generated Database types supabase-js cannot
 * type computed select strings, so the caller names the row shape at the
 * `unwrap<T>` call site instead.
 */
export interface DbResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** Postgres unique_violation — the SPEC §7 `conflict` trigger. */
export function isUniqueViolation(error: {
  code?: string;
} | null): boolean {
  return error?.code === "23505";
}

/**
 * Unwrap a supabase-js result. Database errors are infrastructure failures
 * (500 via onError), EXCEPT unique violations when the caller names a
 * `conflictMessage` — those are the SPEC §7 409 `conflict` outcome.
 */
export function unwrap<T>(
  result: DbResult,
  what: string,
  conflictMessage?: string,
): T {
  if (result.error) {
    if (conflictMessage !== undefined && isUniqueViolation(result.error)) {
      throw new ApiError("conflict", conflictMessage);
    }
    throw new Error(`${what} failed: ${result.error.message}`);
  }
  if (result.data === null || result.data === undefined) {
    throw new Error(`${what} failed: no data returned`);
  }
  return result.data as T;
}

/**
 * Check a supabase-js mutation result that returns no representation
 * (no `.select()` — `data` is legitimately null): only the error matters.
 */
export function expectOk(
  result: { error: { message: string } | null },
  what: string,
): void {
  if (result.error) {
    throw new Error(`${what} failed: ${result.error.message}`);
  }
}

/**
 * PostgREST `or=` filter implementing keyset pagination over the composite
 * sort key `(timestampColumn, id) < (cursor.ts, cursor.id)` for DESC lists
 * (SPEC §7 cursor convention).
 */
export function keysetFilter(timestampColumn: string, cursor: Cursor): string {
  return `${timestampColumn}.lt.${cursor.ts},and(${timestampColumn}.eq.${cursor.ts},id.lt.${cursor.id})`;
}

/**
 * Escape LIKE/ILIKE wildcards in user-supplied search text so `q` matches
 * literally (used by the trgm-backed ilike filters). Strips PostgREST's `*`
 * wildcard first — PostgREST maps `*`→`%` at the URL layer BEFORE SQL, so a
 * backslash can't escape it; leaving it in let a user `*` over-match — then
 * backslash-escapes the SQL LIKE metacharacters.
 */
export function escapeLike(q: string): string {
  return q.replace(/\*/g, "").replace(/[\\%_]/g, "\\$&");
}

/**
 * Sanitize user text for embedding in a PostgREST `or=(...)` logic tree as an
 * ilike value: strips the characters PostgREST's tree parser reserves
 * (quotes, backslashes, commas, parens) and the LIKE wildcards themselves —
 * none of which occur in the names/phones this filter targets — so the rest
 * matches literally.
 */
export function orIlikeValue(q: string): string {
  // Includes `*` — PostgREST's URL-level ilike wildcard (maps to `%`) — so a
  // user `*` can't over-match through the `name.ilike.*<q>*` filter.
  return q.replace(/["\\%_(),*]/g, "");
}
