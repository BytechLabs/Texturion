/**
 * D31 launch-pass harness — fake Stripe server.
 *
 * A real node:http server speaking enough Stripe REST for the checkout +
 * billing flows the Worker drives (routes/billing.ts, webhooks/stripe.ts,
 * billing/meter.ts). stripe-node is retargeted here via `env.STRIPE_API_BASE`
 * and parses these JSON responses exactly as it would the real API.
 *
 * Stripe webhooks are signed by the harness with a real `Stripe` instance's
 * `webhooks.generateTestHeaderString` over the same `STRIPE_WEBHOOK_SECRET` the
 * Worker verifies with (constructEventAsync) — see harness.ts injectStripe.
 *
 * The server is lightly stateful: the harness can register a subscription /
 * customer fixture (so a webhook-driven `subscriptions.retrieve` returns the
 * shape the flow expects) and read back checkout sessions it created. Every
 * request is recorded for assertions.
 *
 * Lives under apps/api/e2e/ ONLY; never imported by src/.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { AddressInfo } from "node:net";

export interface StripeCall {
  method: string;
  path: string;
  /** Parsed application/x-www-form-urlencoded body (Stripe request encoding). */
  form: URLSearchParams;
  raw: string;
}

export interface FakeStripe {
  origin: string;
  calls: StripeCall[];
  callsTo(method: string, pattern: RegExp): StripeCall[];
  /** Register/override a subscription object returned by GET /v1/subscriptions/:id. */
  setSubscription(id: string, object: Record<string, unknown>): void;
  /** Register/override a customer returned by GET /v1/customers/:id. */
  setCustomer(id: string, object: Record<string, unknown>): void;
  /** Register line items returned by GET /v1/checkout/sessions/:id/line_items. */
  setSessionLineItems(sessionId: string, items: unknown[]): void;
  reset(): void;
  close(): Promise<void>;
}

