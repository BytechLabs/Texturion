import {
  GUARD_ROUTES,
  HALT_CORROBORATIONS,
  HEADER,
  type GuardHealth,
  type GuardSafety,
  type HaltCorroboration,
  type HaltRequest,
  type LegRegistration,
} from "@loonext/rig-protocol";

import { handleAdmin } from "./admin";
import { parseCaller, ROUTE_CALLERS, routeOf, type GuardCaller } from "./caller";
import type { Ctx } from "./context";
import { runKeyInventory } from "./inventory";
import { PREEMPT_POLL_MS } from "./limits";
import { json, refuse, Refusal } from "./refusal";
import { requireSafe, SAFETY_KEY, type SafetyState } from "./setup/safety";
import {
  ADMISSION_KEYS,
  inWindow,
  productionCalls,
  ratioRule,
  roomFor,
  windowInForce,
  type ProductionCalls,
  type RatiosRecord,
  type ReserveRecord,
  type WindowRecord,
} from "./state/admission";
import { balanceAboveFloor, balanceFloor, readBalance } from "./state/balance";
import { readTier } from "./state/ledger";
import { candidateLiveLegs, markEnded, pruneLegs, registerLeg } from "./state/legs";
import { acquireLease, liveLease, markPreempted, releaseLease, toGrant } from "./state/lease";
import { mailHalted, mailSummary, readMailStatus } from "./state/mail";
import { recordSignal, signalSummary } from "./state/signals";
import { detachFlooded, enforceCap } from "./telnyx/detach";
import { orderingBlockers, verifyFirstOrder } from "./telnyx/ordering";
import { loadPartition, toWire, type PartitionView } from "./telnyx/partition";
import { handleTelnyx } from "./telnyx/route";
import { aiNeuronsToday, handleAi } from "./vendors/ai";
import { handleDiag } from "./vendors/diag";
import { handleFcm, handleFcmToken } from "./vendors/fcm";
import { handleResend } from "./vendors/resend";

/**
 * The guard (docs/RIG.md). One instance, in one Durable Object,
 * so every count, lease and ledger entry is decided in one place.
 */
export const CRONS = {
  keyInventory: "0 6 * * 1",
  upkeep: "7 * * * *",
} as const;

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Falls through.
  }
  throw new Refusal("request.body_invalid");
}

/** Refuses when the start-up checks last ran and found the partition unsafe. */
async function refuseIfKnownUnsafe(ctx: Ctx): Promise<void> {
  const safety = await ctx.store.get<SafetyState>(SAFETY_KEY);
  if (safety?.state === "unsafe") throw new Refusal("startup.unsafe");
}

export class Guard {
  constructor(readonly ctx: Ctx) {}

  async handle(request: Request): Promise<Response> {
    try {
      return await this.route(request);
    } catch (cause) {
      if (cause instanceof Refusal) {
        console.log(`guard: refused ${request.method} ${new URL(request.url).pathname.split("/")[1]}: ${cause.rule}`);
        return refuse(cause.rule);
      }
      console.error("guard: request failed:", cause instanceof Error ? cause.message : String(cause));
      return json({ error: "guard_error" }, 502);
    }
  }

