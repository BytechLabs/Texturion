/**
 * The hermetic call journeys at the session layer, on every push.
 *
 * Every dial a journey counts is made by product code: the real routes a
 * softphone calls (/v1/webrtc/token, /v1/calls/browser,
 * /v1/calls/live/:session/transfer) behind the real auth middleware, the real
 * CallSessionDO with the real initiated contexts (so the ring audience is
 * computeRingContext's, not this file's), the real webhook router and voice
 * path, and the real Telnyx command layer over HTTP to the fake switch in
 * e2e/fake-telnyx-voice.ts.
 *
 * What is faked is the database. An in-memory PostgREST below holds the rows
 * those paths read and answers the RPCs they call the way the migrations do;
 * the session object's other database work (threading, billing, voicemail
 * storage) comes from session-do-fake.ts. e2e/call-journeys.e2e.ts drives the
 * same scripts through the whole Worker against a real database, which is
 * where the SQL itself is proven.
 *
 * Each journey prints a CALL_BUDGET line and must agree with
 * e2e/call-journey-budget.json, which is what the rig's dial budget reads.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

import type { Env } from "../env";
import { dispatchTelnyxEvent } from "../messaging/dispatch";
import type { TelnyxEvent } from "../messaging/types";
import { callsRoutes } from "../routes/calls";
import { liveCallsRoutes } from "../routes/live-calls";
import { webrtcRoutes } from "../routes/webrtc";
import { apiRequest, buildTestApp } from "../test/routes-harness";
import { resetSentryCaptures, sentryCaptures } from "../test/sentry-mock";
import { completeEnv, createTestAuth, type TestAuth } from "../test/support";

import { createCallSessions, type CallSessionsDouble } from "../../e2e/call-sessions";
import {
  CALL_JOURNEYS,
  journeyRegistryMismatch,
  runCallJourney,
  type JourneyCrew,
  type JourneyDriver,
  type JourneyMember,
} from "../../e2e/call-journeys";
import { startFakeTelnyx, type FakeTelnyx } from "../../e2e/fake-telnyx";
import { createSessionRuntime, type SessionRuntime } from "./runtime";
import type { CallSessionDO } from "./session-do";
import { makeRuntime } from "./session-do-fake";

const FAR_END_E164 = "+16135550160";
/** One workspace and line per journey, as the e2e layer seeds them. */
const LINES: Record<string, string> = {
  "inbound-answered": "+16135550150",
  voicemail: "+16135550151",
  "outbound-answered": "+16135550152",
  "transfer-blind": "+16135550153",
};

type Row = Record<string, unknown>;
type Rpc = (args: Row) => unknown;

const NOT_FILTERS = new Set(["select", "limit", "order", "offset", "on_conflict", "columns"]);

function holds(value: unknown, condition: string): boolean {
  const negated = condition.startsWith("not.");
  const test = negated ? condition.slice("not.".length) : condition;
  const dot = test.indexOf(".");
  const operator = test.slice(0, dot);
  const operand = test.slice(dot + 1);
  const text = value === null || value === undefined ? null : String(value);
  let result: boolean;
  if (operator === "is" && operand === "null") {
    result = text === null;
  } else if (text === null) {
    // SQL: comparing a null to anything is null, which no filter admits.
    return false;
  } else if (operator === "eq") {
    result = text === operand;
  } else if (operator === "neq") {
    result = text !== operand;
  } else if (operator === "in") {
    const listed = operand.replace(/^\(|\)$/g, "").split(",");
    result = listed.map((entry) => entry.replace(/^"(.*)"$/, "$1")).includes(text);
  } else if (["gt", "gte", "lt", "lte"].includes(operator)) {
    // Every compared column here is an ISO timestamp, which sorts as text.
    const order = text < operand ? -1 : text > operand ? 1 : 0;
    result = { gt: order > 0, gte: order >= 0, lt: order < 0, lte: order <= 0 }[
      operator as "gt" | "gte" | "lt" | "lte"
    ];
  } else {
    throw new Error(`in-memory PostgREST: unsupported filter ${condition}`);
  }
  return negated ? !result : result;
}

function matches(row: Row, query: URLSearchParams): boolean {
  for (const [column, condition] of query) {
    if (NOT_FILTERS.has(column)) continue;
    if (!holds(row[column], condition)) return false;
  }
  return true;
}