let sessionSeq = 0;
let customerSeq = 0;
let meterSeq = 0;
let scheduleSeq = 0;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startFakeStripe(): Promise<FakeStripe> {
  const calls: StripeCall[] = [];
  const subscriptions = new Map<string, Record<string, unknown>>();
  const customers = new Map<string, Record<string, unknown>>();
  const sessionLineItems = new Map<string, unknown[]>();
  const schedules = new Map<string, Record<string, unknown>>();

  function respond(call: StripeCall): { status: number; body: unknown } {
    const { method, path, form } = call;

    // --- Checkout sessions ---
    if (method === "POST" && /^\/v1\/checkout\/sessions$/.test(path)) {
      sessionSeq += 1;
      const id = `cs_e2e_${sessionSeq}`;
      return {
        status: 200,
        body: {
          id,
          object: "checkout.session",
          url: `https://checkout.stripe.test/c/pay/${id}`,
          client_reference_id: form.get("client_reference_id") ?? null,
          customer: form.get("customer") ?? null,
          subscription: null,
          mode: form.get("mode") ?? "subscription",
        },
      };
    }
    const lineItemsMatch = path.match(
      /^\/v1\/checkout\/sessions\/([^/]+)\/line_items$/,
    );
    if (method === "GET" && lineItemsMatch) {
      return {
        status: 200,
        body: {
          object: "list",
          data: sessionLineItems.get(lineItemsMatch[1]) ?? [],
          has_more: false,
        },
      };
    }

    // --- Billing portal ---
    if (method === "POST" && /^\/v1\/billing_portal\/sessions$/.test(path)) {
      return {
        status: 200,
        body: {
          id: "bps_e2e_1",
          object: "billing_portal.session",
          url: "https://billing.stripe.test/p/session/bps_e2e_1",
        },
      };
    }

    // --- Customers ---
    if (method === "POST" && /^\/v1\/customers$/.test(path)) {
      customerSeq += 1;
      const id = `cus_e2e_${customerSeq}`;
      const object = {
        id,
        object: "customer",
        email: form.get("email") ?? null,
      };
      customers.set(id, object);
      return { status: 200, body: object };
    }
    const customerMatch = path.match(/^\/v1\/customers\/([^/]+)$/);
    if (method === "GET" && customerMatch) {
      return {
        status: 200,
        body:
          customers.get(customerMatch[1]) ??
          { id: customerMatch[1], object: "customer" },
      };
    }

    // --- Subscriptions ---
    const subMatch = path.match(/^\/v1\/subscriptions\/([^/]+)$/);
    if (method === "GET" && subMatch) {
      const object = subscriptions.get(subMatch[1]);
      if (!object) {
        return {
          status: 404,
          body: {
            error: {
              type: "invalid_request_error",
              message: `No such subscription: ${subMatch[1]}`,
            },
          },
        };
      }
      return { status: 200, body: object };
    }
    if (method === "POST" && subMatch) {
      const object = subscriptions.get(subMatch[1]) ?? {
        id: subMatch[1],
        object: "subscription",
      };
      if (form.has("cancel_at_period_end")) {
        object.cancel_at_period_end =
          form.get("cancel_at_period_end") === "true";
      }
      subscriptions.set(subMatch[1], object);
      return { status: 200, body: object };
    }

    // --- Subscription schedules ---
    if (method === "POST" && /^\/v1\/subscription_schedules$/.test(path)) {
      scheduleSeq += 1;
      const id = `sub_sched_e2e_${scheduleSeq}`;
      const object = { id, object: "subscription_schedule", phases: [] };
      schedules.set(id, object);
      return { status: 200, body: object };
    }
    const scheduleMatch = path.match(/^\/v1\/subscription_schedules\/([^/]+)$/);
    if (scheduleMatch) {
      const object =
        schedules.get(scheduleMatch[1]) ??
        { id: scheduleMatch[1], object: "subscription_schedule", phases: [] };
      schedules.set(scheduleMatch[1], object);
      return { status: 200, body: object };
    }

    // --- Prices ---
    const priceMatch = path.match(/^\/v1\/prices\/([^/]+)$/);
    if (method === "GET" && priceMatch) {
      return {
        status: 200,
        body: {
          id: priceMatch[1],
          object: "price",
          unit_amount: 100,
          currency: "usd",
          recurring: { interval: "month" },
        },
      };
    }

    // --- Billing meter events (§9 metering) ---
    if (method === "POST" && /^\/v1\/billing\/meter_events$/.test(path)) {
      meterSeq += 1;
      return {
        status: 200,
        body: {
          object: "billing.meter_event",
          identifier: form.get("identifier") ?? `mtr_${meterSeq}`,
          event_name: form.get("event_name") ?? "sms_segments",
        },
      };
    }

    // --- Invoices ---
    if (method === "GET" && /^\/v1\/invoices/.test(path)) {
      return {
        status: 200,
        body: { object: "list", data: [], has_more: false },
      };
    }
    if (method === "POST" && /^\/v1\/invoices/.test(path)) {
      return { status: 200, body: { id: "in_e2e_1", object: "invoice" } };
    }

    // Unhandled: 200 empty object + log, so a missing shape surfaces visibly.
    console.warn(
      `[fake-stripe] unhandled ${method} ${path} — 200 {} (add a handler if a flow needs it)`,
    );
    return { status: 200, body: { object: "" } };
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const url = new URL(req.url ?? "/", "http://stripe.local");
      const call: StripeCall = {
        method: req.method ?? "GET",
        path: url.pathname,
        form: new URLSearchParams(raw),
        raw,
      };
      calls.push(call);
      const { status, body } = respond(call);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    origin: `http://127.0.0.1:${port}`,
    calls,
    callsTo: (method, pattern) =>
      calls.filter((c) => c.method === method && pattern.test(c.path)),
    setSubscription: (id, object) => subscriptions.set(id, { ...object }),
    setCustomer: (id, object) => customers.set(id, { ...object }),
    setSessionLineItems: (sessionId, items) =>
      sessionLineItems.set(sessionId, items),
    reset: () => {
      calls.length = 0;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
