import type { getDb } from "../db";
import type { getEnv } from "../env";
import { telnyxRequest } from "../telnyx/client";

/**
 * Ending somebody's access — all of it, in one place.
 *
 * ## Why this is a module and not a helper inside a route
 *
 * There are four ways a person's access ends: they sign a device out, an owner signs
 * their devices out, they are removed from the workspace, or the workspace closes (and
 * a fifth, deleting the account, which runs entirely in SQL and is handled at the end
 * of this comment). Each one has to do the same three things — mark the sessions
 * revoked, drop the push registrations, and delete the member's softphone credential
 * AT TELNYX.
 *
 * The third one is the one that keeps getting missed, and it is the one that matters
 * most for the case the control exists for: a handset somebody else is holding. The
 * database row is what stops us handing that credential to a NEW registration; the
 * credential at Telnyx is what a phone that has already registered is still using. Delete
 * the row alone and the handset keeps ringing, and can answer a customer as the
 * business.
 *
 * `api_revoke_sessions` therefore returns the credential ids rather than a count, so
 * whoever called it can delete them at Telnyx and name any that survive. Three of the
 * four callers went through `api_revoke_user_sessions` instead — a thin wrapper that
 * returns `(result ->> 'sessions')::int` and throws the array away — so offboarding a
 * member, closing a workspace and deleting an account all left the credential alive at
 * Telnyx. One rule, four paths, three of them wrong; the fix is that there is now one
 * path.
 *
 * SQL cannot make an HTTP call, so `delete_account` returns the ids it deleted and its
 * route passes them to [releaseTelnyxCredentials] below. That is why the Telnyx half is
 * exported separately as well as being wired into [revokeSessions].
 */

export interface RevokeSessionsInput {
  userId: string;
  /** Specific sessions, or null for every one of theirs. */
  sessionIds: string[] | null;
  /** One session to spare — the browser somebody is doing this from. */
  except: string | null;
  /** Who did it, or null when nobody did (offboarding, closure). */
  actor: string | null;
  reason:
    | "self"
    | "sign_out_all"
    | "admin"
    | "member_removed"
    | "account_deleted";
}

export interface RevokeSessionsResult {
  sessions: number;
  devices: number;
  /** How many credentials Telnyx confirmed gone. Never more than were returned. */
  voice: number;
}

/**
 * Delete telephony credentials at Telnyx, one by one.
 *
 * Best-effort and LOUD. A Telnyx outage must not fail the thing that called this — by
 * the time we are here the sessions, push tokens and refresh tokens are already gone,
 * so the account is far better off than it was — but a credential we failed to delete
 * is a device that can still ring, so it is logged with its id rather than swallowed
 * into a count.
 */
export async function releaseTelnyxCredentials(
  env: ReturnType<typeof getEnv>,
  credentialIds: readonly string[],
  /** What was happening, so the log line says which path left it behind. */
  context: string,
): Promise<number> {
  let deleted = 0;
  for (const credentialId of credentialIds) {
    try {
      await telnyxRequest(env, {
        method: "DELETE",
        path: `/v2/telephony_credentials/${credentialId}`,
      });
      deleted += 1;
    } catch (cause) {
      console.error(
        `telephony credential ${credentialId} survived ${context} — that device ` +
          `can still ring and can answer as the business:`,
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
  return deleted;
}

/**
 * End sessions and everything that outlives them.
 *
 * Throws if the database call fails; the Telnyx half never throws (see above), so a
 * caller that must not fail can rely on this either doing the database work or telling
 * them it did not.
 */
export async function revokeSessions(
  db: ReturnType<typeof getDb>,
  env: ReturnType<typeof getEnv>,
  input: RevokeSessionsInput,
): Promise<RevokeSessionsResult> {
  const { data, error } = await db.rpc("api_revoke_sessions", {
    p_user_id: input.userId,
    p_session_ids: input.sessionIds,
    p_except: input.except,
    p_actor: input.actor,
    p_reason: input.reason,
  });
  if (error) throw new Error(`session revoke failed: ${error.message}`);
  const result = data as {
    sessions?: number;
    devices?: number;
    voice_credentials?: string[];
  };

  const voice = await releaseTelnyxCredentials(
    env,
    result?.voice_credentials ?? [],
    `a session revoke (${input.reason})`,
  );

  return {
    sessions: Number(result?.sessions ?? 0),
    devices: Number(result?.devices ?? 0),
    voice,
  };
}