function project(rows: Row[], select: string | null): Row[] {
  if (!select || select === "*") return rows.map((row) => ({ ...row }));
  if (/[(:]/.test(select)) {
    throw new Error(`in-memory PostgREST: unsupported select ${select}`);
  }
  const columns = select.split(",").map((column) => column.trim());
  return rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));
}

function ordered(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const [column, direction] = order.split(",")[0].split(".");
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = String(a[column] ?? "");
    const right = String(b[column] ?? "");
    return left < right ? -sign : left > right ? sign : 0;
  });
}

/**
 * Enough PostgREST for the paths the journeys run. A table or RPC it does not
 * hold is an I/O this layer did not expect: it is recorded and the request
 * fails, so the journey that made it fails too.
 */
function inMemoryPostgrest(tables: Record<string, Row[]>, rpcs: Record<string, Rpc>, surprises: string[]) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    const prefer = request.headers.get("prefer") ?? "";

    if (path.startsWith("rpc/")) {
      const rpc = rpcs[path.slice("rpc/".length)];
      if (!rpc || request.method !== "POST") {
        surprises.push(`${request.method} ${url.pathname}`);
        throw new Error(`in-memory PostgREST: unexpected ${request.method} ${url.pathname}`);
      }
      return Response.json(rpc((await request.json()) as Row));
    }

    const rows = tables[path];
    if (!rows) {
      surprises.push(`${request.method} ${url.pathname}`);
      throw new Error(`in-memory PostgREST: unexpected ${request.method} ${url.pathname}`);
    }
    const select = url.searchParams.get("select");
    const representation = prefer.includes("return=representation");

    if (request.method === "GET" || request.method === "HEAD") {
      const found = ordered(rows.filter((row) => matches(row, url.searchParams)), url.searchParams.get("order"));
      const limited = found.slice(0, Number(url.searchParams.get("limit") ?? Infinity));
      const headers = prefer.includes("count=") ? { "content-range": `0-${limited.length}/${found.length}` } : undefined;
      return request.method === "HEAD"
        ? new Response(null, { status: 200, headers })
        : Response.json(project(limited, select), { headers });
    }
    if (request.method === "POST") {
      const body = (await request.json()) as Row | Row[];
      const conflict = (url.searchParams.get("on_conflict") ?? "").split(",").filter(Boolean);
      const ignore = prefer.includes("ignore-duplicates");
      const written: Row[] = [];
      for (const incoming of Array.isArray(body) ? body : [body]) {
        const existing = conflict.length > 0
          ? rows.find((row) => conflict.every((column) => row[column] === incoming[column]))
          : undefined;
        if (existing) {
          if (!ignore) {
            Object.assign(existing, incoming);
            written.push(existing);
          }
          continue;
        }
        const created = { created_at: new Date().toISOString(), ...incoming };
        rows.push(created);
        written.push(created);
      }
      return representation
        ? Response.json(project(written, select), { status: 201 })
        : new Response(null, { status: 201 });
    }
    if (request.method === "PATCH") {
      const body = (await request.json()) as Row;
      const updated = rows.filter((row) => matches(row, url.searchParams));
      for (const row of updated) Object.assign(row, body);
      return representation ? Response.json(project(updated, select)) : new Response(null, { status: 204 });
    }
    if (request.method === "DELETE") {
      const kept = rows.filter((row) => !matches(row, url.searchParams));
      rows.splice(0, rows.length, ...kept);
      return new Response(null, { status: 204 });
    }
    throw new Error(`in-memory PostgREST: unsupported method ${request.method}`);
  };
}

/** The rows a journey's paths touch. Seeded workspaces outlive a test; calls do not. */
const tables = {
  companies: [] as Row[],
  company_members: [] as Row[],
  phone_numbers: [] as Row[],
  member_telephony_credentials: [] as Row[],
  notification_prefs: [] as Row[],
  push_subscriptions: [] as Row[],
  device_push_tokens: [] as Row[],
  calls: [] as Row[],
  call_member_legs: [] as Row[],
  outbound_call_authorizations: [] as Row[],
};

const OUTBOUND_HOLD_MS = 30_000;
const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

function sessionRow(sessionId: string): Row | undefined {
  return tables.calls.find((row) => row.call_session_id === sessionId);
}

function numberRow(phoneNumberId: unknown): Row | undefined {
  return tables.phone_numbers.find((row) => row.id === phoneNumberId);
}

