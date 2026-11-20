import { GUARD_ROUTES, HALT_CORROBORATIONS, HEADER } from '@loonext/rig-protocol';
import type { GuardHealth, GuardSafety, HaltRequest, LegRegistration, LevelEvidence } from '@loonext/rig-protocol';

import { handleAdmin } from "./admin";
import { parseCaller, ROUTE_CALLERS, routeOf } from './caller';
import type { GuardCaller } from './caller';
import type { Ctx } from "./context";
import { json, Refusal, refuse } from "./refusal";
import { requireSafe, SAFETY_KEY } from './setup/safety';
import type { SafetyState } from './setup/safety';
import { pruneLegs, registerLeg } from "./state/legs";
import {
  acquireLease,
  activityKey,
  leaseActivity,
  liveLease,
  noteActivity,
  releaseLease,
  toGrant,
} from "./state/lease";
import { mailSummary } from "./state/mail";
import { recordSignal, signalSummary } from "./state/signals";
import { TelnyxError } from "./telnyx/client";
import { detachFlooded } from "./telnyx/detach";
import { orderingBlockers, stoppedReason, verifyFirstOrder } from "./telnyx/ordering";
import { loadPartition, toWire } from './telnyx/partition';
import type { PartitionView } from './telnyx/partition';
import { matchEndpoint } from "./telnyx/registry";
import { handleTelnyx } from "./telnyx/route";
import { aiNeuronsToday, handleAi } from "./vendors/ai";
import { handleDiag } from "./vendors/diag";
import { handleFcm, handleFcmToken } from "./vendors/fcm";
import { handleResend } from "./vendors/resend";

/**
 * The guard (docs/RIG.md). One instance, in one Durable Object,
 * so the partition and lease state have one owner.
 */
