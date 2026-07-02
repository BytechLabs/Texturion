/**
 * Test-only helpers for the telnyx track (D13): the ONLY thing stubbed is the
 * network edge — global fetch. Product code runs the real supabase-js /
 * telnyx-client / stripe-node HTTP paths against these in-memory endpoints.
 *
 * FakeRest is a minimal PostgREST: enough of the filter/insert/update dialect
 * that supabase-js emits (eq/neq/in/is/not.is/lt, order, limit, on_conflict,
 * Prefer resolution/return) to exercise the real query code, failing loudly on
 * anything it does not understand.
 */
import type { FetchRoute } from "../test/support";
import type { Env } from "../env";

type Row = Record<string, unknown>;

interface TableSpec {
  rows: Row[];
  defaults: Row;
}

const RESERVED_PARAMS = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "on_conflict",
  "columns",
]);

function applyFilter(row: Row, column: string, expr: string): boolean {
  const value = row[column];
  if (expr === "is.null") return value === null || value === undefined;
  if (expr === "not.is.null") return value !== null && value !== undefined;
  if (expr.startsWith("eq.")) return String(value) === expr.slice(3);
  if (expr.startsWith("neq.")) return String(value) !== expr.slice(4);
  if (expr.startsWith("lt.")) return String(value) < expr.slice(3);
  if (expr.startsWith("gt.")) return String(value) > expr.slice(3);
  if (expr.startsWith("in.(") && expr.endsWith(")")) {
    const list = expr
      .slice(4, -1)
      .split(",")
      .map((item) => item.replace(/^"(.*)"$/, "$1"));
    return list.includes(String(value));
  }
  throw new Error(`FakeRest: unsupported filter ${column}=${expr}`);
}

function rowMatches(row: Row, url: URL): boolean {
  for (const [key, expr] of url.searchParams.entries()) {
    if (RESERVED_PARAMS.has(key)) continue;
    if (!applyFilter(row, key, expr)) return false;
  }
  return true;
}

function applyOrderAndLimit(rows: Row[], url: URL): Row[] {
  let result = [...rows];
  const order = url.searchParams.get("order");
  if (order) {
    const [column, direction] = order.split(".");
    const sign = direction === "desc" ? -1 : 1;
    result.sort((a, b) => {
      const left = String(a[column] ?? "");
      const right = String(b[column] ?? "");
      return left < right ? -sign : left > right ? sign : 0;
    });
  }
  const limit = url.searchParams.get("limit");
  if (limit) result = result.slice(0, Number(limit));
  return result;
}

function parsePrefer(request: Request): {
  ignoreDuplicates: boolean;
  mergeDuplicates: boolean;
  representation: boolean;
} {
  const prefer = request.headers.get("Prefer") ?? "";
  return {
    ignoreDuplicates: prefer.includes("resolution=ignore-duplicates"),
    mergeDuplicates: prefer.includes("resolution=merge-duplicates"),
    representation: prefer.includes("return=representation"),
  };
}

export class FakeRest {
  private tables = new Map<string, TableSpec>();
  private rpcs = new Map<string, (args: Record<string, unknown>) => unknown>();
  private users = new Map<string, { id: string; email: string }>();

  constructor(private env: Env) {}

  /** Register a table with column defaults applied to every insert. */
  table(name: string, defaults: Row = {}): this {
    this.tables.set(name, { rows: [], defaults });
    return this;
  }

  /** Insert a row directly (test seeding and the RPC simulators). */
  insert(name: string, row: Row): Row {
    const spec = this.tables.get(name);
    if (!spec) throw new Error(`FakeRest: table ${name} not registered`);
    const now = new Date().toISOString();
    const full: Row = {
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
      ...structuredClone(spec.defaults),
      ...structuredClone(row),
    };
    spec.rows.push(full);
    return full;
  }

  rows(name: string): Row[] {
    const spec = this.tables.get(name);
    if (!spec) throw new Error(`FakeRest: table ${name} not registered`);
    return spec.rows;
  }

  rpc(name: string, handler: (args: Record<string, unknown>) => unknown): this {
    this.rpcs.set(name, handler);
    return this;
  }

  /** Register a GoTrue admin user for `auth.admin.getUserById`. */
  user(id: string, email: string): this {
    this.users.set(id, { id, email });
    return this;
  }