function activeMembers(companyId: unknown): Row[] {
  return tables.company_members.filter(
    (row) => row.company_id === companyId && row.deactivated_at === null,
  );
}

function newCallRow(values: Row): Row {
  return {
    state: null,
    outcome: null,
    answered_at: null,
    answered_by_user_id: null,
    customer_call_control_id: null,
    conversation_id: null,
    created_at: new Date().toISOString(),
    ...values,
  };
}

/** The line rule the claim RPCs share: a live call, or an outbound hold from the last 30 s. */
function lineBusy(phoneNumberId: unknown, since: string, exceptSession?: unknown): boolean {
  const liveCall = tables.calls.some(
    (row) =>
      row.phone_number_id === phoneNumberId &&
      row.outcome === null &&
      !String(row.state ?? "").startsWith("ended_") &&
      row.call_session_id !== exceptSession &&
      String(row.created_at) >= since,
  );
  const held = tables.outbound_call_authorizations.some(
    (row) => row.phone_number_id === phoneNumberId && String(row.created_at) > isoAgo(OUTBOUND_HOLD_MS),
  );
  return liveCall || held;
}

/** The RPCs the journeys call, answered as their latest migrations answer them. */
const rpcs: Record<string, Rpc> = {
  api_authorize_request({ p_user_id, p_company_id }) {
    const member = activeMembers(p_company_id).find((row) => row.user_id === p_user_id);
    return {
      session_revoked: false,
      session_new: false,
      member: member ? { id: member.id, role: member.role } : null,
      mfa: { required: false, grace_until: null, enforcing: false, enrolled: false },
    };
  },
  // Nothing said about any flag: every key resolves to its code default.
  api_evaluate_flags: () => ({}),
  // No number access rules anywhere, so every member has full use of every line.
  member_number_levels: ({ p_company_id }) =>
    tables.phone_numbers
      .filter((row) => row.company_id === p_company_id)
      .map((row) => ({ phone_number_id: row.id, level: "text" })),
  member_number_level({ p_user_id, p_phone_number_id }) {
    const number = numberRow(p_phone_number_id);
    const member = activeMembers(number?.company_id).find((row) => row.user_id === p_user_id);
    return member ? "text" : "none";
  },
  number_member_levels: ({ p_phone_number_id }) =>
    activeMembers(numberRow(p_phone_number_id)?.company_id).map((row) => ({
      user_id: row.user_id,
      role: row.role,
      level: "text",
    })),
  api_period_forward_seconds: () => 0,
  api_period_forwarded_calls: () => 0,
  api_claim_inbound_line(args) {
    const busy = lineBusy(args.p_phone_number_id, String(args.p_window_start), args.p_call_session_id);
    const existing = sessionRow(String(args.p_call_session_id));
    if (existing) {
      existing.caller_e164 ??= args.p_caller_e164;
      existing.phone_number_id ??= args.p_phone_number_id;
    } else {
      tables.calls.push(newCallRow({
        company_id: args.p_company_id,
        phone_number_id: args.p_phone_number_id,
        call_session_id: args.p_call_session_id,
        caller_e164: args.p_caller_e164,
        direction: "inbound",
      }));
    }
    return busy;
  },
  api_claim_outbound_line(args) {
    if (lineBusy(args.p_phone_number_id, String(args.p_window_start))) return false;
    tables.outbound_call_authorizations.push({
      nonce: args.p_nonce,
      company_id: args.p_company_id,
      phone_number_id: args.p_phone_number_id,
      from_e164: args.p_from,
      customer_e164: args.p_customer,
      call_session_id: args.p_call_session_id,
      user_id: args.p_user_id,
      created_at: new Date().toISOString(),
    });
    return true;
  },
  api_authorize_outbound_call(args) {
    const index = tables.outbound_call_authorizations.findIndex(
      (row) =>
        row.nonce === args.p_nonce &&
        row.from_e164 === args.p_from &&
        String(row.created_at) > isoAgo(Number(args.p_max_age_secs) * 1000),
    );
    if (index < 0) {
      const row = sessionRow(String(args.p_call_session_id));
      if (!row || row.direction !== "outbound" || numberRow(row.phone_number_id)?.number_e164 !== args.p_from) {
        return { authorized: false };
      }
      return {
        authorized: true,
        company_id: row.company_id,
        phone_number_id: row.phone_number_id,
        replay: true,
        session_id: args.p_call_session_id,
        user_id: row.answered_by_user_id,
      };
    }
    const [authorization] = tables.outbound_call_authorizations.splice(index, 1);
    const sessionId = authorization.call_session_id ?? args.p_call_session_id;
    if (lineBusy(authorization.phone_number_id, isoAgo(4 * 60 * 60_000), sessionId)) {
      return { authorized: false, line_busy: true };
    }
    if (!sessionRow(String(sessionId))) {
      tables.calls.push(newCallRow({
        company_id: authorization.company_id,
        phone_number_id: authorization.phone_number_id,
        call_session_id: sessionId,
        caller_e164: args.p_customer,
        direction: "outbound",
      }));
    }
    return {
      authorized: true,
      company_id: authorization.company_id,
      phone_number_id: authorization.phone_number_id,
      replay: false,
      session_id: sessionId,
      user_id: authorization.user_id,
    };
  },
};

