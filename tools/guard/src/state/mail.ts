import type { MailStatus } from "@loonext/rig-protocol";

import type { Ctx } from "../context";
import { MAIL_ARRIVAL_DEADLINE_MS, MAIL_HEARTBEAT_FRESH_MS } from "../limits";

/**
 * The robot mailbox's state (docs/RIG.md). A bounce from that mailbox would
 * count against loonext.com's sending reputation, which production's
 * password resets share, so mail goes there only while the edge proves its
 * mail handler is alive, and stops for good the first time a sent mail fails
 * to arrive. The edge's EdgeForGuard.mailStatus() is the proof.
 */
interface MailState {
  /** Robot-mailbox sends, by `+tag`, not yet seen in the edge's recent mail. */
  pending: { tag: string | null; at: number }[];
  halted?: { at: number; tag: string | null };
}

const KEY = "mail";

async function state(ctx: Ctx): Promise<MailState> {
  return (await ctx.store.get<MailState>(KEY)) ?? { pending: [] };
}

/** The edge's mailbox status, or null when the edge cannot say. */
export async function readMailStatus(ctx: Ctx): Promise<MailStatus | null> {
  if (!ctx.edge) return null;
  try {
    return await ctx.edge.mailStatus();
  } catch (cause) {
    console.error("guard: edge mailStatus failed:", cause instanceof Error ? cause.message : String(cause));
    return null;
  }
}

export function heartbeatFresh(status: MailStatus | null, now: number): boolean {
  const at = status?.heartbeat_at ? Date.parse(status.heartbeat_at) : Number.NaN;
  return Number.isFinite(at) && now - at <= MAIL_HEARTBEAT_FRESH_MS;
}

/**
 * Clears every pending send the edge has since seen arrive, then halts the
 * mailbox if one is past its deadline. Returns whether it is halted.
 */
export async function mailHalted(ctx: Ctx, status: MailStatus | null): Promise<boolean> {
  const current = await state(ctx);
  if (current.halted) return true;
  const arrivals = (status?.recent ?? []).map((mail) => ({ tag: mail.tag, at: Date.parse(mail.received_at) }));
  const pending = current.pending.filter(
    (send) => !arrivals.some((mail) => mail.tag === send.tag && mail.at >= send.at),
  );
  const late = pending.find((send) => ctx.now() - send.at > MAIL_ARRIVAL_DEADLINE_MS);
  const next: MailState = late ? { pending, halted: { at: ctx.now(), tag: late.tag } } : { pending };
  if (late || pending.length !== current.pending.length) await ctx.store.put(KEY, next);
  return Boolean(late);
}

export async function recordRobotSend(ctx: Ctx, tag: string | null): Promise<void> {
  const current = await state(ctx);
  await ctx.store.put(KEY, { ...current, pending: [...current.pending, { tag, at: ctx.now() }] });
}

/** Lifts a halt; an operator decision filed through /admin. */
export async function resumeMail(ctx: Ctx): Promise<void> {
  await ctx.store.put(KEY, { pending: [] } satisfies MailState);
}

export async function mailSummary(ctx: Ctx): Promise<{ heartbeat_fresh: boolean; halted: boolean; pending: number }> {
  const status = await readMailStatus(ctx);
  const halted = await mailHalted(ctx, status);
  return {
    heartbeat_fresh: heartbeatFresh(status, ctx.now()),
    halted,
    pending: (await state(ctx)).pending.length,
  };
}
