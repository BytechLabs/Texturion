import { WorkerEntrypoint } from "cloudflare:workers";
import { EDGE_PATHS, type EdgeForGuardMethods, type MailStatus } from "@loonext/rig-protocol";

import { callerClassOf } from "./auth";
import { handleAlert, handleRpc, handleSecrets, handleUplink } from "./ctl";
import { scheduled } from "./deadman";
import type { Env } from "./env";
import { forwardToGuard } from "./guard";
import { empty, harden, servesHost } from "./http";
import { mailStatus, receiveMail } from "./mailbox";
import { relayMedia } from "./media";
import { handleNotification } from "./notifications";
import { TELNYX_WEBHOOK_PATHS } from "./telnyx";
import { handleRobotWebhook, handleTelnyxWebhook } from "./webhooks";

/**
 * `loonext-rig-edge` (D142, docs/RIG.md): the only part of the rig the
 * internet can reach. It never runs app code and holds no customer data.
 * Anything off {@link EDGE_PATHS} is an empty 404.
 */

export { RigUplink } from "./uplink";
export { RobotMailbox } from "./mailbox";

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!servesHost(url.hostname)) return empty(421);

  if (env.EDGE_LIMITER) {
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.EDGE_LIMITER.limit({ key });
    if (!success) return empty(429);
  }

  const { pathname } = url;
  const method = request.method;

  if (TELNYX_WEBHOOK_PATHS[pathname] && method === "POST") {
    return handleTelnyxWebhook(env, request, pathname);
  }
  if (pathname.startsWith(EDGE_PATHS.telnyxNotificationsPrefix) && method === "POST") {
    const secret = pathname.slice(EDGE_PATHS.telnyxNotificationsPrefix.length);
    return secret.includes("/") ? empty(404) : handleNotification(env, request, secret);
  }
  if (pathname.startsWith(EDGE_PATHS.mediaPrefix) && (method === "GET" || method === "HEAD")) {
    return relayMedia(env, request);
  }
  if (pathname.startsWith(EDGE_PATHS.robotWebhookPrefix) && method === "POST") {
    return handleRobotWebhook(env, request, url);
  }
  if (pathname === EDGE_PATHS.guardPrefix || pathname.startsWith(`${EDGE_PATHS.guardPrefix}/`)) {
    const caller = await callerClassOf(env, request);
    if (!caller) return empty(401);
    return forwardToGuard(env, request, pathname.slice(EDGE_PATHS.guardPrefix.length) || "/", caller);
  }
  if (pathname === EDGE_PATHS.ctlUplink && method === "GET") return handleUplink(env, request);
  if (pathname === EDGE_PATHS.ctlRpc && method === "POST") return handleRpc(env, request);
  if (pathname === EDGE_PATHS.ctlSecrets && method === "GET") return handleSecrets(env, request);
  if (pathname === EDGE_PATHS.ctlAlert && method === "POST") return handleAlert(env, request);
  return empty(404);
}

/** Where an error must make Telnyx retry rather than give up. */
function retryable(pathname: string): boolean {
  return TELNYX_WEBHOOK_PATHS[pathname] !== undefined || pathname.startsWith(EDGE_PATHS.telnyxNotificationsPrefix);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return harden(await route(request, env));
    } catch (cause) {
      console.error(`edge: ${cause instanceof Error ? cause.message : String(cause)}`);
      return harden(empty(retryable(new URL(request.url).pathname) ? 503 : 500));
    }
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    try {
      await receiveMail(message, env);
    } catch (cause) {
      // receiveMail catches each step; this is the last line, because a throw
      // here would bounce mail on production's sending domain.
      console.error(`mail: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await scheduled(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;

/**
 * The guard's way back in. The guard binds it by this export's name,
 * EDGE_GUARD_ENTRYPOINT (mailbox.test.ts pins the two equal). A named
 * entrypoint is reachable only over a service binding, so it adds nothing to
 * the public surface.
 */
export class EdgeForGuard extends WorkerEntrypoint<Env> implements EdgeForGuardMethods {
  async mailStatus(): Promise<MailStatus> {
    return mailStatus(this.env);
  }
}
