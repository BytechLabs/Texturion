/**
 * An in-memory Telnyx for the policy suites: enough of the v2 API, as the
 * committed spec (telnyx-spec3.json) describes it, to drive every class.
 * Every request is logged, so a test can assert what reached "Telnyx" and,
 * more often, that nothing did.
 */
type Item = Record<string, unknown>;

export interface Logged {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

const LISTS = [
  "billing_groups",
  "outbound_voice_profiles",
  "call_control_applications",
  "credential_connections",
  "messaging_profiles",
  "telephony_credentials",
  "notification_profiles",
  "notification_channels",
  "notification_settings",
  "notification_event_conditions",
  "oauth_clients",
  "oauth_grants",
  "audit_events",
  "webhook_deliveries",
  "call_events",
  "detail_records",
  "recordings",
  "messaging_optouts",
] as const;

export class FakeTelnyx {
  readonly log: Logged[] = [];
  readonly lists: Record<string, Item[]> = Object.fromEntries(LISTS.map((name) => [name, []]));
  numbers: Item[] = [];
  numberOrders: Item[] = [];
  calls = new Map<string, { alive: boolean }>();
  activeCalls = new Map<string, Item[]>();
  /** Null: the account does not expose the endpoint (404). */
  apiKeys: Item[] | null = null;
  activeCallsSupported = true;
  balance = "500.00";
  /** When true, number orders land with no billing group, as if Telnyx dropped it. */
  dropGroupOnOrder = false;
  /** When true, list filters are ignored, as a misbehaving API would. */
  ignoreFilters = false;
  available: string[] = ["+14165550150", "+14165550151", "+14165550152"];
  /** The next request matching this answers with its status, for failure paths. */
  failNext: { method: string; path: string; status: number } | null = null;
  private serial = 0;

  nextId(prefix: string): string {
    this.serial += 1;
    return `${prefix}-${this.serial}`;
  }

  requests(method?: string, pathPrefix?: string): Logged[] {
    return this.log.filter(
      (entry) => (!method || entry.method === method) && (!pathPrefix || entry.path.startsWith(pathPrefix)),
    );
  }

  /** Requests other than the guard's own bookkeeping reads. */
  writes(): Logged[] {
    return this.log.filter((entry) => entry.method !== "GET");
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const text = method === "GET" || method === "DELETE" ? "" : await request.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    this.log.push({ method, path: url.pathname, query: url.searchParams, body });
    const fail = this.failNext;
    if (fail && fail.method === method && url.pathname === fail.path) {
      this.failNext = null;
      return reply({ errors: [{ code: String(fail.status) }] }, fail.status);
    }
    return this.route(method, url, body as Item | undefined);
  }

  private filtered(items: Item[], query: URLSearchParams): Item[] {
    if (this.ignoreFilters) return items;
    let out = items;
    for (const [key, value] of query) {
      const field = /^filter\[([a-z_]+)\](?:\[eq\])?$/.exec(key)?.[1];
      if (!field || field === "created_after") continue;
      out = out.filter((item) => {
        const actual = item[field];
        if (value === "null") return actual === null || actual === undefined || actual === "";
        return String(actual) === value;
      });
    }
    return out;
  }

