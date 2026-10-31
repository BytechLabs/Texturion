/**
 * Test fixtures for the edge: a stand-in guard, signed Telnyx deliveries, a
 * fake rig on the uplink and a clean slate between cases. Numbers are in the
 * fictional 555-01xx range; ids are made up.
 */
import { runInDurableObject } from "cloudflare:test";
import { env as bindings } from "cloudflare:workers";
import type { CallerClass, ControlClass, EdgeToRig, Partition, RigToEdge } from "@loonext/rig-protocol";

import { sha256Hex } from "../auth";
import { MAILBOX_NAME, UPLINK_NAME, type Env } from "../env";
import { resetGuardCaches } from "../guard";
import worker from "../index";

export const ORIGIN = "https://loonext-rig-edge.example.workers.dev";

export const OWNED_A = "+14165550101";
export const OWNED_B = "+14165550102";
export const STANDING = "+14165550103";
export const STRANGER = "+14165550199";

export const CONNECTIONS = {
  voice: "conn-voice-test",
  robot: "conn-robot-test",
  webrtc: "conn-webrtc-test",
  sentinel: "conn-sentinel-test",
};
export const PROFILE_TENANT = "mp-tenant-test";
export const PROFILE_ROBOT = "mp-robot-test";
export const PRODUCTION_CONNECTION = "conn-production-test";
export const PRODUCTION_PROFILE = "mp-production-test";

export const PARTITION: Partition = {
  billing_group_id: "bg-nonprod-test",
  owned_e164: [OWNED_A, OWNED_B],
  standing_e164: [STANDING],
  connection_ids: CONNECTIONS,
  messaging_profile_ids: [PROFILE_TENANT, PROFILE_ROBOT],
  fetched_at: "2026-10-30T00:00:00.000Z",
};

/** Readable stems, so no fixture looks like a real credential to a scanner. */
export const TOKENS: Record<CallerClass | ControlClass, string> = {
  "rig-api": "edge-test-token-rig-api-0123456789abcdef",
  robot: "edge-test-token-robot-0123456789abcdef",
  diag: "edge-test-token-diag-0123456789abcdef",
  admin: "edge-test-token-admin-0123456789abcdef",
  rig: "edge-test-token-rig-0123456789abcdef",
  triage: "edge-test-token-triage-0123456789abcdef",
};
export const ROBOT_WEBHOOK_SECRET = "edge-test-robot-sink-0123456789abcdef";
export const NOTIFICATIONS_SECRET = "edge-test-notices-0123456789abcdef";
export const ROBOT_ADDRESS = "rig-robot@example.loonext.com";

export interface GuardCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface FakeGuard {
  binding: Fetcher;
  calls: GuardCall[];
  /** What GET /partition answers; null makes it fail. */
  partition: Partition | null;
  /** Per-path overrides, checked before the defaults. */
  respond: (call: GuardCall) => Response | undefined;
}

export function fakeGuard(): FakeGuard {
  const guard: FakeGuard = {
    calls: [],
    partition: PARTITION,
    respond: () => undefined,
    binding: undefined as unknown as Fetcher,
  };
  guard.binding = {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const call: GuardCall = {
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(request.headers),
        body: request.body ? await request.text() : "",
      };
      guard.calls.push(call);
      const custom = guard.respond(call);
      if (custom) return custom;
      if (url.pathname === "/partition") {
        return guard.partition
          ? Response.json(guard.partition)
          : new Response(null, { status: 503 });
      }
      return Response.json({ ok: true });
    },
  } as unknown as Fetcher;
  return guard;
}

let telnyxPair: CryptoKeyPair | null = null;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function telnyxKeys(): Promise<{ pair: CryptoKeyPair; publicKey: string }> {
  telnyxPair ??= (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", telnyxPair.publicKey)) as ArrayBuffer);
  return { pair: telnyxPair, publicKey: toBase64(raw) };
}

export async function signature(pair: CryptoKeyPair, timestamp: string, body: string): Promise<string> {
  const signed = await crypto.subtle.sign(
    { name: "Ed25519" },
    pair.privateKey,
    new TextEncoder().encode(`${timestamp}|${body}`),
  );
  return toBase64(new Uint8Array(signed));
}

export function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

/** A Telnyx delivery to `path`, signed now unless told otherwise. */
export async function telnyxDelivery(
  path: string,
  event: unknown,
  options: { timestamp?: string; pair?: CryptoKeyPair } = {},
): Promise<Request> {
  const body = typeof event === "string" ? event : JSON.stringify(event);
  const timestamp = options.timestamp ?? nowSeconds();
  const pair = options.pair ?? (await telnyxKeys()).pair;
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "telnyx-timestamp": timestamp,
      "telnyx-signature-ed25519": await signature(pair, timestamp, body),
    },
    body,
  });
}

let eventCounter = 0;

