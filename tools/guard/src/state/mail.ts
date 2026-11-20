import type { MailStatus } from "@loonext/rig-protocol";

import type { Ctx } from "../context";
import { MAIL_HEARTBEAT_FRESH_MS } from "../limits";

/** The edge's mailbox status, or null when the edge cannot say. */
export async function readMailStatus(ctx: Ctx): Promise<MailStatus | null> {
  if (!ctx.edge) return null;
  try {
    return await ctx.edge.mailStatus();
  } catch (error) {
    console.error("guard: edge mailStatus failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function heartbeatFresh(status: MailStatus | null, now: number): boolean {
  const at = status?.heartbeat_at ? Date.parse(status.heartbeat_at) : Number.NaN;
  return Number.isFinite(at) && now - at <= MAIL_HEARTBEAT_FRESH_MS;
}

export async function mailSummary(ctx: Ctx): Promise<{ heartbeat_fresh: boolean }> {
  return { heartbeat_fresh: heartbeatFresh(await readMailStatus(ctx), ctx.now()) };
}
