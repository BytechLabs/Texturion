import type { Ctx } from "../context";
import type { PartitionView } from "./partition";

/** E.164 as Telnyx writes it. Anything else is not an owned number. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(value: unknown): value is string {
  return typeof value === "string" && E164.test(value);
}

export function isOwnedNumber(view: PartitionView, value: unknown): boolean {
  return isE164(value) && view.byE164.has(value);
}

/**
 * The username of a `sip:<user>@sip.telnyx.com` target, or null. Internal SIP
 * calling reaches only Telnyx's own domain, and only that form is a credential
 * on this account; any other host is a call off the account.
 */
export function sipUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const found = /^sip:([A-Za-z0-9._-]{1,128})@sip\.telnyx\.com$/i.exec(value);
  return found ? found[1] : null;
}

/** A telephony credential the guard has seen created, or looked up. */
export interface CredentialRecord {
  id: string;
  connection_id: string;
  sip_username: string | null;
  created_at: number;
  deleted_at?: number;
}

export const CREDENTIAL_PREFIX = "cred:";
const SIP_PREFIX = "sip:";

export async function rememberCredential(ctx: Ctx, record: CredentialRecord): Promise<void> {
  await ctx.store.put(`${CREDENTIAL_PREFIX}${record.id}`, record);
  if (record.sip_username) await ctx.store.put(`${SIP_PREFIX}${record.sip_username}`, record.id);
}

/** `connection:<id>` is Telnyx's documented form; a bare id is accepted too. */
export function connectionOfResource(resourceId: unknown): string | null {
  if (typeof resourceId !== "string" || resourceId === "") return null;
  return resourceId.startsWith("connection:") ? resourceId.slice("connection:".length) : resourceId;
}

/** The credential by id, from what the guard recorded or from Telnyx. */
export async function credentialById(ctx: Ctx, id: string): Promise<CredentialRecord | null> {
  const known = await ctx.store.get<CredentialRecord>(`${CREDENTIAL_PREFIX}${id}`);
  if (known) return known;
  if (!ctx.telnyx) return null;
  const reply = await ctx.telnyx.send("GET", `/v2/telephony_credentials/${encodeURIComponent(id)}`);
  const data = (reply.body as { data?: Record<string, unknown> } | undefined)?.data;
  if (reply.status !== 200 || !data || data.id !== id) return null;
  const connection = connectionOfResource(data.resource_id);
  if (!connection) return null;
  const record: CredentialRecord = {
    id,
    connection_id: connection,
    sip_username: typeof data.sip_username === "string" ? data.sip_username : null,
    created_at: ctx.now(),
  };
  await rememberCredential(ctx, record);
  return record;
}

/** The connection a SIP username's credential belongs to, or null. */
export async function connectionOfSipUser(ctx: Ctx, username: string): Promise<string | null> {
  const id = await ctx.store.get<string>(`${SIP_PREFIX}${username}`);
  if (id) {
    const record = await ctx.store.get<CredentialRecord>(`${CREDENTIAL_PREFIX}${id}`);
    if (record && !record.deleted_at) return record.connection_id;
  }
  if (!ctx.telnyx) return null;
  const query = new URLSearchParams({ "filter[sip_username]": username });
  const reply = await ctx.telnyx.send("GET", `/v2/telephony_credentials?${query.toString()}`);
  const items = (reply.body as { data?: Record<string, unknown>[] } | undefined)?.data;
  if (reply.status !== 200 || !Array.isArray(items)) return null;
  const match = items.find((item) => item.sip_username === username && typeof item.id === "string");
  const connection = match ? connectionOfResource(match.resource_id) : null;
  if (!match || !connection) return null;
  await rememberCredential(ctx, {
    id: match.id as string,
    connection_id: connection,
    sip_username: username,
    created_at: ctx.now(),
  });
  return connection;
}

/**
 * True when `to` is an owned number, or a SIP username whose credential is on
 * `nonprod-webrtc`. Never the sentinel: G02 tests that nothing can ring it.
 */
export async function isAllowedCallTarget(ctx: Ctx, view: PartitionView, to: unknown): Promise<boolean> {
  if (isOwnedNumber(view, to)) return true;
  const username = sipUsername(to);
  if (!username) return false;
  const webrtc = view.record.connections.webrtc;
  if (!webrtc) return false;
  return (await connectionOfSipUser(ctx, username)) === webrtc;
}