interface SeededCrew extends JourneyCrew {
  companyId: string;
  phoneNumberId: string;
}

let fake: FakeTelnyx;
let env: Env;
let auth: TestAuth;
let sessions: CallSessionsDouble;
let surprises: string[];
/** What each session object's database half was handed, by session id. */
let dbHalves: Map<string, ReturnType<typeof makeRuntime>["calls"]>;
const crews = new Map<string, SeededCrew>();
const app = buildTestApp(callsRoutes, liveCallsRoutes, webrtcRoutes);

/** The runtime one session object runs: real Telnyx commands and initiated contexts, faked database half. */
function runtimeFor(sessionId: string): SessionRuntime {
  const real = createSessionRuntime(env);
  const { runtime: dbHalf, calls } = makeRuntime({});
  dbHalves.set(sessionId, calls);
  return {
    ...dbHalf,
    now: real.now,
    uuid: real.uuid,
    telnyx: real.telnyx,
    buildClientStates: real.buildClientStates,
    greetingText: real.greetingText,
    loadInitiatedContext: real.loadInitiatedContext,
    loadOutboundInitiatedContext: real.loadOutboundInitiatedContext,
    async mirror(id, set) {
      await dbHalf.mirror(id, set);
      await real.mirror(id, set);
    },
  };
}

function stub(sessionId: string): CallSessionDO {
  const namespace = env.CALL_SESSIONS as DurableObjectNamespace;
  return namespace.get(namespace.idFromName(sessionId)) as unknown as CallSessionDO;
}

async function as(member: JourneyMember, crew: JourneyCrew, path: string, body?: unknown) {
  return apiRequest(app, env, await auth.token({ subject: member.userId }), path, {
    companyId: (crew as SeededCrew).companyId,
    method: "POST",
    body,
  });
}