  private async route(request: Request): Promise<Response> {
    const caller = parseCaller(request.headers.get(HEADER.callerClass));
    if (!caller) throw new Refusal("class.unknown");
    const url = new URL(request.url);
    const route = routeOf(url.pathname);
    if (!route) throw new Refusal("route.unknown");
    if (!ROUTE_CALLERS[route].includes(caller)) throw new Refusal("class.not_allowed");
    const rest = url.pathname.slice(route.length);
    const { ctx } = this;

    switch (route) {
      case GUARD_ROUTES.health:
        return json(await this.health());
      case GUARD_ROUTES.version:
        return json({ version_id: ctx.versionId });
      case GUARD_ROUTES.telnyx:
        return handleTelnyx(ctx, request, caller, url);
      case GUARD_ROUTES.diag:
        return handleDiag(ctx, request, url, rest);
      case GUARD_ROUTES.admin:
        return handleAdmin(ctx, request, rest);
      case GUARD_ROUTES.resend:
        await refuseIfKnownUnsafe(ctx);
        return handleResend(ctx, request, rest);
      case GUARD_ROUTES.fcm:
        await refuseIfKnownUnsafe(ctx);
        return handleFcm(ctx, request, rest);
      case GUARD_ROUTES.fcmToken:
        return handleFcmToken();
      case GUARD_ROUTES.ai:
        await refuseIfKnownUnsafe(ctx);
        return handleAi(ctx, request, rest);
      case GUARD_ROUTES.partition:
        if (request.method !== "GET") throw new Refusal("route.unknown");
        // The edge decides webhook ownership from this, so it waits for the
        // start-up checks exactly as a rig caller does.
        await requireSafe(ctx);
        return json(toWire(await loadPartition(ctx)));
      case GUARD_ROUTES.lease:
        return this.lease(request, caller, rest);
      case GUARD_ROUTES.legs:
        return this.legs(request);
      case GUARD_ROUTES.reject:
        return this.reject(request);
      case GUARD_ROUTES.detach:
        return this.detach(request);
      case GUARD_ROUTES.halt:
        return this.halt(request);
      default:
        throw new Refusal("route.unknown");
    }
  }

  private async lease(request: Request, caller: GuardCaller, rest: string): Promise<Response> {
    const { ctx } = this;
    if (request.method === "GET" && rest === "") {
      const lease = await liveLease(ctx);
      return json(lease ? toGrant(lease) : null);
    }
    if (request.method === "POST" && rest === "") {
      const body = await bodyOf(request);
      const lease = await acquireLease(ctx, body.scenario, caller);
      await ctx.setAlarm(ctx.now() + PREEMPT_POLL_MS);
      return json(toGrant(lease), 201);
    }
    if (request.method === "DELETE" && rest.startsWith("/") && rest.length > 1) {
      return json(toGrant(await releaseLease(ctx, decodeURIComponent(rest.slice(1)))));
    }
    throw new Refusal("route.unknown");
  }

  /** Edge calls act on the partition, so they wait for the start-up checks like any Telnyx route. */
  private async edgeView(): Promise<PartitionView> {
    await requireSafe(this.ctx);
    return loadPartition(this.ctx);
  }

  /** A LegRegistration on one of the partition's connections, with `via` naming that connection. */
  private async nonprodLeg(request: Request, view: PartitionView): Promise<LegRegistration> {
    const leg = (await bodyOf(request)) as Partial<LegRegistration>;
    if (typeof leg.call_control_id !== "string" || !leg.call_control_id || typeof leg.connection_id !== "string") {
      throw new Refusal("request.body_invalid");
    }
    const { voice, robot, webrtc } = view.record.connections;
    if (![voice, robot, webrtc].includes(leg.connection_id)) throw new Refusal("legs.connection_not_nonprod");
    const expected = { voice, robot, webrtc }[leg.via as LegRegistration["via"]];
    if (!expected || expected !== leg.connection_id) throw new Refusal("legs.via_mismatch");
    return { call_control_id: leg.call_control_id, connection_id: leg.connection_id, via: leg.via as LegRegistration["via"] };
  }

  private async legs(request: Request): Promise<Response> {
    if (request.method !== "POST") throw new Refusal("route.unknown");
    const view = await this.edgeView();
    const entry = await registerLeg(this.ctx, await this.nonprodLeg(request, view));
    return json({ registered: true, expires_at: new Date(entry.expires_at).toISOString() });
  }

  /**
   * A stranger's call to an owned number: rejected on the edge's word, and
   * never registered, so nobody can command the leg afterwards.
   */
  private async reject(request: Request): Promise<Response> {
    if (request.method !== "POST") throw new Refusal("route.unknown");
    const view = await this.edgeView();
    const leg = await this.nonprodLeg(request, view);
    const reply = await this.ctx.telnyx!.send(
      "POST",
      `/v2/calls/${encodeURIComponent(leg.call_control_id)}/actions/reject`,
      { cause: "CALL_REJECTED" },
    );
    return json({ rejected: reply.status }, reply.status >= 200 && reply.status <= 299 ? 200 : 502);
  }

