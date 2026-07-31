/**
 * #314 — the second factor, and the recovery that makes it safe to turn on.
 *
 *   GET  /v1/mfa                    any  what is enrolled, how many recovery
 *                                        codes are left, and this token's
 *                                        assurance level
 *   POST /v1/mfa/recovery-codes     any  issue a fresh set. Plaintext is
 *                                        returned ONCE and never again.
 *   POST /v1/mfa/recover            any  burn a code and remove the factor
 *   PUT  /v1/company/mfa            O    require MFA for the workspace
 *
 * ENROLMENT IS NOT HERE, and that is the D8 boundary rather than an omission:
 * the client calls `supabase.auth.mfa.enroll/challenge/verify` against GoTrue
 * directly, exactly as it calls `signInWithPassword`. The Worker never brokers
 * login. What GoTrue does not give us — recovery codes, a workspace policy,
 * and a brute-force floor on recovery — is what this file is.
 *
 * The first three are BEARER-ONLY on purpose. A member who is being told to
 * enrol has to be able to reach the thing that fixes it, and a member locked
 * out of every workspace still owns their account.
 */
import { Hono } from "hono";
import { z } from "zod";

import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { sendEmail } from "../email/resend";
import { renderEmailHtml } from "../email/html";
import { getEnv, type Env } from "../env";
import { errorResponse } from "../http/errors";
import { parseJsonBody } from "./core/http";

export const mfaRoutes = new Hono<AppEnv>();

/**
 * Ten codes, each 10 characters of Crockford-ish base32.
 *
 * Ten because the failure this guards is a person working through a printout
 * in a panic, not an attacker — and because a set small enough to write on one
 * card is a set somebody will actually keep. 50 bits each: unguessable on its
 * own, and the endpoint locks after ten wrong tries regardless.
 */
const CODE_COUNT = 10;
const CODE_LENGTH = 10;
/** No I, L, O, U — a code read aloud off a phone screen must not be ambiguous. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateCodes(): string[] {
  const bytes = new Uint8Array(CODE_COUNT * CODE_LENGTH);
  crypto.getRandomValues(bytes);
  const codes: string[] = [];
  for (let i = 0; i < CODE_COUNT; i += 1) {
    let code = "";
    for (let j = 0; j < CODE_LENGTH; j += 1) {
      // Rejection-free modulo is fine here: 256 % 32 === 0, so the mapping is
      // uniform with no bias to correct for.
      code += ALPHABET[bytes[i * CODE_LENGTH + j] % ALPHABET.length];
    }
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

/** Normalised before hashing so case and the dash never decide a match. */
function normalise(code: string): string {
  return code.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

async function hash(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalise(code)),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface FactorRow {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string | null;
  created_at?: string;
}

mfaRoutes.get("/mfa", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const userId = c.get("userId");

  const { data, error } = await db.auth.admin.mfa.listFactors({ userId });
  if (error) throw new Error(`mfa listFactors failed: ${error.message}`);
  const factors = ((data?.factors ?? []) as FactorRow[]).filter(
    (factor) => factor.status === "verified",
  );

  const { data: remaining, error: countError } = await db.rpc(
    "api_mfa_recovery_remaining",
    { p_user_id: userId },
  );
  if (countError) {
    throw new Error(`recovery code count failed: ${countError.message}`);
  }

  return c.json({
    factors: factors.map((factor) => ({
      id: factor.id,
      type: factor.factor_type,
      name: factor.friendly_name ?? null,
      created_at: factor.created_at ?? null,
    })),
    enrolled: factors.length > 0,
    recovery_codes_remaining: Number(remaining ?? 0),
    /** This token's assurance level, so a client knows whether to re-challenge. */
    aal: c.get("aal"),
  });
});

mfaRoutes.post("/mfa/recovery-codes", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const userId = c.get("userId");

  // Only for somebody who has actually enrolled. Codes without a factor are
  // not recovery, they are a second password with a worse UI.
  const { data, error } = await db.auth.admin.mfa.listFactors({ userId });
  if (error) throw new Error(`mfa listFactors failed: ${error.message}`);
  const verified = ((data?.factors ?? []) as FactorRow[]).some(
    (factor) => factor.status === "verified",
  );
  if (!verified) {
    return errorResponse(
      c,
      "conflict",
      "Set up an authenticator app first — recovery codes are for getting back in past it.",
    );
  }

  const codes = generateCodes();
  const hashes = await Promise.all(codes.map(hash));
  const { error: storeError } = await db.rpc("api_mfa_set_recovery_codes", {
    p_user_id: userId,
    p_hashes: hashes,
  });
  if (storeError) {
    throw new Error(`recovery code store failed: ${storeError.message}`);
  }

  // Issuing a new set silently invalidates the old one, so the person is told
  // in the same breath — a printout they still trust is worse than none.
  await notifyAccount(env, db, userId, {
    subject: "New recovery codes for your account",
    body:
      "A fresh set of recovery codes was just issued for your account. Any " +
      "codes you had written down before this no longer work.\n\n" +
      "If this was not you, somebody has access to your account right now: " +
      "change your password and sign your other devices out.\n\n" +
      `${env.APP_ORIGIN}/settings/devices`,
  });

  // The ONLY time the plaintext exists outside the person's hands.
  return c.json({ codes });
});

