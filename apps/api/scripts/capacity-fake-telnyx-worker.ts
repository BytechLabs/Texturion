/**
 * #251 -- a Telnyx stand-in that runs as a temporary workers.dev Worker.
 *
 * The API Worker under test is given this Worker's origin as TELNYX_API_BASE,
 * so every dial, answer, bridge and hangup it issues lands here and never at
 * Telnyx. The switch model is the one the rig uses (e2e/fake-telnyx-voice.ts):
 * commands move legs, and the webhooks Telnyx would send wait in an outbox.
 * The call driver takes them from `/__ctl/events` and delivers them, signed, to
 * the API Worker, which makes the driver the carrier and this Worker the switch.
 *
 * One Durable Object holds the whole switch so its state is single-threaded
 * and survives between requests. A path no handler knows answers
 * `200 {"data":{}}`, which also stands in for Stripe and Resend when the API
 * Worker is pointed here for them.
 */
import { createVoiceModel, type FakeResponse } from "../e2e/fake-telnyx-voice.ts";

interface SwitchStub {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  SWITCH: { idFromName(name: string): unknown; get(id: unknown): SwitchStub };
  CONTROL_TOKEN: string;
}

function encode(response: FakeResponse): Response {
  const status = response.status ?? 200;
  if (response.bytes) {
    return new Response(response.bytes, {
      status,
      headers: { "content-type": response.contentType ?? "application/octet-stream" },
    });
  }
  if (response.text !== undefined) {
    return new Response(response.text, {
      status,
      headers: { "content-type": response.contentType ?? "text/plain" },
    });
  }
  return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

export class Switch {
  private readonly model = createVoiceModel();

  constructor(_state: unknown, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.model.setOrigin(url.origin);
    const voice = this.model.voice;

    if (url.pathname.startsWith("/__ctl/")) {
      const op = url.pathname.slice("/__ctl/".length);
      const input = (request.method === "POST" ? await request.json() : {}) as Record<string, string>;
      switch (op) {
        case "incoming": {
          const leg = voice.incoming({ from: input.from ?? "", to: input.to ?? "" });
          return json({ callControlId: leg.callControlId, callSessionId: leg.callSessionId });
        }
        case "events": {
          const events = [];
          for (let event = voice.takeEvent(); event; event = voice.takeEvent()) events.push(event);
          return json(events);
        }
        case "answer":
          voice.answer(input.callControlId ?? "");
          return json({});
        case "hangup":
          voice.hangup(input.callControlId ?? "");
          return json({});
        case "legs":
          return json(voice.legs().map((leg) => ({ ...leg, commandIds: undefined })));
        case "ledger":
          return json({ ledger: voice.ledger(), pending: voice.pendingEvents() });
        case "reset":
          voice.resetCalls();
          return json({});
        default:
          return new Response("unknown control operation", { status: 404 });
      }
    }

    const raw = await request.text();
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const call = { method: request.method, path: url.pathname, query: url.searchParams, body, raw };
    for (const handler of this.model.handlers) {
      if (handler.method !== call.method) continue;
      const match = call.path.match(handler.pattern);
      if (match) return encode(handler.respond(call, match));
    }
    return json({ data: {} });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/__ctl/") &&
      request.headers.get("authorization") !== `Bearer ${env.CONTROL_TOKEN}`
    ) {
      return new Response("not found", { status: 404 });
    }
    return env.SWITCH.get(env.SWITCH.idFromName("switch")).fetch(request);
  },
};