  private route(method: string, url: URL, body: Item | undefined): Response {
    const path = url.pathname;
    const segments = path.split("/").slice(2);
    const [resource, id, sub, action] = segments;

    if (method === "GET" && path === "/v2/balance") {
      return reply({ data: { balance: this.balance, currency: "USD", credit_limit: "0.00" } });
    }
    if (resource === "api_keys") return this.apiKeys ? list(this.apiKeys) : reply({ errors: [] }, 404);

    if (resource === "phone_numbers") return this.phoneNumbers(method, url, id, sub, body);
    if (resource === "number_orders") return this.orders(method, id, body);
    if (resource === "available_phone_numbers") {
      return list(this.available.slice(0, 1).map((phone_number) => ({ phone_number })));
    }
    if (resource === "calls") return this.callsRoute(method, id, sub, action, body);
    if (resource === "messages" && method === "POST") {
      return reply({ data: { id: this.nextId("msg"), to: [{ phone_number: body?.to }] } });
    }
    if (resource === "connections" && sub === "active_calls") {
      if (!this.activeCallsSupported) return reply({ errors: [] }, 404);
      return list(this.activeCalls.get(id) ?? []);
    }

    const items = this.lists[resource];
    if (!items) return reply({ errors: [{ detail: "not found" }] }, 404);
    if (method === "GET" && !id) return list(this.filtered(items, url.searchParams));
    if (method === "POST" && !id) {
      const created: Item = { id: this.nextId(resource), ...(body ?? {}) };
      if (resource === "telephony_credentials") {
        created.resource_id = `connection:${String(body?.connection_id)}`;
        created.sip_username = `gencred${this.serial}`;
      }
      items.push(created);
      return reply({ data: created }, 201);
    }
    const found = items.find((item) => item.id === id);
    if (!found) return reply({ errors: [{ detail: "not found" }] }, 404);
    if (method === "GET") {
      if (sub === "token") return new Response("jwt-token-text", { status: 200 });
      return reply({ data: found });
    }
    if (method === "POST" && sub === "token") return new Response("jwt-token-text", { status: 201 });
    if (method === "PATCH") {
      Object.assign(found, body);
      return reply({ data: found });
    }
    if (method === "DELETE") {
      items.splice(items.indexOf(found), 1);
      return reply({ data: found });
    }
    return reply({ errors: [] }, 405);
  }

  private phoneNumbers(method: string, url: URL, id: string, sub: string, body: Item | undefined): Response {
    if (method === "GET" && !id) return list(this.filtered(this.numbers, url.searchParams));
    const number = this.numbers.find((item) => item.id === id);
    if (!number) return reply({ errors: [{ detail: "not found" }] }, 404);
    if (method === "GET" && sub === "voice") {
      return reply({ data: { id: number.id, phone_number: number.phone_number, connection_id: number.connection_id } });
    }
    if (method === "GET") return reply({ data: number });
    if (method === "PATCH") {
      Object.assign(number, body);
      return reply({ data: number });
    }
    if (method === "DELETE") {
      this.numbers.splice(this.numbers.indexOf(number), 1);
      return reply({ data: number });
    }
    return reply({ errors: [] }, 405);
  }

  private orders(method: string, id: string | undefined, body: Item | undefined): Response {
    if (method === "POST" && !id) {
      const phone = (body?.phone_numbers as Item[] | undefined)?.[0]?.phone_number as string;
      const order: Item = {
        id: this.nextId("order"),
        status: "success",
        billing_group_id: body?.billing_group_id ?? null,
        connection_id: body?.connection_id ?? null,
        messaging_profile_id: body?.messaging_profile_id ?? null,
        phone_numbers: [{ phone_number: phone }],
      };
      this.numberOrders.push(order);
      this.numbers.push({
        id: this.nextId("num"),
        phone_number: phone,
        billing_group_id: this.dropGroupOnOrder ? null : (body?.billing_group_id ?? null),
        connection_id: body?.connection_id ?? null,
        messaging_profile_id: body?.messaging_profile_id ?? null,
        tags: [],
      });
      this.available = this.available.filter((item) => item !== phone);
      return reply({ data: order });
    }
    const order = this.numberOrders.find((item) => item.id === id);
    return order ? reply({ data: order }) : reply({ errors: [] }, 404);
  }

  private callsRoute(method: string, id: string | undefined, sub: string, action: string, body: Item | undefined): Response {
    if (method === "POST" && !id) {
      const ccid = this.nextId("ccid");
      this.calls.set(ccid, { alive: true });
      return reply({ data: { call_control_id: ccid, call_leg_id: `leg-${ccid}`, is_alive: true, to: body?.to } });
    }
    if (method === "GET" && id && !sub) {
      const call = this.calls.get(id);
      return call ? reply({ data: { call_control_id: id, is_alive: call.alive } }) : reply({ errors: [] }, 404);
    }
    if (method === "POST" && sub === "actions") {
      if (action === "hangup" || action === "reject") this.calls.set(id as string, { alive: false });
      return reply({ data: { result: "ok" } });
    }
    return reply({ errors: [] }, 404);
  }
}

export function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function list(items: Item[]): Response {
  return reply({ data: items, meta: { total_pages: 1, page_number: 1, total_results: items.length } });
}