  private async detach(request: Request): Promise<Response> {
    if (request.method !== "POST") throw new Refusal("route.unknown");
    const view = await this.edgeView();
    const body = await bodyOf(request);
    const { e164, strangers, window_ms } = body;
    if (typeof e164 !== "string" || typeof strangers !== "number" || typeof window_ms !== "number") {
      throw new Refusal("request.body_invalid");
    }
    const outcome = await detachFlooded(this.ctx, view, { e164, strangers, window_ms });
    if (outcome === "not_owned") throw new Refusal("provisioning.number_not_owned");
    return json({ outcome }, outcome === "failed" ? 502 : 200);
  }

  private async halt(request: Request): Promise<Response> {
    if (request.method !== "POST") throw new Refusal("route.unknown");
    const body = (await bodyOf(request)) as Partial<HaltRequest>;
    const signal = typeof body.signal === "string" ? body.signal.trim() : "";
    if (!signal || signal.length > 200) throw new Refusal("request.body_invalid");
    if (!HALT_CORROBORATIONS.includes(body.corroborated_by as HaltCorroboration)) {
      throw new Refusal("request.body_invalid");
    }
    const noticeId = typeof body.notice_id === "string" && body.notice_id ? body.notice_id : null;
    await recordSignal(this.ctx, {
      signal,
      notice_id: noticeId,
      corroborated_by: body.corroborated_by as HaltCorroboration,
    });
    return json(await signalSummary(this.ctx));
  }

  async health(): Promise<GuardHealth> {
    const { ctx } = this;
    const now = ctx.now();
    let safety: GuardSafety = { state: "unchecked", reasons: [] };
    if (ctx.telnyx) {
      try {
        await requireSafe(ctx);
        // Loading the partition notes the held numbers' rentals in the ledger,
        // so the money reading below counts them.
        await loadPartition(ctx);
      } catch {
        // The stored result below says why.
      }
      safety = (await ctx.store.get<SafetyState>(SAFETY_KEY)) ?? { state: "unchecked", reasons: ["checks_failed_to_run"] };
    }

    const paid: string[] = [];
    if (!ctx.telnyx) paid.push("telnyx.key_missing");
    if (safety.state !== "ok") paid.push(safety.state === "unsafe" ? "startup.unsafe" : "startup.unconfigured");
    if (ctx.config.concurrentLimit === null) paid.push("admission.limit_unknown");
    const reserve = await ctx.store.get<ReserveRecord>(ADMISSION_KEYS.reserve);
    const room = roomFor(ctx.config.concurrentLimit, reserve, now);
    if (ctx.config.concurrentLimit !== null && room === null) paid.push("admission.reserve_unknown");
    const ratio = ratioRule(await ctx.store.get<RatiosRecord>(ADMISSION_KEYS.ratios), now);
    if (ratio) paid.push(ratio.rule);
    const window = windowInForce(await ctx.store.get<WindowRecord>(ADMISSION_KEYS.window), now);
    const signals = await signalSummary(ctx);
    if (signals.latched) paid.push("signal.latched");
    else if (signals.halted_until) paid.push("signal.halted");
    const tier = await readTier(ctx);
    if (tier.tier === "red") paid.push("budget.tier_red");

    const { balance, above } = ctx.telnyx ? await balanceAboveFloor(ctx) : { balance: null, above: false };
    if (ctx.telnyx && balance === null) paid.push("budget.balance_unknown");
    if (balance !== null && !above) paid.push("budget.balance_floor");
    const floor = await balanceFloor(ctx);

    const lease = await liveLease(ctx);
    return {
      ok: Boolean(ctx.telnyx) && safety.state === "ok",
      balance_above_floor: above,
      ...(room === null ? {} : { room }),
      version_id: ctx.versionId,
      telnyx: {
        key: ctx.telnyx ? "present" : "absent",
        ...(ctx.telnyx ? {} : { rule: "telnyx.key_missing" }),
        safety,
      },
      ordering: await this.ordering(),
      paid_dials: {
        enabled: paid.length === 0,
        blockers: paid,
        room,
        window_start_hour_utc: window.startHour,
        window_measured_at: window.measuredAt === null ? null : new Date(window.measuredAt).toISOString(),
        in_window: inWindow(now, window.startHour),
      },
      money: { ...tier, balance_usd: balance, balance_floor_usd: floor },
      lease: lease ? toGrant(lease) : null,
      signals,
      mail: await mailSummary(ctx),
      ai_neurons_today: await aiNeuronsToday(ctx),
      vendors: {
        resend: Boolean(ctx.config.resendKey),
        fcm: Boolean(ctx.config.fcmServiceAccount),
        ai: Boolean(ctx.ai),
        sentry_production: Boolean(ctx.config.sentryProdDsn),
        edge_origin: Boolean(ctx.config.edgeOrigin),
      },
    };
  }

