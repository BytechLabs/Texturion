import type { Ctx } from "../context";
import { MAILBOX_SCENARIO, RESEND_PER_DAY } from "../limits";
import { Refusal } from "../refusal";
import { dayOf, giveBack, tryTake } from "../state/counters";
import { liveLease } from "../state/lease";
import { heartbeatFresh, mailHalted, readMailStatus, recordRobotSend } from "../state/mail";

/**
 * Resend (docs/RIG.md). Recipients are Resend's test addresses,
 * which never touch loonext.com's reputation, or the robot's own mailbox
 * during S34 while the edge's mail handler is provably alive. Nothing else:
 * a bounce or complaint pauses sending for the whole team, and production's
 * password resets go out through the same team.
 */
export const RESEND_ORIGIN = "https://api.resend.com";

const TEST_DOMAIN = "@resend.dev";

/**
 * One bare address from `addr` or `Name <addr>`, or null for anything that
 * could be read as more than one: a comma or semicolon list, a second `@`, or
 * an address outside the brackets. Only what this returns is sent.
 */
export function addressOf(item: string): string | null {
  const text = item.trim();
  if (/[,;]/.test(text) || (text.match(/@/g) ?? []).length !== 1) return null;
  const angle = /^[^<>@]*<([^<>]+)>$/.exec(text);
  if (!angle && /[<>]/.test(text)) return null;
  const address = (angle ? angle[1] : text).trim().toLowerCase();
  return /^[^\s@<>"()]+@[^\s@<>"()]+$/.test(address) ? address : null;
}

/** The bare addresses of a `to`, `cc` or `bcc` field, or null when any one is refused. */
function addresses(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of list) {
    const address = typeof item === "string" ? addressOf(item) : null;
    if (address === null) return null;
    out.push(address);
  }
  return out;
}

function isTestAddress(address: string): boolean {
  const at = address.lastIndexOf("@");
  return at > 0 && address.slice(at) === TEST_DOMAIN && !address.slice(0, at).includes("@");
}

/**
 * The `+tag` of an address at the robot mailbox (null for the bare address),
 * or undefined when the address is not the robot's. The edge reports arrivals
 * by tag, so the tag is what a send is confirmed by.
 */
export function robotTag(address: string, mailbox: string | null): string | null | undefined {
  if (!mailbox) return undefined;
  const [local, domain] = mailbox.split("@");
  const at = address.lastIndexOf("@");
  if (!local || !domain || at <= 0 || address.slice(at + 1) !== domain) return undefined;
  const box = address.slice(0, at);
  if (box === local) return null;
  const tag = box.startsWith(`${local}+`) ? box.slice(local.length + 1) : "";
  return /^[a-z0-9._-]+$/.test(tag) ? tag : undefined;
}

export async function handleResend(ctx: Ctx, request: Request, path: string): Promise<Response> {
  if (request.method !== "POST" || path !== "/emails") throw new Refusal("resend.path_refused");
  if (!ctx.config.resendKey) throw new Refusal("resend.key_missing");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw new Refusal("request.body_invalid");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Refusal("request.body_invalid");

  const recipients: string[] = [];
  const outgoing: Record<string, unknown> = { ...body };
  for (const field of ["to", "cc", "bcc"]) {
    const list = addresses(body[field]);
    if (list === null) throw new Refusal("resend.recipient_refused");
    recipients.push(...list);
    if (list.length > 0) outgoing[field] = list;
    else delete outgoing[field];
  }
  if (recipients.length === 0) throw new Refusal("resend.recipient_refused");

  const robot: (string | null)[] = [];
  for (const address of recipients) {
    const tag = robotTag(address, ctx.config.robotMailbox);
    if (tag !== undefined) robot.push(tag);
    else if (!isTestAddress(address)) throw new Refusal("resend.recipient_refused");
  }
  if (robot.length > 0) {
    const lease = await liveLease(ctx);
    if (!lease || lease.scenario !== MAILBOX_SCENARIO) throw new Refusal("resend.robot_needs_lease");
    const status = await readMailStatus(ctx);
    if (await mailHalted(ctx, status)) throw new Refusal("resend.robot_mail_halted");
    if (!heartbeatFresh(status, ctx.now())) throw new Refusal("resend.mail_heartbeat_stale");
  }

  const day = dayOf(ctx.now());
  if (!(await tryTake(ctx, "resend", day, 1, RESEND_PER_DAY))) throw new Refusal("budget.resend_day");

  const idempotency = request.headers.get("idempotency-key");
  const response = await ctx.fetch(`${RESEND_ORIGIN}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.config.resendKey}`,
      "content-type": "application/json",
      ...(idempotency ? { "idempotency-key": idempotency } : {}),
    },
    body: JSON.stringify(outgoing),
  });
  const text = await response.text();
  if (response.status >= 400 && response.status <= 499) await giveBack(ctx, "resend", day, 1);
  if (response.ok) for (const tag of robot) await recordRobotSend(ctx, tag);
  return new Response(text || null, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