const recoverSchema = z.object({ code: z.string().min(4).max(64) });

mfaRoutes.post("/mfa/recover", async (c) => {
  const body = await parseJsonBody(c, recoverSchema);
  const env = getEnv(c.env);
  const db = getDb(env);
  const userId = c.get("userId");

  const { data, error } = await db.rpc("api_mfa_consume_recovery_code", {
    p_user_id: userId,
    p_hash: await hash(body.code),
  });
  if (error) throw new Error(`recovery code consume failed: ${error.message}`);
  const result = data as { outcome: string; remaining?: number };

  if (result.outcome === "locked") {
    return errorResponse(
      c,
      "rate_limited",
      "Too many wrong codes. Try again in an hour.",
    );
  }
  if (result.outcome !== "ok") {
    // Deliberately identical whether the code is wrong or already spent:
    // telling the difference would let somebody enumerate which codes exist.
    return errorResponse(c, "forbidden", "That code is not valid.");
  }

  // The code buys REMOVAL of the factor, never elevation of this session.
  //
  // That distinction is the whole safety of the mechanism: a recovery code
  // that granted aal2 would turn a stolen password plus a stolen printout
  // into a silent full bypass. Removing the factor is loud — the person is
  // emailed, and their next sign-in is password-only until they enrol again.
  const { data: factorData, error: listError } =
    await db.auth.admin.mfa.listFactors({ userId });
  if (listError) throw new Error(`mfa listFactors failed: ${listError.message}`);
  let removed = 0;
  for (const factor of (factorData?.factors ?? []) as FactorRow[]) {
    const { error: deleteError } = await db.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId,
    });
    if (deleteError) {
      throw new Error(`mfa deleteFactor failed: ${deleteError.message}`);
    }
    removed += 1;
  }

  await notifyAccount(env, db, userId, {
    subject: "Two-factor authentication was removed from your account",
    body:
      "Somebody used a recovery code to remove two-factor authentication " +
      "from your account. Signing in now needs only your password.\n\n" +
      "If this was you, set it up again as soon as you can.\n\n" +
      "IF IT WAS NOT: change your password immediately and sign every other " +
      "device out.\n\n" +
      `${env.APP_ORIGIN}/settings/account`,
  });

  return c.json({
    removed_factors: removed,
    recovery_codes_remaining: Number(result.remaining ?? 0),
  });
});

const companyMfaSchema = z.object({
  required: z.boolean(),
  /**
   * How long the crew has before it bites. Fixed at the moment it is switched
   * on and never moved by a later save.
   */
  grace_days: z.number().int().min(0).max(90).optional(),
});

mfaRoutes.put("/company/mfa", requireCapability("workspace.own"), async (c) => {
  const body = await parseJsonBody(c, companyMfaSchema);
  const companyId = c.get("companyId");
  const env = getEnv(c.env);
  const db = getDb(env);

  const { data, error } = await db.rpc("api_set_company_mfa", {
    p_company_id: companyId,
    p_actor: c.get("userId"),
    p_required: body.required,
    p_grace_days: body.grace_days ?? 14,
  });
  if (error) throw new Error(`api_set_company_mfa failed: ${error.message}`);
  const result = data as { outcome: string; grace_until?: string };

  if (result.outcome === "not_found") {
    return errorResponse(c, "not_found", "No such workspace.");
  }
  if (result.outcome === "forbidden") {
    return errorResponse(
      c,
      "forbidden",
      "Only the owner can require two-factor authentication.",
    );
  }

  await recordAuditFromRequest(db, c, {
    companyId,
    action: "settings.changed",
    targetType: "company",
    targetId: companyId,
    after: {
      mfa_required: body.required,
      mfa_grace_until: result.grace_until ?? null,
    },
  });

  return c.json({
    required: result.outcome === "on",
    grace_until: result.grace_until ?? null,
  });
});

/**
 * Every one of these is a message about somebody's own account security, so it
 * goes to them and nobody else — not the owner, not the workspace.
 *
 * Best-effort: the action has already happened by the time this runs, and a
 * Resend outage must not turn a completed recovery into a 500 that invites
 * somebody to burn a second code.
 */
async function notifyAccount(
  env: Env,
  db: ReturnType<typeof getDb>,
  userId: string,
  message: { subject: string; body: string },
): Promise<void> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    const to = data?.user?.email;
    if (!to) return;
    await sendEmail(env, {
      to,
      subject: message.subject,
      text: message.body,
      html: renderEmailHtml(message.body),
    });
  } catch (cause) {
    console.error(
      "mfa notification failed:",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