  route(): FetchRoute {
    return async (url, request) => {
      if (!url.href.startsWith(this.env.SUPABASE_URL)) return undefined;

      const adminMatch = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
      if (adminMatch && request.method === "GET") {
        const user = this.users.get(adminMatch[1]);
        return user
          ? Response.json(user)
          : Response.json({ message: "user not found" }, { status: 404 });
      }

      const rpcMatch = url.pathname.match(/^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/);
      if (rpcMatch && request.method === "POST") {
        const handler = this.rpcs.get(rpcMatch[1]);
        if (!handler) {
          return Response.json(
            { message: `FakeRest: rpc ${rpcMatch[1]} not registered` },
            { status: 404 },
          );
        }
        const args = (await request
          .clone()
          .json()
          .catch(() => ({}))) as Record<string, unknown>;
        return Response.json(handler(args) ?? null);
      }

      const tableMatch = url.pathname.match(/^\/rest\/v1\/([A-Za-z0-9_]+)$/);
      if (!tableMatch) return undefined;
      const spec = this.tables.get(tableMatch[1]);
      if (!spec) {
        return Response.json(
          { message: `FakeRest: table ${tableMatch[1]} not registered` },
          { status: 500 },
        );
      }

      if (request.method === "GET") {
        const matched = applyOrderAndLimit(
          spec.rows.filter((row) => rowMatches(row, url)),
          url,
        );
        return Response.json(structuredClone(matched));
      }

      if (request.method === "POST") {
        const body = (await request.clone().json()) as Row | Row[];
        const incoming = Array.isArray(body) ? body : [body];
        const prefer = parsePrefer(request);
        const conflictColumns = (url.searchParams.get("on_conflict") ?? "")
          .split(",")
          .filter(Boolean);
        const landed: Row[] = [];
        for (const candidate of incoming) {
          const existing =
            conflictColumns.length > 0
              ? spec.rows.find((row) =>
                  conflictColumns.every(
                    (column) => String(row[column]) === String(candidate[column]),
                  ),
                )
              : undefined;
          if (existing) {
            if (prefer.ignoreDuplicates) continue;
            if (prefer.mergeDuplicates) {
              Object.assign(existing, structuredClone(candidate), {
                updated_at: new Date().toISOString(),
              });
              landed.push(existing);
              continue;
            }
            return Response.json(
              { code: "23505", message: "duplicate key value" },
              { status: 409 },
            );
          }
          landed.push(this.insert(tableMatch[1], candidate));
        }
        return prefer.representation
          ? Response.json(structuredClone(landed), { status: 201 })
          : new Response(null, { status: 201 });
      }

      if (request.method === "PATCH") {
        const patch = (await request.clone().json()) as Row;
        const prefer = parsePrefer(request);
        const matched = spec.rows.filter((row) => rowMatches(row, url));
        for (const row of matched) {
          Object.assign(row, structuredClone(patch), {
            updated_at: new Date().toISOString(),
          });
        }
        return prefer.representation
          ? Response.json(structuredClone(matched))
          : new Response(null, { status: 204 });
      }

      throw new Error(
        `FakeRest: unsupported method ${request.method} on ${url.pathname}`,
      );
    };
  }
}

// ---------------------------------------------------------------------------
// Telnyx endpoint mock
// ---------------------------------------------------------------------------

export interface TelnyxCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type TelnyxHandler = (
  call: TelnyxCall,
  match: RegExpMatchArray,
) => unknown | Response;

export class TelnyxMock {
  calls: TelnyxCall[] = [];
  private handlers: {
    method: string;
    pattern: RegExp;
    handler: TelnyxHandler;
  }[] = [];

  on(method: string, pattern: RegExp, handler: TelnyxHandler): this {
    this.handlers.push({ method, pattern, handler });
    return this;
  }

  callsTo(method: string, pattern: RegExp): TelnyxCall[] {
    return this.calls.filter(
      (call) => call.method === method && pattern.test(call.path),
    );
  }

  route(): FetchRoute {
    return async (url, request) => {
      if (url.origin !== "https://api.telnyx.com") return undefined;
      const body = await request
        .clone()
        .json()
        .catch(() => undefined);
      const call: TelnyxCall = {
        method: request.method,
        path: url.pathname,
        query: url.searchParams,
        body,
      };
      this.calls.push(call);
      for (const entry of this.handlers) {
        if (entry.method !== request.method) continue;
        const match = url.pathname.match(entry.pattern);
        if (!match) continue;
        const result = entry.handler(call, match);
        return result instanceof Response ? result : Response.json(result ?? {});
      }
      return Response.json(
        { errors: [{ code: "test_unhandled", title: `no handler for ${request.method} ${url.pathname}` }] },
        { status: 500 },
      );
    };
  }
}

/** A Telnyx-shaped error response for negative-path handlers. */
export function telnyxError(status: number, code: string, title = "error"): Response {
  return Response.json({ errors: [{ code, title }] }, { status });
}

// ---------------------------------------------------------------------------
// Resend capture (billing's sendEmail is a real fetch to this endpoint)
// ---------------------------------------------------------------------------

export interface SentEmailCapture {
  to: string[];
  subject: string;
  text: string;
  html: string;
  from: string;
}

export function resendRoute(sent: SentEmailCapture[]): FetchRoute {
  return async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    const body = (await request.clone().json()) as SentEmailCapture;
    sent.push(body);
    return Response.json({ id: `email_${sent.length}` });
  };
}
