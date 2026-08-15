import {
  API_KEY_PREFIX,
  API_KEY_REQUESTS_PER_MINUTE,
  PUBLIC_API_VERSION,
  PUBLIC_API_VERSION_HEADER,
  apiKeyAllows,
  type ApiKeyScope,
  type MemberRole,
} from "@loonext/shared";
import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";

/**
 * #243 — the public API's front door.
 *
 * ## A key ACTS AS the person who made it, narrowed by scopes
 *
 * The middleware resolves the key, then resolves its creator's membership
 * through the same `api_authorize_request` every first-party request uses, and
 * sets the same `userId` / `companyId` / `role` / `memberId` variables. Every
 * gate already in the product therefore applies to a key request unchanged —
 * #106's per-number visibility, `requireCapability`, the tenant scope on every
 * query — and the scopes are a SECOND, narrower gate on top.
 *
 * That is what makes "a key can do less than the person who made it"
 * structurally true rather than a claim. It also means the key dies with its
 * creator's access: an admin who is deactivated, or who loses sight of a
 * number, takes their key's reach with them on the very next request. There is
 * no frozen copy of anybody's permissions anywhere in this path.
 *
 * ## What is deliberately NOT here
 *
 * **No MFA step-up.** A key has no human to prompt and no browser to redirect,
 * so demanding a second factor would simply make every key unusable. The
 * credential itself is 256 random bits that only ever existed in one response —
 * a stronger secret than any password a step-up protects — and it is bounded by
 * scopes that reach nothing a takeover would want. The workspace's MFA
 * requirement still governs every human sign-in; it does not govern a
 * credential the owner minted on purpose.
 *
 * **No new-device announcement.** `p_session_id` is null because there is no
 * device. A key is not a phone somebody signed in on, and reporting it as one
 * would train the account holder to ignore the alert that matters.
 */

/** SHA-256 hex of the presented token. Matches `api_keys.token_hash`. */
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface ResolvedKey {
  id: string;
  company_id: string;
  scopes: string[];
  created_by: string;
}

interface AuthorizeAnswer {
  member?: { role?: string; member_id?: string; id?: string } | null;
}

/**
 * Read the bearer token, or null.
 *
 * The prefix check happens BEFORE any database work, which is the point: a
 * scanner spraying passwords at this endpoint never reaches a lookup, and the
 * cost of an unauthenticated request stays a string comparison.
 */
function presentedToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1]!;
  if (!token.startsWith(API_KEY_PREFIX)) return null;
  // Long enough to be one of ours, bounded so a megabyte of "Bearer aaaa…"
  // cannot make us hash it.
  if (token.length < 20 || token.length > 200) return null;
  return token;
}

export function apiKeyAuth() {
  return createMiddleware<AppEnv>(async (c, next) => {
    // Said on every response, including the refusals. A client that pins
    // nothing still gets told which version answered, which is what turns "our
    // integration broke" into a report with a fact in it.
    c.header(PUBLIC_API_VERSION_HEADER, PUBLIC_API_VERSION);

    const token = presentedToken(c.req.header("Authorization"));
    if (!token) {
      return errorResponse(
        c,
        "unauthorized",
        "Provide an API key as `Authorization: Bearer <key>`.",
      );
    }

    const env = getEnv(c.env);
    const db = getDb(env);
    const { data, error } = await db.rpc("api_resolve_key", {
      p_token_hash: await hashToken(token),
    });
    if (error) {
      // Infrastructure failure, not an authorization outcome — 500, never 401.
      throw new Error(`api key resolution failed: ${error.message}`);
    }

    const key = ((data ?? []) as ResolvedKey[])[0];
    if (!key) {
      // Deliberately the same answer for unknown, revoked and expired. A
      // public endpoint that distinguishes them tells whoever is guessing
      // which of their guesses was once real.
      return errorResponse(c, "unauthorized", "That API key is not valid.");
    }

    // #243 item 4: an integration that polls every second must cost the
    // workspace something or it costs us. Keyed on the KEY rather than the
    // company, so one runaway connector cannot starve the workspace's others.
    if (env.PUBLIC_API_RATE_LIMITER) {
      const { success } = await env.PUBLIC_API_RATE_LIMITER.limit({ key: key.id });
      if (!success) {
        return errorResponse(
          c,
          "rate_limited",
          `This key is limited to ${API_KEY_REQUESTS_PER_MINUTE} requests a minute.`,
        );
      }
    }

    // The creator's membership, resolved LIVE on every request. This is the
    // half that makes a key expire with the person: a deactivated member, or
    // one removed from the workspace, resolves to no membership and the key
    // stops working here rather than at some cache's convenience.
    const { data: authorized, error: authError } = await db.rpc(
      "api_authorize_request",
      {
        p_user_id: key.created_by,
        p_session_id: null,
        p_company_id: key.company_id,
        p_client: "api",
        p_user_agent: c.req.header("User-Agent") ?? null,
        p_country: null,
        p_region: null,
        p_city: null,
        p_app_version: null,
      },
    );
    if (authError) {
      throw new Error(`api key authorization failed: ${authError.message}`);
    }

    const member = (authorized as AuthorizeAnswer | null)?.member;
    const role = member?.role;
    const memberId = member?.member_id ?? member?.id;
    if (!role || !memberId) {
      // The key outlived its creator's access. Reported as an authorization
      // failure rather than a 401, because the credential IS valid — what
      // changed is who it belongs to.
      return errorResponse(
        c,
        "forbidden",
        "The member who created this key is no longer active in this workspace.",
      );
    }

    c.set("userId", key.created_by);
    c.set("companyId", key.company_id);
    c.set("role", role as MemberRole);
    c.set("memberId", memberId);
    c.set("apiKeyId", key.id);
    c.set("apiKeyScopes", key.scopes);

    await next();
  });
}

/**
 * The second gate: does this key's scope set permit this route?
 *
 * Applied ON TOP of `requireCapability`, never instead of it. The capability
 * asks whether the creator may do this at all; the scope asks whether they
 * delegated it to this particular key. A route carrying only one of the two is
 * a route where either the creator's role or the key's narrowing is doing no
 * work.
 */
export function requireScope(scope: ApiKeyScope) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const granted = c.get("apiKeyScopes") ?? [];
    if (!apiKeyAllows(granted, scope)) {
      return errorResponse(
        c,
        "forbidden",
        `This API key does not have the \`${scope}\` scope.`,
      );
    }
    await next();
  });
}
