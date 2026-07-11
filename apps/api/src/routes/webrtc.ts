/**
 * D43 (#135) phase 1 — the browser softphone's identity plumbing.
 *
 *   POST /v1/webrtc/token   M — mint a short-lived login token for the
 *   member's Telnyx telephony credential (find-or-create, one durable
 *   credential per membership on the shared TELNYX_WEBRTC_CONNECTION_ID;
 *   stable sip_username = the member's future inbound ring target). The
 *   token is a Telnyx-issued JWT valid ≤24h; the web client logs the
 *   @telnyx/webrtc SDK in with it and re-requests on expiry. Gates: active
 *   membership + LIVE subscription (calling is included on every plan, D42,
 *   but a canceled workspace must not register softphones). Rate-limited
 *   per member (token minting is free but unbounded minting is abuse
 *   surface).
 *
 * Revocation: deleting the Telnyx credential kills the member's voice
 * access immediately — the team deactivation path calls
 * {@link revokeMemberTelephonyCredential}.
 */
import { Hono } from "hono";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { errorResponse } from "../http/errors";
import { telnyxRequest } from "../telnyx/client";
import { unwrap } from "./core/http";

interface CredentialRow {
  telnyx_credential_id: string;
  sip_username: string;
}

export const webrtcRoutes = new Hono<AppEnv>();

webrtcRoutes.post("/webrtc/token", requireRole("member"), async (c) => {
  const env = getEnv(c.env);
  if (!env.TELNYX_WEBRTC_CONNECTION_ID) {
    return errorResponse(
      c,
      "conflict",
      "Browser calling isn't configured in this environment.",
    );
  }
  const db = getDb(env);
  const companyId = c.get("companyId");
  const userId = c.get("userId");

  if (env.VERIFY_RATE_LIMITER) {
    const { success } = await env.VERIFY_RATE_LIMITER.limit({
      key: `webrtc-token:${companyId}:${userId}`,
    });
    if (!success) {
      return errorResponse(
        c,
        "rate_limited",
        "Too many token requests. Wait a minute and try again.",
      );
    }
  }

  // Live subscription only — a canceled workspace must not keep registered
  // softphones (mirrors the POST /v1/calls gate).
  const companies = unwrap<{ subscription_status: string }[]>(
    await db
      .from("companies")
      .select("subscription_status")
      .eq("id", companyId)
      .limit(1),
    "company lookup",
  );
  if (companies[0]?.subscription_status !== "active") {
    return errorResponse(
      c,
      "subscription_inactive",
      "Your subscription isn't active.",
    );
  }

  // Find-or-create the member's durable credential. The upsert is
  // ignoreDuplicates so a concurrent first-token race converges on ONE
  // credential row (the loser's freshly-minted Telnyx credential is deleted
  // best-effort — orphaned credentials cost nothing but hygiene matters).
  const existing = unwrap<CredentialRow[]>(
    await db
      .from("member_telephony_credentials")
      .select("telnyx_credential_id,sip_username")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1),
    "credential lookup",
  );
  let credential = existing[0];

  if (!credential) {
    const created = await telnyxRequest<{
      data?: { id?: string; sip_username?: string };
    }>(env, {
      method: "POST",
      path: "/v2/telephony_credentials",
      body: {
        connection_id: env.TELNYX_WEBRTC_CONNECTION_ID,
        name: `${companyId}:${userId}`,
        tag: companyId,
      },
    });
    const telnyxId = created.data?.id;
    const sipUsername = created.data?.sip_username;
    if (!telnyxId || !sipUsername) {
      throw new Error("telephony credential create returned no id/username");
    }

    const inserted = unwrap<CredentialRow[]>(
      await db
        .from("member_telephony_credentials")
        .upsert(
          {
            company_id: companyId,
            user_id: userId,
            telnyx_credential_id: telnyxId,
            sip_username: sipUsername,
          },
          { onConflict: "company_id,user_id", ignoreDuplicates: true },
        )
        .select("telnyx_credential_id,sip_username"),
      "credential insert",
    );
    if (inserted.length > 0) {
      credential = inserted[0];
    } else {
      // Lost the race — another request created the row first. Use theirs,
      // delete ours (best-effort).
      const winner = unwrap<CredentialRow[]>(
        await db
          .from("member_telephony_credentials")
          .select("telnyx_credential_id,sip_username")
          .eq("company_id", companyId)
          .eq("user_id", userId)
          .limit(1),
        "credential re-read",
      );
      credential = winner[0];
      try {
        await telnyxRequest(env, {
          method: "DELETE",
          path: `/v2/telephony_credentials/${telnyxId}`,
        });
      } catch (cause) {
        console.error(
          `orphan credential cleanup failed for ${telnyxId}:`,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
      if (!credential) {
        throw new Error("credential race left no row");
      }
    }
  }

  // Telnyx returns the JWT as raw text (201 text/plain) — not JSON, so this
  // one call bypasses telnyxRequest's JSON parsing.
  const base = env.TELNYX_API_BASE ?? "https://api.telnyx.com";
  const tokenResponse = await fetch(
    `${base}/v2/telephony_credentials/${credential.telnyx_credential_id}/token`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` },
    },
  );
  if (!tokenResponse.ok) {
    throw new Error(
      `telephony credential token mint failed: ${tokenResponse.status}`,
    );
  }
  const token = (await tokenResponse.text()).trim();

  return c.json({
    token,
    sip_username: credential.sip_username,
    // Telnyx JWTs live ≤24h (bounded by the credential); the client
    // re-requests on SDK auth failure rather than tracking this exactly.
    expires_in_hours: 24,
  });
});

/**
 * Revoke a deactivated member's softphone access: delete the Telnyx
 * credential (kills registrations + tokens immediately) and the row.
 * Best-effort — deactivation must never fail on Telnyx weather; an orphaned
 * credential can be re-deleted by hand and costs nothing meanwhile.
 */
export async function revokeMemberTelephonyCredential(
  env: Env,
  companyId: string,
  userId: string,
): Promise<void> {
  const db = getDb(env);
  const rows = unwrap<{ telnyx_credential_id: string }[]>(
    await db
      .from("member_telephony_credentials")
      .select("telnyx_credential_id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1),
    "credential lookup",
  );
  const credentialId = rows[0]?.telnyx_credential_id;
  if (!credentialId) return;
  try {
    await telnyxRequest(env, {
      method: "DELETE",
      path: `/v2/telephony_credentials/${credentialId}`,
    });
  } catch (cause) {
    console.error(
      `telephony credential revoke failed for ${credentialId}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  const { error } = await db
    .from("member_telephony_credentials")
    .delete()
    .eq("company_id", companyId)
    .eq("user_id", userId);
  if (error) {
    throw new Error(`credential row delete failed: ${error.message}`);
  }
}
