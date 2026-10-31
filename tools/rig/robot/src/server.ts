/**
 * robotd's local HTTP face, on loopback only. rigd posts the robot's Telnyx
 * events and sink deliveries here as they come up the uplink; scenario runs
 * post plans and read the records back.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Inbox, WebhookSink } from "./inbox.ts";
import type { CallControlApi, RequestContext } from "./telnyx.ts";
import { isRobotRole, type CallPlan, type NumberBook, type Robot } from "./robot.ts";

export const ROBOT_TOKEN_HEADER = "x-robot-token";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_WAIT_MS = 5 * 60 * 1000;

export interface RobotServerDeps {
  robot: Robot;
  inbox: Inbox;
  sink: WebhookSink;
  telnyx: CallControlApi;
  numbers: NumberBook;
  /** Shared with rigd and scenario runs; every request must carry it. */
  token: string;
}

export function robotServer(deps: RobotServerDeps): Server {
  return createServer((request, response) => {
    handle(deps, request, response).catch((error: unknown) => {
      send(response, 500, { error: error instanceof Error ? error.message : "internal" });
    });
  });
}

async function handle(deps: RobotServerDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.headers[ROBOT_TOKEN_HEADER] !== deps.token) return send(response, 401, { error: "unauthorized" });
  const url = new URL(request.url ?? "/", "http://robot.local");
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /health") return send(response, 200, { ok: true });

  if (route === "POST /telnyx") {
    const body = parse(await read(request));
    if (!deps.inbox.handle(body)) deps.robot.handleEvent(body);
    return send(response, 200, { ok: true });
  }

  if (route === "POST /sink") {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === "string" && name !== ROBOT_TOKEN_HEADER) headers[name] = value;
    }
    deps.sink.record(headers, await read(request));
    return send(response, 200, { ok: true });
  }

  if (route === "POST /calls/dial" || route === "POST /calls/expect") {
    const plan = parse(await read(request)) as CallPlan;
    const record = route.endsWith("dial") ? await deps.robot.dial(plan) : deps.robot.expect(plan);
    return send(response, 200, record);
  }

  const call = /^GET \/calls\/([\w-]+)$/.exec(route);
  if (call) {
    const waitMs = Math.min(Number(url.searchParams.get("wait_ms") ?? 0) || 0, MAX_WAIT_MS);
    const record = waitMs > 0 ? await deps.robot.wait(call[1]!, waitMs) : deps.robot.get(call[1]!);
    return record ? send(response, 200, record) : send(response, 404, { error: "no such call" });
  }

  if (route === "POST /sms") {
    const body = parse(await read(request)) as {
      from_role?: unknown;
      to_role?: unknown;
      text?: unknown;
      lease_id?: unknown;
      scenario?: unknown;
    };
    if (!isRobotRole(body.from_role)) return send(response, 400, { error: "from_role must be a robot line" });
    if (typeof body.to_role !== "string" || typeof body.text !== "string" || body.text.length === 0) {
      return send(response, 400, { error: "to_role and text are required" });
    }
    const from = deps.numbers.number(body.from_role);
    const to = deps.numbers.number(body.to_role);
    if (!from || !to) return send(response, 400, { error: "unknown role" });
    const context: RequestContext = {
      lease: typeof body.lease_id === "string" ? body.lease_id : undefined,
      scenario: typeof body.scenario === "string" ? body.scenario : undefined,
    };
    return send(response, 200, await deps.telnyx.sendMessage({ from, to, text: body.text }, context));
  }

  if (route === "GET /inbox") {
    return send(response, 200, deps.inbox.list({ to_role: url.searchParams.get("to_role") ?? undefined, since: since(url) }));
  }

  if (route === "GET /sink") {
    return send(response, 200, deps.sink.list({ since: since(url), type: url.searchParams.get("type") ?? undefined }));
  }

  send(response, 404, { error: "not found" });
}

function since(url: URL): number | undefined {
  const value = url.searchParams.get("since");
  return value === null ? undefined : Number(value);
}

async function read(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