export const CRONS = {
  upkeep: "7 * * * *",
} as const;

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json<unknown>();
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
  readonly ctx: Ctx;

  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }

  async handle(request: Request): Promise<Response> {
    try {
      return await this.route(request);
    } catch (error) {
      if (error instanceof Refusal) {
        console.log(`guard: refused ${request.method} ${new URL(request.url).pathname.split("/")[1]}: ${error.rule}`);
        return refuse(error.rule);
      }
      if (error instanceof TelnyxError) {
        return json({ error: "telnyx_request_failed", status: error.status }, 502);
      }
      console.error("guard: request failed:", error instanceof Error ? error.message : String(error));
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
      case GUARD_ROUTES.health: {
        return json(await this.health());
      }
      case GUARD_ROUTES.version: {
        return json({ version_id: ctx.versionId });
      }
      case GUARD_ROUTES.telnyx: {
        return this.telnyx(request, caller, url);
      }
      case GUARD_ROUTES.diag: {
        return handleDiag(ctx, request, url, rest);
      }
      case GUARD_ROUTES.admin: {
        return handleAdmin(ctx, request, rest);
      }
      case GUARD_ROUTES.resend: {
        await refuseIfKnownUnsafe(ctx);
        return handleResend(ctx, request, rest);
      }
      case GUARD_ROUTES.fcm: {
        await refuseIfKnownUnsafe(ctx);
        return handleFcm(ctx, request, rest);
      }
      case GUARD_ROUTES.fcmToken: {
        return handleFcmToken();
      }
      case GUARD_ROUTES.ai: {
        await refuseIfKnownUnsafe(ctx);
        return handleAi(ctx, request, rest);
      }
      case GUARD_ROUTES.partition: {
        if (request.method !== "GET") throw new Refusal("route.unknown");
        // The edge decides webhook ownership from this, so it waits for the
        // start-up checks exactly as a rig caller does.
        await requireSafe(ctx);
        return json(toWire(await loadPartition(ctx)));
      }
      case GUARD_ROUTES.lease: {
        return this.lease(request, caller, rest);
      }
      case GUARD_ROUTES.legs: {
        return this.legs(request);
      }
      case GUARD_ROUTES.reject: {
        return this.reject(request);
      }
      case GUARD_ROUTES.detach: {
        return this.detach(request);
      }
      case GUARD_ROUTES.halt: {
        return this.halt(request);
      }
      case GUARD_ROUTES.evidence: {
        return this.evidence(request, rest);
      }
      default: {
        throw new Refusal("route.unknown");
      }
    }
  }

  /**
   * Every Telnyx request, refused or forwarded, is counted against the live
   * lease, so a scenario can prove what its run did and did not ask for. The
   * count is bookkeeping: failing to write it never changes the answer to a
   * dial or an order Telnyx already took.
   */
  private async telnyx(request: Request, caller: GuardCaller, url: URL): Promise<Response> {
    const { ctx } = this;
    const method = request.method.toUpperCase();
    const path = url.pathname.slice(GUARD_ROUTES.telnyx.length);
    const endpoint = matchEndpoint(method, path)?.entry.key ?? `${method} unregistered`;
    let outcome: string | number = "error";
    try {
      const response = await handleTelnyx(ctx, request, caller, url);
      outcome = response.status;
      return response;
    } catch (error) {
      if (error instanceof Refusal) outcome = error.rule;
      throw error;
    } finally {
      await noteActivity(ctx, activityKey(caller, endpoint, outcome)).catch((error: unknown) =>
        console.error("guard: lease activity not recorded:", error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private async lease(request: Request, caller: GuardCaller, rest: string): Promise<Response> {
    const { ctx } = this;
    if (request.method === "GET" && rest === "") {
      const lease = await liveLease(ctx);
      return json(lease ? toGrant(lease) : null);
    }
    const activity = /^\/([^/]+)\/activity$/.exec(rest);
    if (request.method === "GET" && activity) {
      return json(await leaseActivity(ctx, decodeURIComponent(activity[1])));
    }
    if (request.method === "POST" && rest === "") {
      const body = await bodyOf(request);
      const lease = await acquireLease(ctx, body.scenario, caller, { noDials: body.dials === false });
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
  private static async nonprodLeg(request: Request, view: PartitionView): Promise<LegRegistration> {
    const leg = (await bodyOf(request)) as Partial<LegRegistration>;
    if (typeof leg.call_control_id !== "string" || !leg.call_control_id || typeof leg.connection_id !== "string") {
      throw new Refusal("request.body_invalid");
    }
    const { voice, robot, webrtc } = view.record.connections;
    if (![voice, robot, webrtc].includes(leg.connection_id)) throw new Refusal("legs.connection_not_nonprod");
    const expected = { voice, robot, webrtc }[leg.via!];
    if (!expected || expected !== leg.connection_id) throw new Refusal("legs.via_mismatch");
    return { call_control_id: leg.call_control_id, connection_id: leg.connection_id, via: leg.via! };
  }

  private async legs(request: Request): Promise<Response> {
    if (request.method !== "POST") throw new Refusal("route.unknown");
    const view = await this.edgeView();
    const entry = await registerLeg(this.ctx, await Guard.nonprodLeg(request, view));
    return json({ registered: true, expires_at: new Date(entry.expires_at).toISOString() });
  }

  /**
   * A stranger's call to an owned number: rejected on the edge's word, and
   * never registered, so nobody can command the leg afterwards.
   */
  private async reject(request: Request): Promise<Response> {
    if (request.method !== "POST") throw new Refusal("route.unknown");
    const view = await this.edgeView();
    const leg = await Guard.nonprodLeg(request, view);
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
    if (!HALT_CORROBORATIONS.includes(body.corroborated_by!)) {
      throw new Refusal("request.body_invalid");
    }
    const noticeId = typeof body.notice_id === "string" && body.notice_id ? body.notice_id : null;
    await recordSignal(this.ctx, {
      signal,
      notice_id: noticeId,
      corroborated_by: body.corroborated_by!,
      late: body.late === true,
    });
    return json(await signalSummary(this.ctx));
  }

  private async evidence(request: Request, rest: string): Promise<Response> {
    if (request.method !== "POST" || rest !== "/level") throw new Refusal("route.unknown");
    const body = (await bodyOf(request)) as Partial<LevelEvidence>;
    const ms = body.announcement_ms;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) throw new Refusal("request.body_invalid");
    if (typeof body.at !== "string" || !Number.isFinite(Date.parse(body.at))) throw new Refusal("request.body_invalid");
    if (ms === 0) return json({ recorded: false });
    await this.ctx.store.put("voice:last-automated-announcement", { announcement_ms: ms, at: body.at });
    return json({ recorded: true, level: "paid_or_below" });
  }

  async health(): Promise<GuardHealth> {
    const { ctx } = this;
    let safety: GuardSafety = { state: "unchecked", reasons: [] };
    if (ctx.telnyx) {
      try {
        await requireSafe(ctx);
        await loadPartition(ctx);
      } catch {
        // The stored result below says why.
      }
      safety = (await ctx.store.get<SafetyState>(SAFETY_KEY)) ?? { state: "unchecked", reasons: ["checks_failed_to_run"] };
    }

    const lease = await liveLease(ctx);
    return {
      ok: Boolean(ctx.telnyx) && safety.state === "ok",
      version_id: ctx.versionId,
      telnyx: {
        key: ctx.telnyx ? "present" : "absent",
        ...(ctx.telnyx ? {} : { rule: "telnyx.key_missing" }),
        safety,
      },
      ordering: await this.ordering(),
      lease: lease ? toGrant(lease) : null,
      mail: await mailSummary(ctx),
      ai_neurons_today: await aiNeuronsToday(ctx),
      vendors: {
        resend: Boolean(ctx.config.resendKey),
        fcm: Boolean(ctx.config.fcmServiceAccount),
        ai: Boolean(ctx.ai),
        posthog_production: Boolean(ctx.config.posthogProjectKey),
        edge_origin: Boolean(ctx.config.edgeOrigin),
      },
    };
  }

  private async ordering(): Promise<{ enabled: boolean; blockers: string[]; stopped_reason?: string }> {
    const blockers = await orderingBlockers(this.ctx);
    const reason = await stoppedReason(this.ctx);
    return { enabled: blockers.length === 0, blockers, ...(reason ? { stopped_reason: reason } : {}) };
  }

  async cron(expression: string): Promise<void> {
    const { ctx } = this;
    if (expression !== CRONS.upkeep) {
      console.error(`guard: no job for cron ${expression}`);
      return;
    }
    await pruneLegs(ctx);
    if (!ctx.telnyx) return;
    try {
      await requireSafe(ctx);
      await verifyFirstOrder(ctx);
    } catch (error) {
      const rule = error instanceof Refusal ? error.rule : (error instanceof Error ? error.message : String(error));
      console.error(`guard: upkeep stopped: ${rule}`);
    }
  }
}
