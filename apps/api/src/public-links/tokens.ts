/**
 * #335 / D75 — the shared primitive for a page a customer's customer can open.
 *
 * Four queued features need exactly this (#224 pay, #287 quotes, #245 calendar,
 * #232 widget) and building it four times means four token schemes and four
 * chances to get it wrong. Getting it wrong here is worse than elsewhere: THE
 * PERSON EXPOSED IS NOT OUR USER. A homeowner's address, phone number and job
 * details behind a guessable URL is a breach involving somebody who never
 * agreed to anything with us.
 *
 * ---------------------------------------------------------------------------
 * THE THREE RULES, and each has a specific failure it prevents.
 *
 *   1. 256 BITS, NOT A UUID. A v4 UUID carries 122 bits and a recognisable
 *      shape. These URLs live on the public internet, in SMS logs, in browser
 *      history, and inside third-party calendar servers. Guessing must be
 *      hopeless, not merely hard.
 *
 *   2. THE PLAINTEXT IS RETURNED ONCE AND NEVER STORED. Only its SHA-256 hash
 *      reaches the database, so a leaked backup, a log line, or a support
 *      screenshot discloses nothing usable. This is a password digest's
 *      reasoning applied to a URL, and it is what makes the access log safe to
 *      keep at all.
 *
 *   3. ONE TOKEN, ONE OBJECT, ONE PURPOSE. The purpose is stored and checked,
 *      never inferred from the route, so a token minted to VIEW a quote cannot
 *      be replayed against the route that ACCEPTS it. There is no query to
 *      widen and nothing to traverse: a token names its object.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Every purpose a link can carry. Mirrors the SQL CHECK exactly. */
export type PublicLinkPurpose =
  | "quote_view"
  | "quote_accept"
  | "payment"
  | "calendar_feed"
  | "photo_set"
  | "review";

/**
 * base64url of 32 random bytes — 256 bits, 43 characters, URL-safe.
 *
 * base64url rather than hex because the token rides in an SMS: hex would be 64
 * characters for the same entropy, and a link that wraps is a link a homeowner
 * mistrusts.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex. The only form of the token that is ever persisted. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface MintedLink {
  /** The plaintext. Returned ONCE — put it in the URL and forget it. */
  token: string;
  id: string;
  expiresAt: Date;
}

/**
 * Mint a link for exactly one object and one purpose.
 *
 * `expiresAt` is required by the signature and NOT NULL in the table. A link
 * with no expiry is the failure this whole primitive exists to prevent, and
 * making it representable would guarantee somebody creates one.
 */
export async function mintPublicLink(
  db: SupabaseClient,
  args: {
    companyId: string;
    purpose: PublicLinkPurpose;
    subjectType: string;
    subjectId: string;
    expiresAt: Date;
    /** Single-use, for a payment link that must die on payment. */
    maxUses?: number;
    actorUserId?: string | null;
  },
): Promise<MintedLink> {
  const token = generateToken();
  const { data, error } = await db.rpc("api_mint_public_link", {
    p_token_hash: await hashToken(token),
    p_company_id: args.companyId,
    p_purpose: args.purpose,
    p_subject_type: args.subjectType,
    p_subject_id: args.subjectId,
    p_expires_at: args.expiresAt.toISOString(),
    p_max_uses: args.maxUses ?? null,
    p_actor: args.actorUserId ?? null,
  });
  if (error) throw new Error(`mint public link failed: ${error.message}`);

  return { token, id: data as string, expiresAt: args.expiresAt };
}

/** Why a resolve failed. Never shown to the holder — see `resolvePublicLink`. */
export type ResolveOutcome =
  | "ok"
  | "not_found"
  | "expired"
  | "revoked"
  | "used_up"
  | "wrong_purpose";

export interface ResolvedLink {
  ok: boolean;
  outcome: ResolveOutcome;
  link_id?: string;
  company_id?: string;
  subject_type?: string;
  subject_id?: string;
  expires_at?: string;
}

/**
 * Resolve a token for a specific purpose, recording the attempt either way.
 *
 * The check and the logging are ONE round trip on purpose: a caller cannot
 * forget to record a miss, because the miss is the return value. A run of
 * misses is the only trace an enumeration attempt would ever leave — these
 * routes sit outside every gate that protects /v1.
 *
 * On any failure this resolves rather than throwing, and the caller must
 * render the SAME page for every failure. A holder who can tell "expired" from
 * "never existed" has been handed an oracle.
 */
export async function resolvePublicLink(
  db: SupabaseClient,
  token: string,
  purpose: PublicLinkPurpose,
  country: string | null = null,
): Promise<ResolvedLink> {
  // A token of the wrong shape never reaches the database. It cannot match
  // anything, and hashing arbitrary input to run a query is free work an
  // attacker controls the volume of.
  if (!token || token.length < 40 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, outcome: "not_found" };
  }

  const { data, error } = await db.rpc("api_resolve_public_link", {
    p_token_hash: await hashToken(token),
    p_purpose: purpose,
    p_country: country,
  });
  if (error) {
    // Fail CLOSED, unlike most reads in this codebase. Everywhere else an
    // unreachable database should degrade politely; here it must not hand out
    // access it could not verify.
    console.error(`public link resolve failed: ${error.message}`);
    return { ok: false, outcome: "not_found" };
  }
  return data as ResolvedLink;
}

/** Revoke one link — the payment that completed, the quote that was withdrawn. */
export async function revokePublicLink(
  db: SupabaseClient,
  linkId: string,
  reason?: string,
): Promise<void> {
  const { error } = await db.rpc("api_revoke_public_link", {
    p_link_id: linkId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(`revoke public link failed: ${error.message}`);
}

/**
 * Revoke every link to one object.
 *
 * The shape "this quote is withdrawn" needs, and the reason a rotatable ICS
 * feed (#245) is safe: it is long-lived by nature and pasted into third-party
 * servers, so individual revocation is the only control that fits it.
 */
export async function revokeLinksForSubject(
  db: SupabaseClient,
  subjectType: string,
  subjectId: string,
  reason?: string,
): Promise<number> {
  const { data, error } = await db.rpc("api_revoke_public_links_for_subject", {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(`revoke links for subject failed: ${error.message}`);
  return (data as number) ?? 0;
}