export function callEvent(
  type: string,
  payload: Record<string, unknown>,
  id = `evt-call-${++eventCounter}`,
): unknown {
  return {
    data: {
      id,
      event_type: type,
      payload: {
        connection_id: CONNECTIONS.voice,
        call_control_id: `ccid-${eventCounter}`,
        direction: "incoming",
        from: OWNED_A,
        to: OWNED_B,
        ...payload,
      },
    },
  };
}

export function messageEvent(
  type: string,
  payload: Record<string, unknown>,
  id = `evt-msg-${++eventCounter}`,
): unknown {
  return {
    data: {
      id,
      event_type: type,
      payload: {
        messaging_profile_id: PROFILE_TENANT,
        from: { phone_number: OWNED_A },
        to: [{ phone_number: OWNED_B }],
        text: "fixture text",
        ...payload,
      },
    },
  };
}

/** The edge's env, with a stand-in guard and every token configured. */
export async function edgeEnv(guard: FakeGuard, overrides: Partial<Env> = {}): Promise<Env> {
  const { publicKey } = await telnyxKeys();
  return {
    ...(bindings as unknown as Env),
    GUARD: guard.binding,
    TELNYX_PUBLIC_KEY: publicKey,
    ROBOT_MAIL_ADDRESS: ROBOT_ADDRESS,
    TOKEN_SHA256_RIG_API: await sha256Hex(TOKENS["rig-api"]),
    TOKEN_SHA256_ROBOT: await sha256Hex(TOKENS.robot),
    TOKEN_SHA256_DIAG: await sha256Hex(TOKENS.diag),
    TOKEN_SHA256_ADMIN: await sha256Hex(TOKENS.admin),
    TOKEN_SHA256_RIG: await sha256Hex(TOKENS.rig),
    TOKEN_SHA256_TRIAGE: await sha256Hex(TOKENS.triage),
    ROBOT_WEBHOOK_SECRET_SHA256: await sha256Hex(ROBOT_WEBHOOK_SECRET),
    NOTIFICATIONS_SECRET_SHA256: await sha256Hex(NOTIFICATIONS_SECRET),
    ...overrides,
  };
}

export function call(request: Request, e: Env): Promise<Response> {
  return worker.fetch(request, e);
}

export function uplinkStub(): DurableObjectStub<import("../uplink").RigUplink> {
  return bindings.UPLINK.get(bindings.UPLINK.idFromName(UPLINK_NAME));
}

export function mailboxStub(): DurableObjectStub<import("../mailbox").RobotMailbox> {
  return bindings.MAILBOX.get(bindings.MAILBOX.idFromName(MAILBOX_NAME));
}

/**
 * Empties both objects and the isolate's caches, so no case inherits another's
 * state. Rows are deleted rather than the storage wiped: a live instance
 * whose tables vanished under it would fail the next case's first write, and
 * aborting the objects instead kills whatever the last case left in flight.
 */
export async function resetEdge(): Promise<void> {
  resetGuardCaches();
  for (const stub of [uplinkStub(), mailboxStub()] as DurableObjectStub[]) {
    await runInDurableObject(stub, async (_instance, state) => {
      for (const ws of state.getWebSockets()) {
        try {
          ws.close(1000, "reset");
        } catch {
          // Already closed.
        }
      }
      await state.storage.deleteAlarm();
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'")
        .toArray();
      for (const { name } of tables) state.storage.sql.exec(`DELETE FROM "${name}"`);
    });
  }
}

export async function counters(): Promise<Record<string, number>> {
  return (await uplinkStub().snapshot()).counters;
}

export interface FakeRig {
  ws: WebSocket;
  /** The next frame matching `match` not yet taken, waiting for it if need be. */
  next(match?: (frame: EdgeToRig) => boolean, timeoutMs?: number): Promise<EdgeToRig>;
  send(frame: RigToEdge): void;
  close(): void;
}

/** `rigd`, dialled out to /ctl/uplink with the rig control token. */
export async function connectRig(e: Env): Promise<FakeRig> {
  const response = await call(
    new Request(`${ORIGIN}/ctl/uplink`, {
      headers: { upgrade: "websocket", authorization: `Bearer ${TOKENS.rig}` },
    }),
    e,
  );
  const ws = response.webSocket;
  if (response.status !== 101 || !ws) throw new Error(`uplink refused: ${response.status}`);
  ws.accept();
  const inbox: EdgeToRig[] = [];
  let wake: (() => void) | null = null;
  ws.addEventListener("message", (event) => {
    inbox.push(JSON.parse(event.data as string) as EdgeToRig);
    wake?.();
  });
  return {
    ws,
    async next(match = () => true, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = inbox.findIndex(match);
        if (index !== -1) return inbox.splice(index, 1)[0];
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("no matching frame from the edge");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.min(remaining, 50));
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
      }
    },
    send(frame) {
      ws.send(JSON.stringify(frame));
    },
    close() {
      ws.close(1000, "done");
    },
  };
}