const driver = (): JourneyDriver => ({
  voice: fake.voice,
  // The edge's dispatch minus its ledger: DO-owned events are admitted and
  // awaited, the transfer legs run on the shared voice path.
  deliver: (event) => dispatchTelnyxEvent(env, event as unknown as TelnyxEvent),
  idle: () => sessions.idle(),
  async state(sessionId) {
    return (await stub(sessionId).snapshot(sessionId))?.state ?? null;
  },
  async answeredBy(sessionId) {
    return (await stub(sessionId).snapshot(sessionId))?.answered_by_user_id ?? null;
  },
  async placeCall(crew, placer) {
    const placed = await as(placer, crew, "/v1/calls/browser", {
      to: crew.farEndE164,
      phone_number_id: (crew as SeededCrew).phoneNumberId,
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    return ((await placed.json()) as { call_session_id: string }).call_session_id;
  },
  async transfer(crew, sessionId, sender, target) {
    const transferred = await as(sender, crew, `/v1/calls/live/${sessionId}/transfer`, {
      target_user_id: target.userId,
    });
    expect(transferred.status, await transferred.clone().text()).toBe(202);
  },
});

/**
 * A workspace on an active plan with one line and `size` members, the first
 * its owner, each holding a softphone credential minted through the route.
 */
async function seedCrew(journey: string, size: number): Promise<SeededCrew> {
  const companyId = randomUUID();
  const phoneNumberId = randomUUID();
  const createdAt = new Date().toISOString();
  tables.companies.push({
    id: companyId,
    name: `Journey ${journey}`,
    plan: "starter",
    current_period_start: createdAt,
    overage_cap_multiplier: "3.00",
    subscription_status: "active",
    paused_at: null,
    locale: null,
    call_screening: "flag",
    voicemail_greeting: null,
    timezone: null,
    business_hours: null,
    business_hours_exceptions: null,
    after_hours_calls: "ring_everyone",
    after_hours_greeting_id: null,
    ring_strategy: "all",
    ring_seconds: 45,
    created_at: createdAt,
  });
  tables.phone_numbers.push({
    id: phoneNumberId,
    company_id: companyId,
    status: "active",
    number_e164: LINES[journey],
    label: null,
    voicemail_greeting: null,
    timezone: null,
    business_hours: null,
    business_hours_exceptions: null,
    after_hours_calls: null,
    after_hours_greeting_id: null,
    ring_strategy: null,
    ring_seconds: null,
    created_at: createdAt,
  });
  const userIds = Array.from({ length: size }, () => randomUUID());
  userIds.forEach((userId, index) => {
    tables.company_members.push({
      id: randomUUID(),
      company_id: companyId,
      user_id: userId,
      role: index === 0 ? "owner" : "member",
      deactivated_at: null,
      created_at: new Date(Date.parse(createdAt) + index).toISOString(),
    });
  });

  const crew: SeededCrew = {
    businessE164: LINES[journey],
    farEndE164: FAR_END_E164,
    members: [],
    companyId,
    phoneNumberId,
  };
  for (const userId of userIds) {
    const minted = await as({ userId, sipUsername: "" }, crew, "/v1/webrtc/token");
    expect(minted.status, await minted.clone().text()).toBe(200);
    const { sip_username: sipUsername } = (await minted.json()) as { sip_username: string };
    crew.members.push({ userId, sipUsername });
  }
  return crew;
}

beforeAll(async () => {
  fake = await startFakeTelnyx();
  const realFetch = globalThis.fetch.bind(globalThis);
  env = { ...completeEnv(), TELNYX_API_BASE: fake.origin };
  sessions = createCallSessions(env, { runtimeFor });
  // Bound before anything reads the environment, which validates it once per object.
  env.CALL_SESSIONS = sessions.namespace;
  auth = await createTestAuth(env);
  surprises = [];
  const postgrest = inMemoryPostgrest(tables, rpcs, surprises);
  const supabaseOrigin = new URL(env.SUPABASE_URL).origin;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const url = new URL(request.url);
    if (url.origin === fake.origin) return realFetch(request);
    if (url.href === auth.jwksUrl) return Response.json({ keys: [auth.jwk] });
    if (url.origin === supabaseOrigin) return postgrest(request);
    throw new Error(`call journeys: unexpected fetch ${request.method} ${url.href}`);
  });

  dbHalves = new Map();
  for (const [journey, spec] of Object.entries(CALL_JOURNEYS)) {
    crews.set(journey, await seedCrew(journey, spec.crewSize));
  }
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await fake.close();
});

beforeEach(() => {
  fake.reset();
  dbHalves = new Map();
  tables.calls.length = 0;
  tables.call_member_legs.length = 0;
  tables.outbound_call_authorizations.length = 0;
  resetSentryCaptures();
});

function crewFor(journey: string): SeededCrew {
  const crew = crews.get(journey);
  if (!crew) throw new Error(`no crew seeded for ${journey}`);
  return crew;
}

/** Nothing on the path reported a fault or touched a table this layer does not hold. */
function expectQuietSession(sessionId: string) {
  expect(surprises, "requests the in-memory database could not answer").toEqual([]);
  const half = dbHalves.get(sessionId);
  expect(half, `session object ${sessionId} was created`).toBeDefined();
  expect(half?.sentryWarns).toEqual([]);
  expect(half?.sentryErrors).toBe(0);
  expect(sentryCaptures.map((capture) => capture.message)).toEqual([]);
  return half as NonNullable<typeof half>;
}

