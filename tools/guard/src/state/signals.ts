import type { HaltRequest } from "@loonext/rig-protocol";

import type { Ctx } from "../context";
import { SIGNAL_HALT_MS, SIGNAL_REPEAT_WINDOW_MS } from "../limits";
import { Refusal } from "../refusal";
import { sendProductionEvent } from "../posthog";

/**
 * Account signals (docs/RIG.md). Telnyx's notification channel posts to
 * the edge, the edge corroborates the notice, then sends it here as a
 * HaltRequest; the guard records its own when Telnyx refuses a dial for
 * concurrency or dial rate. Any one halts paid tests for 7 days; a second
 * inside 30 days keeps the paid lanes off until the design changes, which the
 * guard reads as a reviewed change to SIGNAL_LATCH_RESET.
 *
 * A fraud-type notice latches at once: Telnyx's hold is assumed to cover the
 * whole account, and lifting it takes an email to support, which the rig
 * never sends.
 */
export const FRAUD_SIGNALS: readonly string[] = [
  "Suspicious Outbound Voice Traffic",
  "Account Disabled",
  "Messaging Suspicious Traffic",
];

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
  halt_until?: number;
  latch?: { at: number; reset: string };
}

const KEY = "signals";

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Case and punctuation do not matter, and a longer name that contains one still counts. */
export function isFraudSignal(signal: string): boolean {
  const folded = fold(signal);
  return FRAUD_SIGNALS.some((name) => folded.includes(fold(name)));
}

async function state(ctx: Ctx): Promise<SignalState> {
  return (await ctx.store.get<SignalState>(KEY)) ?? { events: [] };
}

export async function recordSignal(ctx: Ctx, halt: SignalInput): Promise<SignalState> {
  const now = ctx.now();
  const current = await state(ctx);
  // The edge retries a halt it could not confirm; the same notice is one signal.
  if (halt.notice_id && current.events.some((event) => event.notice_id === halt.notice_id)) return current;
  const standingLatch =
    current.latch && current.latch.reset === ctx.config.signalLatchReset ? current.latch : undefined;
  // A latch the design change has cleared also clears the signals behind it.
  const clearedAt = current.latch && !standingLatch ? current.latch.at : -Infinity;
  const recent = current.events.filter(
    (event) => now - event.at < SIGNAL_REPEAT_WINDOW_MS && event.at > clearedAt,
  );
  const fraud = isFraudSignal(halt.signal);
  const next: SignalState = {
    events: [
      ...recent,
      {
        signal: halt.signal,
        notice_id: halt.notice_id,
        corroborated_by: halt.corroborated_by,
        at: now,
        ...(halt.late ? { late: true as const } : {}),
      },
    ],
    halt_until: Math.max(current.halt_until ?? 0, now + SIGNAL_HALT_MS),
    latch: standingLatch,
  };
  if ((fraud || recent.length >= 1) && !next.latch) next.latch = { at: now, reset: ctx.config.signalLatchReset };
  await ctx.store.put(KEY, next);

  const latchedWhy = fraud
    ? "A fraud-type notice, assumed to hold the whole account"
    : "A second signal inside 30 days";
  await sendProductionEvent(ctx, {
    key: "telnyx-account-signal",
    summary: `Telnyx account signal: ${halt.signal.slice(0, 120)}`,
    detail: next.latch
      ? `${latchedWhy}: the rig's paid lanes stay off until SIGNAL_LATCH_RESET changes in a reviewed commit.`
      : `Corroborated by ${halt.corroborated_by}. The rig's paid tests are halted until ${new Date(next.halt_until ?? now).toISOString()}.`,
    level: "error",
  });
  return next;
}

/** Throws when paid work is halted or latched off. */
export async function requirePaidLanesOpen(ctx: Ctx): Promise<void> {
  const current = await state(ctx);
  if (current.latch && current.latch.reset === ctx.config.signalLatchReset) throw new Refusal("signal.latched");
  if ((current.halt_until ?? 0) > ctx.now()) throw new Refusal("signal.halted");
}

export async function signalSummary(ctx: Ctx): Promise<{ halted_until: string | null; latched: boolean }> {
  const current = await state(ctx);
  const halted = (current.halt_until ?? 0) > ctx.now() ? new Date(current.halt_until as number).toISOString() : null;
  return {
    halted_until: halted,
    latched: Boolean(current.latch && current.latch.reset === ctx.config.signalLatchReset),
  };
}
