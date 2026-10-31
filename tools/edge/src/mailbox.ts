import { DurableObject } from "cloudflare:workers";
import type { MailStatus } from "@loonext/rig-protocol";

import { mailbox, uplink, type Env } from "./env";

/**
 * The robot's mailbox, for test S34.
 *
 * Mail arrives through an Email Routing address on loonext.com, so a bounce
 * from here is a bounce on production's sending domain, and enough of them
 * pause Resend for the whole team, password resets included. So the handler
 * never rejects: whatever goes wrong, the message is accepted and counted.
 *
 * Only mail to the robot's address or a `+tag` of it, with an envelope sender
 * on loonext.com or a subdomain (Resend's return path), is stored and
 * delivered. Anything else is a stranger's, counted only, so a stranger's
 * words cannot reach an agent through the mailbox.
 */

const MAIL_RAW_MAX = 512 * 1024;
const MAIL_KEEP = 200;
const MAIL_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT = 20;
const SENDER_DOMAIN = "loonext.com";

export interface StoredMail {
  id: string;
  to: string;
  tag: string | null;
  from: string;
  subject: string;
  raw: string;
  truncated: boolean;
  receivedAt: number;
}

export class RobotMailbox extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS mail (id TEXT PRIMARY KEY, recipient TEXT NOT NULL, tag TEXT, sender TEXT NOT NULL, subject TEXT NOT NULL, raw TEXT NOT NULL, truncated INTEGER NOT NULL, received_at INTEGER NOT NULL)",
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)");
  }

  async store(mail: StoredMail): Promise<void> {
    this.sql.exec(
      "INSERT OR REPLACE INTO mail (id, recipient, tag, sender, subject, raw, truncated, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      mail.id,
      mail.to,
      mail.tag,
      mail.from,
      mail.subject,
      mail.raw,
      mail.truncated ? 1 : 0,
      mail.receivedAt,
    );
    this.bump("stored");
    this.set("last_received_at", mail.receivedAt);
    this.set("heartbeat_at", mail.receivedAt);
    this.sql.exec("DELETE FROM mail WHERE received_at <= ?", mail.receivedAt - MAIL_KEEP_MS);
    this.sql.exec(
      "DELETE FROM mail WHERE id NOT IN (SELECT id FROM mail ORDER BY received_at DESC LIMIT ?)",
      MAIL_KEEP,
    );
  }

  async received(): Promise<void> {
    this.bump("received");
  }

  /** Proves the store still writes and reads; the cron's mail heartbeat. */
  async selfTest(now: number): Promise<boolean> {
    this.set("heartbeat_at", now);
    return this.get("heartbeat_at") === now;
  }

  async status(storeFailed: number): Promise<MailStatus> {
    const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
    return {
      heartbeat_at: iso(this.get("heartbeat_at")),
      last_received_at: iso(this.get("last_received_at")),
      received: this.get("received") ?? 0,
      stored: this.get("stored") ?? 0,
      store_failed: storeFailed,
      recent: this.sql
        .exec<{ tag: string | null; received_at: number }>(
          "SELECT tag, received_at FROM mail ORDER BY received_at DESC LIMIT ?",
          RECENT,
        )
        .toArray()
        .map((row) => ({ tag: row.tag, received_at: new Date(row.received_at).toISOString() })),
    };
  }

  private get(key: string): number | null {
    const row = this.sql.exec<{ value: number }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row ? Number(row.value) : null;
  }

  private set(key: string, value: number): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  private bump(key: string): void {
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1",
      key,
    );
  }
}

/**
 * The `+tag` of an address to the robot, `""` for the bare address, or null
 * when the address is not the robot's at all.
 */
export function robotTag(to: string, robotAddress: string | undefined): string | null {
  const robot = robotAddress?.trim().toLowerCase();
  const at = robot?.lastIndexOf("@") ?? -1;
  if (!robot || at <= 0) return null;
  const [local, domain] = [robot.slice(0, at), robot.slice(at + 1)];
  const address = to.trim().toLowerCase();
  const split = address.lastIndexOf("@");
  if (split <= 0 || address.slice(split + 1) !== domain) return null;
  const toLocal = address.slice(0, split);
  if (toLocal === local) return "";
  return toLocal.startsWith(`${local}+`) && toLocal.length > local.length + 1
    ? toLocal.slice(local.length + 1)
    : null;
}

/** True for an envelope sender on loonext.com or a subdomain of it. */
export function fromOurDomain(from: string): boolean {
  const domain = from.trim().toLowerCase().split("@").pop() ?? "";
  return domain === SENDER_DOMAIN || domain.endsWith(`.${SENDER_DOMAIN}`);
}

async function readRaw(message: ForwardableEmailMessage): Promise<{ raw: string; truncated: boolean }> {
  const bytes = new Uint8Array(await new Response(message.raw).arrayBuffer());
  return {
    raw: new TextDecoder().decode(bytes.subarray(0, MAIL_RAW_MAX)),
    truncated: bytes.byteLength > MAIL_RAW_MAX,
  };
}

/** The mailbox's heartbeat and counts, with store failures the uplink counted. */
export async function mailStatus(env: Env): Promise<MailStatus> {
  const counters = (await uplink(env).snapshot()).counters;
  return mailbox(env).status(counters["mail.store_failed"] ?? 0);
}

async function countOnUplink(env: Env, name: string): Promise<void> {
  try {
    await uplink(env).bump(name);
  } catch (cause) {
    console.error(`mail: could not count ${name}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/**
 * The email() handler. It never calls `setReject` and never throws: each step
 * that can fail is caught on its own, so a storage fault still delivers, and a
 * delivery fault still stores.
 */
export async function receiveMail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const receivedAt = Date.now();
  try {
    await mailbox(env).received();
  } catch {
    await countOnUplink(env, "mail.count_failed");
  }

  const tag = robotTag(message.to, env.ROBOT_MAIL_ADDRESS);
  if (tag === null || !fromOurDomain(message.from)) {
    await countOnUplink(env, tag === null ? "mail.misaddressed" : "mail.stranger");
    return;
  }

  let content = { raw: "", truncated: false };
  try {
    content = await readRaw(message);
  } catch {
    await countOnUplink(env, "mail.read_failed");
  }
  const mail: StoredMail = {
    id: crypto.randomUUID(),
    to: message.to,
    tag: tag === "" ? null : tag,
    from: message.from,
    subject: message.headers.get("subject") ?? "",
    raw: content.raw,
    truncated: content.truncated,
    receivedAt,
  };

  try {
    await mailbox(env).store(mail);
  } catch (cause) {
    console.error(`mail: store failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    await countOnUplink(env, "mail.store_failed");
  }

  const messageId = message.headers.get("message-id");
  try {
    await uplink(env).enqueueMail({
      dedupeKey: `mail:${messageId ?? mail.id}`,
      to: mail.to,
      from: mail.from,
      subject: mail.subject,
      raw: mail.raw,
    });
  } catch (cause) {
    console.error(`mail: queue failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    await countOnUplink(env, "mail.queue_failed");
  }
}
