import type { Ctx } from "../context";
import { BALANCE_CACHE_MS } from "../limits";
import { Refusal } from "../refusal";
import type { TelnyxReply } from "../telnyx/client";

interface BalanceReading {
  usd: number;
  read_at: number;
}

const KEY = "balance:reading";

/**
 * Telnyx itself refused the account's own read: how a disabled account
 * answers. The edge corroborates a notice by this, so the route passes it on
 * as Telnyx's answer rather than as a guard refusal.
 */
class AccountRefusedError extends Error {
  readonly reply: TelnyxReply;

  constructor(reply: TelnyxReply) {
    super(`Telnyx refused the balance read with ${reply.status}`);
    this.reply = reply;
    this.name = "AccountRefusedError";
  }
}

export { AccountRefusedError as AccountRefused };

/** The balance as a number, at most {@link BALANCE_CACHE_MS} old. */
export async function readBalance(ctx: Ctx, options: { fresh?: boolean } = {}): Promise<number> {
  const cached = await ctx.store.get<BalanceReading>(KEY);
  if (!options.fresh && cached && ctx.now() - cached.read_at < BALANCE_CACHE_MS) return cached.usd;
  if (!ctx.telnyx) throw new Refusal("telnyx.key_missing");
  const reply = await ctx.telnyx.send("GET", "/v2/balance");
  if (reply.status === 401 || reply.status === 403) throw new AccountRefusedError(reply);
  const raw = (reply.body as { data?: { balance?: unknown } } | undefined)?.data?.balance;
  const value = typeof raw === "number" ? raw : (typeof raw === "string" ? Number(raw) : Number.NaN);
  if (reply.status !== 200 || !Number.isFinite(value)) throw new AccountRefusedError(reply);

  await ctx.store.put(KEY, { usd: value, read_at: ctx.now() } satisfies BalanceReading);
  return value;
}