  private async ordering(): Promise<{ enabled: boolean; blockers: string[] }> {
    const blockers = await orderingBlockers(this.ctx);
    return { enabled: blockers.length === 0, blockers };
  }

  async cron(expression: string): Promise<void> {
    const { ctx } = this;
    if (expression === CRONS.keyInventory) {
      try {
        await runKeyInventory(ctx);
      } catch (cause) {
        const rule = cause instanceof Refusal ? cause.rule : cause instanceof Error ? cause.message : String(cause);
        console.error(`guard: key inventory not run: ${rule}`);
      }
      return;
    }
    if (expression !== CRONS.upkeep) {
      console.error(`guard: no job for cron ${expression}`);
      return;
    }
    await pruneLegs(ctx);
    await mailHalted(ctx, await readMailStatus(ctx));
    if (!ctx.telnyx) return;
    try {
      await requireSafe(ctx);
      await verifyFirstOrder(ctx);
      await readBalance(ctx, { fresh: true });
      await enforceCap(ctx, await loadPartition(ctx, { fresh: true }));
    } catch (cause) {
      const rule = cause instanceof Refusal ? cause.rule : cause instanceof Error ? cause.message : String(cause);
      console.error(`guard: upkeep stopped: ${rule}`);
    }
  }

  /**
   * Preemption (docs/RIG.md): while a lease is live,
   * production's active calls are polled every two seconds, and the first
   * production call hangs up every test leg. Only an active-calls read that
   * does not exist stops the poll, leaving the room formula as the only
   * protection, as the design's fallback says. A read that failed for now is
   * asked again, and admission admits nothing while it cannot see.
   */
  async alarm(): Promise<void> {
    const { ctx } = this;
    const lease = await liveLease(ctx);
    if (!lease || !ctx.telnyx) return;
    let production: ProductionCalls = "unknown";
    try {
      production = await productionCalls(ctx, await loadPartition(ctx));
    } catch (cause) {
      const rule = cause instanceof Refusal ? cause.rule : cause instanceof Error ? cause.message : String(cause);
      console.error(`guard: preemption poll failed: ${rule}`);
    }
    if (production === "absent") {
      console.error("guard: no active-calls read for production's connections; preemption off for this lease");
      return;
    }
    if (production === "live" && (await this.hangUpTestLegs()) === 0) {
      await markPreempted(ctx, lease.lease_id);
      return;
    }
    await ctx.setAlarm(ctx.now() + PREEMPT_POLL_MS);
  }

  /** Hangs up every test leg that may be up; returns how many may still be. */
  private async hangUpTestLegs(): Promise<number> {
    const telnyx = this.ctx.telnyx!;
    let left = 0;
    for (const leg of await candidateLiveLegs(this.ctx)) {
      const path = `/v2/calls/${encodeURIComponent(leg.call_control_id)}/actions/hangup`;
      const status = await telnyx.send("POST", path, {}).then(
        (reply) => reply.status,
        () => 0,
      );
      // 404 and 422 are how Telnyx answers a command on a call that has already ended.
      if ((status >= 200 && status <= 299) || status === 404 || status === 422) {
        await markEnded(this.ctx, leg.call_control_id);
      } else {
        left += 1;
      }
    }
    return left;
  }
}