describe("hermetic call journeys (session layer)", () => {
  it("runs every journey the budget file prices, and has a line for each", () => {
    expect(journeyRegistryMismatch()).toEqual([]);
    expect(Object.keys(LINES).sort()).toEqual(Object.keys(CALL_JOURNEYS).sort());
  });

  it("minted one softphone credential per member through the route, on the WebRTC connection", () => {
    const members = [...crews.values()].flatMap((crew) => crew.members);
    expect(tables.member_telephony_credentials.map((row) => row.sip_username).sort()).toEqual(
      members.map((member) => member.sipUsername).sort(),
    );
    for (const member of members) {
      const credential = fake.voice.credentialForSipUsername(member.sipUsername);
      expect(credential?.connectionId).toBe(env.TELNYX_WEBRTC_CONNECTION_ID);
      expect(credential?.tokensIssued).toBe(1);
    }
    expect(surprises).toEqual([]);
  });

  it("S02 inbound answered: one ring leg, bridged, billed once", async () => {
    const crew = crewFor("inbound-answered");
    const { sessionId } = await runCallJourney("inbound-answered", "session", driver(), crew);
    const half = expectQuietSession(sessionId);
    expect(half.mirrors.map((set) => set.state).filter(Boolean)).toEqual([
      "ringing",
      "answered",
      "ended_answered",
    ]);
    expect(half.terminalMerges).toEqual(["event"]);
    expect(fake.callsTo("POST", /\/actions\/bridge$/)).toHaveLength(1);
    expect(sessionRow(sessionId)).toMatchObject({
      direction: "inbound",
      company_id: crew.companyId,
      state: "ended_answered",
      outcome: "answered",
    });
  });

  it("S04 voicemail: the ring times out, the greeting plays, the message is handed on", async () => {
    const crew = crewFor("voicemail");
    const { sessionId } = await runCallJourney("voicemail", "session", driver(), crew);
    const half = expectQuietSession(sessionId);
    expect(half.voicemailPipelines).toBe(1);
    expect(half.mirrors.map((set) => set.state).filter(Boolean)).toEqual([
      "ringing",
      "voicemail_greeting",
      "voicemail_recording",
      "ended_missed",
      "ended_voicemail",
    ]);
    const recordStart = fake.callsTo("POST", /\/actions\/record_start$/);
    expect(recordStart).toHaveLength(1);
    expect(recordStart[0].body).toMatchObject({ format: "mp3", play_beep: true });
  });

  it("S01 outbound answered: the route dials the customer, the session rings the placer, bridged", async () => {
    const crew = crewFor("outbound-answered");
    const [placer] = crew.members;
    const { sessionId } = await runCallJourney("outbound-answered", "session", driver(), crew);
    const half = expectQuietSession(sessionId);
    expect(half.terminalMergeEventOpts.at(-1)?.outboundSessionId).toBe(sessionId);
    expect(tables.outbound_call_authorizations, "the nonce was consumed").toEqual([]);
    const dials = fake.callsTo("POST", /^\/v2\/calls$/);
    expect(dials.map((dial) => (dial.body as { to: string }).to)).toEqual([
      FAR_END_E164,
      `sip:${placer.sipUsername}@sip.telnyx.com`,
    ]);
    const customer = fake.voice.legs().find((leg) => leg.origin === "dial" && leg.to === FAR_END_E164);
    expect(sessionRow(sessionId)).toMatchObject({
      direction: "outbound",
      company_id: crew.companyId,
      customer_call_control_id: customer?.callControlId,
      state: "ended_answered",
    });
  });

  it("S07 blind transfer: the target rings on the customer leg and becomes the owner", async () => {
    const crew = crewFor("transfer-blind");
    const [owner, technician] = crew.members;
    const { sessionId } = await runCallJourney("transfer-blind", "session", driver(), crew);
    const half = expectQuietSession(sessionId);
    const owners = half.mirrors
      .filter((set) => "answered_by_user_id" in set)
      .map((set) => set.answered_by_user_id);
    expect([...new Set(owners)], "the owner hands the call to the target").toEqual([
      owner.userId,
      technician.userId,
    ]);
    expect(owners.at(-1)).toBe(technician.userId);
    const target = fake.voice.legs().find((leg) => leg.origin === "transfer");
    expect(tables.call_member_legs).toEqual([
      expect.objectContaining({
        call_session_id: sessionId,
        call_control_id: target?.callControlId,
        user_id: technician.userId,
        kind: "transfer",
        state: "answered",
      }),
    ]);
    expect(sessionRow(sessionId)?.answered_by_user_id).toBe(technician.userId);
    const transfers = fake.callsTo("POST", /\/actions\/transfer$/);
    expect(transfers).toHaveLength(1);
    expect(transfers[0].body).toMatchObject({
      to: `sip:${technician.sipUsername}@sip.telnyx.com`,
      from: FAR_END_E164,
    });
    // The customer leg keeps its billing tag: the command carries none.
    expect(transfers[0].body).not.toHaveProperty("client_state");
  });
});
