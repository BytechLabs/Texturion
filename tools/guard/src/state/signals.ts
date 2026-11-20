import type { HaltRequest } from "@loonext/rig-protocol";

import type { Ctx } from "../context";
import { SIGNAL_REPEAT_WINDOW_MS } from "../limits";
import { sendProductionEvent } from "../posthog";

export type SignalSource = HaltRequest["corroborated_by"] | "guard";

export interface SignalInput {
  signal: string;
  notice_id: string | null;
  corroborated_by: SignalSource;
  late?: boolean;
}

interface SignalEvent {
  signal: string;
  notice_id: string | null;
  corroborated_by: SignalSource;
  at: number;
  late?: true;
}

interface SignalState {
  events: SignalEvent[];
}

const KEY = "signals";

async function state(ctx: Ctx): Promise<SignalState> {
  return (await ctx.store.get<SignalState>(KEY)) ?? { events: [] };
}

export async function recordSignal(ctx: Ctx, halt: SignalInput): Promise<SignalState> {
  const now = ctx.now();
  const current = await state(ctx);
  // The edge retries a halt it could not confirm; the same notice is one signal.
  if (halt.notice_id && current.events.some((event) => event.notice_id === halt.notice_id)) return current;
  const next: SignalState = {
    events: [
      ...current.events.filter((event) => now - event.at < SIGNAL_REPEAT_WINDOW_MS),
      {
        signal: halt.signal,
        notice_id: halt.notice_id,
        corroborated_by: halt.corroborated_by,
        at: now,
        ...(halt.late ? { late: true as const } : {}),
      },
    ],
  };
  await ctx.store.put(KEY, next);

  await sendProductionEvent(ctx, {
    key: "telnyx-account-signal",
    summary: `Telnyx account signal: ${halt.signal.slice(0, 120)}`,
    detail: `Corroborated by ${halt.corroborated_by}.`,
    level: "error",
  });
  return next;
}

export async function signalSummary(ctx: Ctx): Promise<{ recorded: number }> {
  return { recorded: (await state(ctx)).events.length };
}
