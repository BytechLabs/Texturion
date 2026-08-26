/**
 * #251 -- an explicitly authorized driver for a DEPLOYED NON-PRODUCTION stack.
 *
 * This file deliberately lives under scripts rather than src. It is operator
 * tooling, never bundled into the production Worker. The local load harnesses
 * stay loopback-only; this is a different command with a stronger ceremony:
 * known production targets are denied, a target-bound confirmation is exact,
 * short-lived user credentials must belong to the supplied Supabase project,
 * and both the API hot path and private Realtime topic must pass preflight
 * before a ramp begins.
 *
 * Results are aggregate-only. Response bodies are consumed and discarded;
 * tokens, URLs, tenant ids, topics, subjects, and the operator's target label
 * are rejected if they ever appear in a CAPACITY_RESULT record.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";

export const CAPACITY_RESULT_PREFIX = "CAPACITY_RESULT ";

const PRODUCTION_API_HOSTS = new Set([
  "loonext.com",
  "www.loonext.com",
  "api.loonext.com",
  "app.loonext.com",
  "blog.loonext.com",
  "status.loonext.com",
  // #578 records these as the production Workers' historical second origins.
  // They are configured off now, but a future dashboard/config regression must
  // never turn this load driver into the first thing to discover one is live.
  "loonext-api.hayaturehmanahmadzai.workers.dev",
  "loonext-web.hayaturehmanahmadzai.workers.dev",
]);

/** Public by design: it ships in the Android app as NEXT_PUBLIC_SUPABASE_URL. */
export const PRODUCTION_SUPABASE_HOST = "qoruyuxcgkdqpcgclgzs.supabase.co";

const NONPROD_MARKER = /(?:^|[.-])(staging|nonprod|test|preview|capacity)(?:[.-]|$)/i;
const TARGET_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_TOKEN_VALIDITY_SECONDS = 10 * 60;
const TOKEN_EXPIRY_BUFFER_SECONDS = 2 * 60;
const MAX_CONCURRENCY = 500;
const MAX_LEVELS = 12;
const MAX_API_ROUNDS = 10;
const MIN_DEADLINE_MS = 1_000;
const MAX_DEADLINE_MS = 60_000;
const MIN_DWELL_MS = 1_000;
const MAX_DWELL_MS = 30_000;
const DEADLINE_SCHEDULING_TOLERANCE_MS = 100;

export type HostedScenario = "api" | "realtime" | "all";

export interface HostedCapacityInput {
  targetId: string;
  apiOrigin: string;
  supabaseOrigin: string;
  companyId: string;
  confirmation: string;
  accessToken: string;
  supabasePublishableKey: string;
  scenario: HostedScenario;
  apiRamp: number[];
  realtimeRamp: number[];
  apiRounds: number;
  deadlineMs: number;
  dwellMs: number;
}

interface AccessClaims {
  issuer: string;
  subject: string;
  expiresAt: number;
  role: string;
}

export interface HostedCapacityConfig extends HostedCapacityInput {
  apiOrigin: string;
  supabaseOrigin: string;
  targetFingerprint: string;
  topic: string;
  sensitiveValues: string[];
}

export interface CapacityEvidence {
  schema: "loonext.capacity.v1";
  scenario: "hosted-api-pooler-ramp" | "hosted-realtime-connection-ramp";
  environment: "deployed-nonproduction";
  tested_bound: Record<string, number | string>;
  ceiling_reached: boolean;
  measurements: Record<string, unknown>;
  notes: string[];
}

export class CapacityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapacityConfigError";
  }
}

export class CapacityRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapacityRunError";
  }
}

export type ApiOutcomeStatus = number | "deadline" | "network_error" | "redirect";

export interface ApiOutcome {
  status: ApiOutcomeStatus;
  ms: number;
}

export type RealtimeConnectionState =
  | "subscribed"
  | "channel_error"
  | "timed_out"
  | "closed"
  | "deadline"
  | "network_error";

export type RealtimeTerminalState = "channel_error" | "timed_out" | "closed";

export interface RealtimeStateSnapshot {
  current: RealtimeConnectionState;
  postJoinTerminalEvents: Record<RealtimeTerminalState, number>;
}

export interface RealtimeTransitionState {
  current: RealtimeConnectionState | "connecting";
  subscribedOnce: boolean;
  postJoinTerminalEvents: Record<RealtimeTerminalState, number>;
}

export interface RealtimeConnection {
  joinedMs: number;
  snapshot(): RealtimeStateSnapshot;
  close(): Promise<void>;
}

export interface OpenRealtimeInput {
  supabaseOrigin: string;
  publishableKey: string;
  accessToken: string;
  topic: string;
  deadlineMs: number;
}

export type OpenRealtimeConnection = (
  input: OpenRealtimeInput,
) => Promise<RealtimeConnection>;

export class RealtimeJoinFailure extends Error {
  readonly code: Exclude<RealtimeConnectionState, "subscribed">;

  constructor(code: Exclude<RealtimeConnectionState, "subscribed">) {
    super("Realtime connection did not subscribe");
    this.name = "RealtimeJoinFailure";
    this.code = code;
  }
}

export class RealtimeCleanupFailure extends CapacityRunError {
  constructor() {
    super("Realtime cleanup did not complete successfully");
    this.name = "RealtimeCleanupFailure";
  }
}

export interface HostedCapacityDependencies {
  fetch?: typeof globalThis.fetch;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  openRealtime?: OpenRealtimeConnection;
  onEvidence?: (evidence: CapacityEvidence) => void;
}

function fail(message: string): never {
  throw new CapacityConfigError(message);
}

function normalizeOrigin(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(`${label} must be an absolute HTTPS origin`);
  }

  if (url.protocol !== "https:") fail(`${label} must use HTTPS`);
  if (url.hostname.endsWith(".")) fail(`${label} must use a canonical hostname without a trailing dot`);
  if (url.username || url.password) fail(`${label} must not contain credentials`);
  if (url.port) fail(`${label} must use the default HTTPS port`);
  if (url.pathname !== "/" || url.search || url.hash) {
    fail(`${label} must be an origin with no path, query, or fragment`);
  }
  if (isLocalOrPrivateHost(url.hostname)) {
    fail(`${label} must be a deployed non-production host, not loopback or a private address`);
  }
  return url;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^(fc|fd)[0-9a-f]{2}:/i.test(host) ||
    /^fe[89ab][0-9a-f]*:/i.test(host)
  ) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return isPrivateV4(v4.slice(1).map(Number));

  // URL canonicalizes ::ffff:127.0.0.1 to ::ffff:7f00:1. Recover the
  // embedded IPv4 bytes before deciding; otherwise an IPv4-mapped loopback or
  // RFC1918 target would bypass the ordinary dotted-address guard.
  if (isIP(host) === 6 && host.startsWith("::ffff:")) {
    const words = host.slice("::ffff:".length).split(":");
    if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/i.test(word))) {
      const high = Number.parseInt(words[0], 16);
      const low = Number.parseInt(words[1], 16);
      return isPrivateV4([high >>> 8, high & 0xff, low >>> 8, low & 0xff]);
    }
  }
  return false;
}

function isPrivateV4(parts: number[]): boolean {
  if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function guardApiHost(hostname: string): void {
  const host = hostname.toLowerCase();
  if (PRODUCTION_API_HOSTS.has(host)) {
    fail("the live Loonext API/web hosts are permanently refused");
  }
  if (host.endsWith(".loonext.com") && !NONPROD_MARKER.test(host)) {
    fail("a Loonext-zone target must carry an explicit non-production marker in its hostname");
  }
}

function guardSupabaseHost(hostname: string): void {
  const host = hostname.toLowerCase();
  if (host === PRODUCTION_SUPABASE_HOST) {
    fail("the live Loonext Supabase project is permanently refused");
  }
}

function parseJwtPayload(token: string, label: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) fail(`${label} must be a JWT`);
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      fail(`${label} has an invalid JWT payload`);
    }
    return decoded as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof CapacityConfigError) throw cause;
    fail(`${label} has an invalid JWT payload`);
  }
}

function validateAccessToken(
  token: string,
  expectedIssuer: string,
  nowSeconds: number,
  requiredValiditySeconds: number,
): AccessClaims {
  const payload = parseJwtPayload(token, "each access token");
  const issuer = typeof payload.iss === "string" ? payload.iss.replace(/\/$/, "") : "";
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  const role = typeof payload.role === "string" ? payload.role : "";
  const expiresAt = typeof payload.exp === "number" ? payload.exp : 0;

  if (issuer !== expectedIssuer) {
    fail("every access token issuer must match the supplied non-production Supabase origin");
  }
  if (!subject || role !== "authenticated") {
    fail("every access token must be a short-lived authenticated user token");
  }
  if (expiresAt < nowSeconds + requiredValiditySeconds) {
    fail(
      `the access token must remain valid for at least ${Math.ceil(requiredValiditySeconds / 60)} minutes for the selected ramp`,
    );
  }
  return { issuer, subject, expiresAt, role };
}

function validatePublishableKey(key: string): void {
  if (key.startsWith("sb_secret_")) {
    fail("a Supabase secret key is forbidden; use the non-production publishable key");
  }
  if (key.startsWith("sb_publishable_") && key.length >= 24) return;

  const payload = parseJwtPayload(key, "the Supabase publishable key");
  if (payload.role !== "anon") {
    fail("the Supabase key must be publishable/anon, never service_role");
  }
}

export function expectedConfirmation(input: {
  targetId: string;
  apiOrigin: string;
  supabaseOrigin: string;
}): string {
  const api = normalizeOrigin(input.apiOrigin, "--api-origin");
  const supabase = normalizeOrigin(input.supabaseOrigin, "--supabase-origin");
  return (
    `I_AUTHORIZE_NONPRODUCTION_CAPACITY_LOAD:${input.targetId}:` +
    `${api.hostname.toLowerCase()}:${supabase.hostname.toLowerCase()}`
  );
}

export function parseRamp(raw: string, label: string): number[] {
  const values = raw.split(",").map((part) => Number(part.trim()));
  validateRamp(values, label);
  return values;
}

function validateRamp(values: number[], label: string): void {
  if (
    values.length === 0 ||
    values.length > MAX_LEVELS ||
    values.some((value) => !Number.isInteger(value) || value < 1 || value > MAX_CONCURRENCY)
  ) {
    fail(`${label} must be 1-${MAX_LEVELS} increasing integers between 1 and ${MAX_CONCURRENCY}`);
  }
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      fail(`${label} must be strictly increasing`);
    }
  }
}

function requiredTokenValiditySeconds(input: HostedCapacityInput): number {
  // Every group is concurrent, but groups/rounds/levels are sequential. Use
  // the full deadline for each sequential boundary, then retain a two-minute
  // operator/network buffer. A 401 halfway through a maximum ramp must never be
  // mistaken for a capacity refusal.
  let worstCaseMs = 2 * input.deadlineMs; // /health + authenticated hot-path preflights
  if (input.scenario === "api" || input.scenario === "all") {
    worstCaseMs += input.apiRamp.length * input.apiRounds * input.deadlineMs;
    // At most one suspect level is confirmed. The driver cools down, proves a
    // one-request baseline, cools down again, and repeats the whole suspect
    // wave before it is allowed to call anything a ceiling.
    worstCaseMs +=
      2 * input.dwellMs + input.deadlineMs + input.apiRounds * input.deadlineMs;
  }
  if (input.scenario === "realtime" || input.scenario === "all") {
    worstCaseMs += 2 * input.deadlineMs; // private-topic join + bounded probe close
    worstCaseMs += input.realtimeRamp.length * (input.deadlineMs + input.dwellMs);
    // A suspect cumulative join wave is reset and checked against a healthy
    // one-connection baseline before the full target concurrency is repeated.
    // Cleanup/open/close operations are concurrent within each group.
    worstCaseMs += 5 * input.deadlineMs + 4 * input.dwellMs;
    worstCaseMs += input.deadlineMs; // final bounded teardown
  }
  return Math.max(
    MIN_TOKEN_VALIDITY_SECONDS,
    Math.ceil(worstCaseMs / 1_000) + TOKEN_EXPIRY_BUFFER_SECONDS,
  );
}

export function validateHostedCapacityInput(
  input: HostedCapacityInput,
  nowSeconds = Math.floor(Date.now() / 1_000),
): HostedCapacityConfig {
  if (!TARGET_ID.test(input.targetId) || !NONPROD_MARKER.test(input.targetId)) {
    fail("--target-id must be a safe slug containing staging, nonprod, test, preview, or capacity");
  }
  if (!UUID.test(input.companyId)) {
    fail("LOONEXT_CAPACITY_COMPANY_ID must be a UUID for a seeded non-production company");
  }
  if (!(["api", "realtime", "all"] as string[]).includes(input.scenario)) {
    fail("--scenario must be api, realtime, or all");
  }
  if (
    !Number.isInteger(input.apiRounds) ||
    input.apiRounds < 1 ||
    input.apiRounds > MAX_API_ROUNDS
  ) {
    fail(`--api-rounds must be between 1 and ${MAX_API_ROUNDS}`);
  }
  if (
    !Number.isInteger(input.deadlineMs) ||
    input.deadlineMs < MIN_DEADLINE_MS ||
    input.deadlineMs > MAX_DEADLINE_MS
  ) {
    fail(`--deadline-ms must be between ${MIN_DEADLINE_MS} and ${MAX_DEADLINE_MS}`);
  }
  if (
    !Number.isInteger(input.dwellMs) ||
    input.dwellMs < MIN_DWELL_MS ||
    input.dwellMs > MAX_DWELL_MS
  ) {
    fail(`--dwell-ms must be between ${MIN_DWELL_MS} and ${MAX_DWELL_MS}`);
  }
  validateRamp(input.apiRamp, "--api-ramp");
  validateRamp(input.realtimeRamp, "--realtime-ramp");

  const apiUrl = normalizeOrigin(input.apiOrigin, "--api-origin");
  const supabaseUrl = normalizeOrigin(input.supabaseOrigin, "--supabase-origin");
  guardApiHost(apiUrl.hostname);
  guardSupabaseHost(supabaseUrl.hostname);
  if (apiUrl.hostname.toLowerCase() === supabaseUrl.hostname.toLowerCase()) {
    fail("API and Supabase origins must be distinct deployed services");
  }

  const confirmation = expectedConfirmation({
    targetId: input.targetId,
    apiOrigin: apiUrl.origin,
    supabaseOrigin: supabaseUrl.origin,
  });
  if (input.confirmation !== confirmation) {
    fail(`set LOONEXT_CAPACITY_CONFIRM exactly to: ${confirmation}`);
  }

  validatePublishableKey(input.supabasePublishableKey);
  const expectedIssuer = `${supabaseUrl.origin}/auth/v1`;
  const claims = validateAccessToken(
    input.accessToken,
    expectedIssuer,
    nowSeconds,
    requiredTokenValiditySeconds(input),
  );
  const topic = `company:${input.companyId}`;
  const targetFingerprint = createHash("sha256")
    .update(`${input.targetId}\n${apiUrl.origin}\n${supabaseUrl.origin}`)
    .digest("hex")
    .slice(0, 16);

  return {
    ...input,
    apiOrigin: apiUrl.origin,
    supabaseOrigin: supabaseUrl.origin,
    targetFingerprint,
    topic,
    sensitiveValues: [
      input.targetId,
      input.companyId,
      input.confirmation,
      apiUrl.origin,
      apiUrl.hostname,
      supabaseUrl.origin,
      supabaseUrl.hostname,
      topic,
      input.supabasePublishableKey,
      input.accessToken,
      claims.subject,
    ],
  };
}

function elapsed(started: number, nowMs: () => number): number {
  return Math.max(0, Math.round(nowMs() - started));
}

export async function performBoundedGet(
  fetcher: typeof globalThis.fetch,
  url: string,
  accessToken: string | undefined,
  companyId: string | undefined,
  deadlineMs: number,
  nowMs: () => number = () => performance.now(),
): Promise<ApiOutcome> {
  const started = nowMs();
  const controller = new AbortController();
  const DEADLINE = Symbol("deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (companyId) headers["X-Company-Id"] = companyId;

  const request = fetcher(url, {
    method: "GET",
    headers,
    // Inspect but never follow redirects. A redirect means the fixed target is
    // invalid, not that capacity has been exhausted.
    redirect: "manual",
    signal: controller.signal,
  })
    .then(async (response) => {
      await response.arrayBuffer();
      if (response.status >= 300 && response.status < 400) return "redirect" as const;
      return response.status;
    })
    .catch(() => "network_error" as const);

  try {
    const deadline = new Promise<typeof DEADLINE>((resolve) => {
      timer = setTimeout(() => resolve(DEADLINE), deadlineMs);
    });
    const result = await Promise.race([request, deadline]);
    if (result === DEADLINE) {
      controller.abort();
      return { status: "deadline", ms: elapsed(started, nowMs) };
    }
    return { status: result, ms: elapsed(started, nowMs) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

function summarizeApi(outcomes: ApiOutcome[]): Record<string, unknown> {
  const statuses: Record<string, number> = {};
  const timings: number[] = [];
  for (const outcome of outcomes) {
    const key = String(outcome.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
    if (typeof outcome.status === "number") timings.push(outcome.ms);
  }
  timings.sort((a, b) => a - b);
  return {
    statuses,
    successful_responses: outcomes.filter(
      (outcome) => typeof outcome.status === "number" && outcome.status >= 200 && outcome.status < 300,
    ).length,
    deadline_timeouts: statuses.deadline ?? 0,
    network_errors: statuses.network_error ?? 0,
    redirects: statuses.redirect ?? 0,
    p50_ms: percentile(timings, 0.5),
    p95_ms: percentile(timings, 0.95),
    p99_ms: percentile(timings, 0.99),
    max_ms: timings.length > 0 ? timings[timings.length - 1] : 0,
  };
}

function apiHasOrdinaryClientFailure(outcomes: ApiOutcome[]): boolean {
  return outcomes.some(
    (outcome) =>
      typeof outcome.status === "number" &&
      outcome.status >= 400 &&
      outcome.status < 500 &&
      outcome.status !== 429,
  );
}

function apiHasConfirmableLimitSignal(outcomes: ApiOutcome[]): boolean {
  return outcomes.some(
    (outcome) =>
      outcome.status === "deadline" ||
      (typeof outcome.status === "number" && (outcome.status === 429 || outcome.status >= 500)),
  );
}

function apiHasNetworkSignal(outcomes: ApiOutcome[]): boolean {
  return outcomes.some((outcome) => outcome.status === "network_error");
}

function apiHasRedirect(outcomes: ApiOutcome[]): boolean {
  return outcomes.some((outcome) => outcome.status === "redirect");
}

function apiAllSuccessful(outcomes: ApiOutcome[]): boolean {
  return outcomes.every(
    (outcome) => typeof outcome.status === "number" && outcome.status >= 200 && outcome.status < 300,
  );
}

function assertNoOrdinaryClientFailure(outcomes: ApiOutcome[]): void {
  if (apiHasOrdinaryClientFailure(outcomes)) {
    throw new CapacityRunError(
      "authenticated API returned an ordinary client error; the run is invalid and that level was not recorded",
    );
  }
  if (apiHasRedirect(outcomes)) {
    throw new CapacityRunError(
      "authenticated API redirected a fixed hot-path request; the target is invalid and that level was not recorded",
    );
  }
}

function safeEvidence(
  config: HostedCapacityConfig,
  evidence: Omit<CapacityEvidence, "schema" | "environment">,
): CapacityEvidence {
  const result: CapacityEvidence = {
    schema: "loonext.capacity.v1",
    environment: "deployed-nonproduction",
    ...evidence,
  };
  assertContentFreeEvidence(result, config.sensitiveValues);
  return result;
}

export function assertContentFreeEvidence(
  evidence: CapacityEvidence,
  forbiddenValues: string[],
): void {
  const serialized = JSON.stringify(evidence);
  for (const value of forbiddenValues) {
    if (value.length >= 8 && serialized.includes(value)) {
      throw new CapacityRunError("capacity result refused because it contained target or credential data");
    }
  }
}

export function formatCapacityEvidence(evidence: CapacityEvidence): string {
  return CAPACITY_RESULT_PREFIX + JSON.stringify(evidence);
}

type Settlement = "fulfilled" | "rejected" | "deadline";

type ValueSettlement<T> =
  | { state: "fulfilled"; value: T }
  | { state: "rejected" }
  | { state: "deadline" };

async function settlementBefore(
  operation: () => PromiseLike<unknown> | unknown,
  deadlineMs: number,
): Promise<Settlement> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = Promise.resolve()
    .then(operation)
    .then(
      () => "fulfilled" as const,
      () => "rejected" as const,
    );
  try {
    return await Promise.race([
      attempt,
      new Promise<"deadline">((resolve) => {
        timer = setTimeout(() => resolve("deadline"), deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function valueSettlementBefore<T>(
  operation: () => PromiseLike<T> | T,
  deadlineMs: number,
): Promise<ValueSettlement<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ state: "fulfilled" as const, value }),
      () => ({ state: "rejected" as const }),
    );
  try {
    return await Promise.race([
      attempt,
      new Promise<{ state: "deadline" }>((resolve) => {
        timer = setTimeout(() => resolve({ state: "deadline" }), deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeBefore(
  connection: RealtimeConnection,
  deadlineMs: number,
): Promise<boolean> {
  return (
    (await settlementBefore(
      () => connection.close(),
      deadlineMs + DEADLINE_SCHEDULING_TOLERANCE_MS,
    )) === "fulfilled"
  );
}

async function openBefore(
  openRealtime: OpenRealtimeConnection,
  input: OpenRealtimeInput,
): Promise<RealtimeConnection> {
  // The production adapter budgets auth, join, and awaited cleanup inside this
  // deadline. A second equal-duration race could return at the same instant as
  // its cleanup reserve, before removeChannel/disconnect finished.
  if (openRealtime === openSupabaseRealtimeConnection) {
    return openRealtime(input);
  }
  const DEADLINE = Symbol("realtime-deadline");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = Promise.resolve()
    .then(() => openRealtime(input))
    .then(
      (connection) => ({ ok: true as const, connection }),
      (cause: unknown) => ({ ok: false as const, cause }),
    );
  try {
    const result = await Promise.race([
      attempt,
      new Promise<typeof DEADLINE>((resolve) => {
        timer = setTimeout(
          () => resolve(DEADLINE),
          input.deadlineMs + DEADLINE_SCHEDULING_TOLERANCE_MS,
        );
      }),
    ]);
    if (result === DEADLINE) throw new RealtimeJoinFailure("deadline");
    if (!result.ok) throw result.cause;
    return result.connection;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const EMPTY_TERMINAL_EVENTS: Record<RealtimeTerminalState, number> = {
  channel_error: 0,
  timed_out: 0,
  closed: 0,
};

export function initialRealtimeTransitionState(): RealtimeTransitionState {
  return {
    current: "connecting",
    subscribedOnce: false,
    postJoinTerminalEvents: { ...EMPTY_TERMINAL_EVENTS },
  };
}

/**
 * Keep terminal history separate from the latest state. Supabase can report
 * SUBSCRIBED -> CHANNEL_ERROR -> SUBSCRIBED while reconnecting; using only the
 * last callback would erase the instability that the capacity run is meant to
 * observe.
 */
export function transitionRealtimeState(
  previous: RealtimeTransitionState,
  status: string,
): RealtimeTransitionState {
  if (status === "SUBSCRIBED") {
    return { ...previous, current: "subscribed", subscribedOnce: true };
  }
  const terminal: RealtimeTerminalState | undefined =
    status === "CHANNEL_ERROR"
      ? "channel_error"
      : status === "TIMED_OUT"
        ? "timed_out"
        : status === "CLOSED"
          ? "closed"
          : undefined;
  if (!terminal) return previous;
  return {
    ...previous,
    current: terminal,
    postJoinTerminalEvents: {
      ...previous.postJoinTerminalEvents,
      [terminal]:
        previous.postJoinTerminalEvents[terminal] + (previous.subscribedOnce ? 1 : 0),
    },
  };
}

export async function openSupabaseRealtimeConnection(
  input: OpenRealtimeInput,
  providedClient?: SupabaseClient,
): Promise<RealtimeConnection> {
  const started = performance.now();
  let client: SupabaseClient | undefined;
  let channel: RealtimeChannel | undefined;
  let transition = initialRealtimeTransitionState();
  let settled = false;
  let cleanupPromise: Promise<void> | undefined;
  // Reserve one third of the configured operation deadline for cleanup after a
  // failed auth/join. At the default 10s this leaves >3s, rather than the 1s
  // cap that proved too easy for a real unsubscribe round trip to consume.
  const cleanupReserveMs = Math.max(1, Math.floor(input.deadlineMs / 3));
  const joinBudgetMs = input.deadlineMs - cleanupReserveMs;

  const cleanup = (budgetMs = input.deadlineMs): Promise<void> => {
    cleanupPromise ??= (async () => {
      const cleanupStarted = performance.now();
      const remaining = (): number =>
        Math.max(1, budgetMs - Math.round(performance.now() - cleanupStarted));
      let failed = false;
      if (client && channel) {
        const removal = await valueSettlementBefore(
          () => client?.removeChannel(channel as RealtimeChannel),
          remaining(),
        );
        // Supabase fulfills removeChannel with "timed out" or "error" as
        // well as "ok". Only the explicit success value proves unsubscribe.
        failed ||=
          removal.state !== "fulfilled" || removal.value !== "ok";
      }
      if (client) {
        const disconnected = await valueSettlementBefore(
          () => client?.realtime.disconnect(),
          remaining(),
        );
        failed ||=
          disconnected.state !== "fulfilled" || disconnected.value !== "ok";
      }
      if (failed) throw new RealtimeCleanupFailure();
    })();
    return cleanupPromise;
  };

  try {
    client =
      providedClient ??
      createClient(input.supabaseOrigin, input.publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    let authSet: "set" | "failed" | "deadline";
    try {
      authSet = await Promise.race([
        client.realtime.setAuth(input.accessToken).then(
          () => "set" as const,
          () => "failed" as const,
        ),
        new Promise<"deadline">((resolve) => {
          authTimer = setTimeout(() => resolve("deadline"), joinBudgetMs);
        }),
      ]);
    } finally {
      if (authTimer) clearTimeout(authTimer);
    }
    if (authSet !== "set") {
      await cleanup(cleanupReserveMs);
      throw new RealtimeJoinFailure(authSet === "deadline" ? "deadline" : "network_error");
    }
    channel = client.channel(input.topic, { config: { private: true } });

    return await new Promise<RealtimeConnection>((resolve, reject) => {
      const remainingJoinMs = Math.max(
        1,
        joinBudgetMs - Math.round(performance.now() - started),
      );
      const failAfterCleanup = async (
        code: Exclude<RealtimeConnectionState, "subscribed">,
      ): Promise<void> => {
        try {
          await cleanup(cleanupReserveMs);
        } catch {
          reject(new RealtimeCleanupFailure());
          return;
        }
        reject(new RealtimeJoinFailure(code));
      };
      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        transition = { ...transition, current: "deadline" };
        void failAfterCleanup("deadline");
      }, remainingJoinMs);

      channel?.subscribe((status) => {
        transition = transitionRealtimeState(transition, String(status));
        if (status === "SUBSCRIBED") {
          if (!settled) {
            settled = true;
            clearTimeout(deadline);
            resolve({
              joinedMs: Math.max(0, Math.round(performance.now() - started)),
              snapshot: () => ({
                current:
                  transition.current === "connecting" ? "network_error" : transition.current,
                postJoinTerminalEvents: { ...transition.postJoinTerminalEvents },
              }),
              close: cleanup,
            });
          }
          return;
        }

        const next: RealtimeTerminalState | undefined =
          status === "CHANNEL_ERROR"
            ? "channel_error"
            : status === "TIMED_OUT"
              ? "timed_out"
              : status === "CLOSED"
                ? "closed"
                : undefined;
        if (!next) return;
        if (!settled) {
          settled = true;
          clearTimeout(deadline);
          void failAfterCleanup(next);
        }
      }, remainingJoinMs);
    });
  } catch (cause) {
    let cleanupFailed = false;
    try {
      await cleanup(cleanupReserveMs);
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) throw new RealtimeCleanupFailure();
    if (cause instanceof RealtimeCleanupFailure) throw cause;
    if (cause instanceof RealtimeJoinFailure) throw cause;
    throw new RealtimeJoinFailure("network_error");
  }
}

function realtimeFailureCode(cause: unknown): Exclude<RealtimeConnectionState, "subscribed"> {
  return cause instanceof RealtimeJoinFailure ? cause.code : "network_error";
}

interface RealtimeAssessment {
  states: Record<string, number>;
  stableConnections: number;
  connectionsWithPostJoinTerminalEvent: number;
  postJoinTerminalEvents: Record<RealtimeTerminalState, number>;
}

interface RealtimeBatch {
  opened: RealtimeConnection[];
  failures: Record<string, number>;
  joinTimes: number[];
}

function assessRealtime(connections: RealtimeConnection[]): RealtimeAssessment {
  const states: Record<string, number> = {};
  const postJoinTerminalEvents = { ...EMPTY_TERMINAL_EVENTS };
  let stableConnections = 0;
  let connectionsWithPostJoinTerminalEvent = 0;
  for (const connection of connections) {
    const snapshot = connection.snapshot();
    states[snapshot.current] = (states[snapshot.current] ?? 0) + 1;
    let connectionEvents = 0;
    for (const terminal of Object.keys(EMPTY_TERMINAL_EVENTS) as RealtimeTerminalState[]) {
      const count = snapshot.postJoinTerminalEvents[terminal];
      postJoinTerminalEvents[terminal] += count;
      connectionEvents += count;
    }
    if (connectionEvents > 0) connectionsWithPostJoinTerminalEvent += 1;
    if (snapshot.current === "subscribed" && connectionEvents === 0) stableConnections += 1;
  }
  return {
    states,
    stableConnections,
    connectionsWithPostJoinTerminalEvent,
    postJoinTerminalEvents,
  };
}

function realtimeFailureTotal(failures: Record<string, number>): number {
  return Object.values(failures).reduce((sum, count) => sum + count, 0);
}

function realtimeIsUnstable(
  expectedConnections: number,
  batch: RealtimeBatch,
  assessment: RealtimeAssessment,
): boolean {
  return (
    realtimeFailureTotal(batch.failures) > 0 ||
    assessment.stableConnections < expectedConnections ||
    assessment.connectionsWithPostJoinTerminalEvent > 0
  );
}

function realtimeConfirmableSignalKinds(
  batch: RealtimeBatch,
  assessment: RealtimeAssessment,
): string[] {
  const kinds: string[] = [];
  for (const terminal of Object.keys(EMPTY_TERMINAL_EVENTS) as RealtimeTerminalState[]) {
    if ((batch.failures[terminal] ?? 0) > 0) kinds.push(`join_${terminal}`);
    if (assessment.postJoinTerminalEvents[terminal] > 0) {
      kinds.push(`post_join_${terminal}`);
    }
  }
  return kinds;
}

async function closeConnections(
  connections: RealtimeConnection[],
  deadlineMs: number,
): Promise<boolean> {
  const closed = await Promise.all(
    connections.map((connection) => closeBefore(connection, deadlineMs)),
  );
  return closed.every(Boolean);
}

async function waitForDwell(
  sleep: (ms: number) => Promise<void>,
  dwellMs: number,
): Promise<void> {
  // The configured wait is itself bounded. The extra second is scheduling
  // tolerance, not another observation window.
  const result = await settlementBefore(() => sleep(dwellMs), dwellMs + 1_000);
  if (result !== "fulfilled") {
    throw new CapacityRunError("configured cooldown/dwell did not complete; the run is invalid");
  }
}

async function runApiWave(
  config: HostedCapacityConfig,
  fetcher: typeof globalThis.fetch,
  nowMs: () => number,
  concurrency: number,
): Promise<ApiOutcome[]> {
  const outcomes: ApiOutcome[] = [];
  for (let round = 0; round < config.apiRounds; round += 1) {
    outcomes.push(
      ...(await Promise.all(
        Array.from({ length: concurrency }, () =>
          performBoundedGet(
            fetcher,
            `${config.apiOrigin}/v1/for-you`,
            config.accessToken,
            config.companyId,
            config.deadlineMs,
            nowMs,
          ),
        ),
      )),
    );
  }
  return outcomes;
}

async function openRealtimeBatch(
  config: HostedCapacityConfig,
  openRealtime: OpenRealtimeConnection,
  count: number,
): Promise<RealtimeBatch> {
  const attempts = await Promise.all(
    Array.from({ length: count }, async () => {
      try {
        const connection = await openBefore(openRealtime, {
          supabaseOrigin: config.supabaseOrigin,
          publishableKey: config.supabasePublishableKey,
          accessToken: config.accessToken,
          topic: config.topic,
          deadlineMs: config.deadlineMs,
        });
        return { kind: "opened" as const, connection };
      } catch (cause) {
        if (cause instanceof RealtimeCleanupFailure) {
          return { kind: "cleanup_failure" as const };
        }
        return { kind: "join_failure" as const, code: realtimeFailureCode(cause) };
      }
    }),
  );
  const handles = attempts
    .filter(
      (
        attempt,
      ): attempt is Extract<(typeof attempts)[number], { kind: "opened" }> =>
        attempt.kind === "opened",
    )
    .map((attempt) => attempt.connection);
  if (attempts.some((attempt) => attempt.kind === "cleanup_failure")) {
    // Promise.all above deliberately waits for every sibling. A cleanup
    // failure must not reject early and lose a handle that subscribes a moment
    // later; close every successful sibling before propagating the invalid run.
    if (!(await closeConnections(handles, config.deadlineMs))) {
      throw new RealtimeCleanupFailure();
    }
    throw new RealtimeCleanupFailure();
  }
  const failures: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.kind === "join_failure") {
      failures[attempt.code] = (failures[attempt.code] ?? 0) + 1;
    }
  }
  return {
    opened: handles,
    failures,
    joinTimes: handles.map((connection) => connection.joinedMs).sort((a, b) => a - b),
  };
}

function cumulativeRealtimeBatch(
  active: RealtimeConnection[],
  newest: RealtimeBatch,
): RealtimeBatch {
  return {
    opened: [...active],
    failures: newest.failures,
    joinTimes: active
      .map((connection) => connection.joinedMs)
      .sort((a, b) => a - b),
  };
}

function summarizeRealtime(
  batch: RealtimeBatch,
  assessment: RealtimeAssessment,
): Record<string, unknown> {
  return {
    attempted_connections: batch.opened.length + realtimeFailureTotal(batch.failures),
    joined_connections: batch.opened.length,
    stable_connections: assessment.stableConnections,
    join_failures: batch.failures,
    states_after_dwell: assessment.states,
    connections_with_post_join_terminal_event:
      assessment.connectionsWithPostJoinTerminalEvent,
    post_join_terminal_events: assessment.postJoinTerminalEvents,
    join_p50_ms: percentile(batch.joinTimes, 0.5),
    join_p95_ms: percentile(batch.joinTimes, 0.95),
    join_p99_ms: percentile(batch.joinTimes, 0.99),
    join_max_ms:
      batch.joinTimes.length > 0 ? batch.joinTimes[batch.joinTimes.length - 1] : 0,
  };
}

async function preflight(
  config: HostedCapacityConfig,
  fetcher: typeof globalThis.fetch,
  nowMs: () => number,
): Promise<void> {
  const health = await performBoundedGet(
    fetcher,
    `${config.apiOrigin}/health`,
    undefined,
    undefined,
    config.deadlineMs,
    nowMs,
  );
  if (health.status !== 200) {
    throw new CapacityRunError("non-production API health preflight failed; no load was generated");
  }

  const hotPath = await performBoundedGet(
    fetcher,
    `${config.apiOrigin}/v1/for-you`,
    config.accessToken,
    config.companyId,
    config.deadlineMs,
    nowMs,
  );
  if (typeof hotPath.status !== "number" || hotPath.status < 200 || hotPath.status >= 300) {
    throw new CapacityRunError("authenticated hot-path preflight failed; no load was generated");
  }
}

export async function runHostedCapacity(
  config: HostedCapacityConfig,
  dependencies: HostedCapacityDependencies = {},
): Promise<CapacityEvidence[]> {
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const nowMs = dependencies.nowMs ?? (() => performance.now());
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const openRealtime = dependencies.openRealtime ?? openSupabaseRealtimeConnection;
  const results: CapacityEvidence[] = [];
  const emit = (evidence: CapacityEvidence): void => {
    assertContentFreeEvidence(evidence, config.sensitiveValues);
    results.push(evidence);
    dependencies.onEvidence?.(evidence);
  };

  await preflight(config, fetcher, nowMs);

  if (config.scenario === "api" || config.scenario === "all") {
    for (const concurrency of config.apiRamp) {
      const started = nowMs();
      const initial = await runApiWave(config, fetcher, nowMs, concurrency);
      assertNoOrdinaryClientFailure(initial);

      if (apiAllSuccessful(initial)) {
        emit(
          safeEvidence(config, {
            scenario: "hosted-api-pooler-ramp",
            tested_bound: {
              target_fingerprint: config.targetFingerprint,
              concurrency,
              rounds: config.apiRounds,
              requests: initial.length,
            },
            ceiling_reached: false,
            measurements: {
              classification: "healthy_level",
              wall_ms: elapsed(started, nowMs),
              ...summarizeApi(initial),
            },
            notes: [
              "Authenticated GET /v1/for-you requests against an explicitly authorized non-production deployment.",
              "No load-limit candidate occurred at this level.",
            ],
          }),
        );
        continue;
      }

      const initialConfirmable = apiHasConfirmableLimitSignal(initial);
      const initialNetwork = apiHasNetworkSignal(initial);
      if (!initialConfirmable && !initialNetwork) {
        throw new CapacityRunError(
          "authenticated API returned an unexpected response; the run is invalid and that level was not recorded",
        );
      }

      await waitForDwell(sleep, config.dwellMs);
      const baseline = [
        await performBoundedGet(
          fetcher,
          `${config.apiOrigin}/v1/for-you`,
          config.accessToken,
          config.companyId,
          config.deadlineMs,
          nowMs,
        ),
      ];
      assertNoOrdinaryClientFailure(baseline);
      if (!apiAllSuccessful(baseline)) {
        throw new CapacityRunError(
          "serialized API recovery baseline failed; the suspect level is invalid and was not recorded",
        );
      }

      await waitForDwell(sleep, config.dwellMs);
      const confirmation = await runApiWave(config, fetcher, nowMs, concurrency);
      assertNoOrdinaryClientFailure(confirmation);
      if (
        !apiAllSuccessful(confirmation) &&
        !apiHasConfirmableLimitSignal(confirmation) &&
        !apiHasNetworkSignal(confirmation)
      ) {
        throw new CapacityRunError(
          "API confirmation wave returned an unexpected response; the run is invalid and that level was not recorded",
        );
      }

      const confirmed =
        initialConfirmable && apiHasConfirmableLimitSignal(confirmation);
      const classification = confirmed
        ? "confirmed_capacity_ceiling"
        : apiAllSuccessful(confirmation)
          ? "transient_candidate_not_reproduced"
          : "inconclusive_network_candidate";
      emit(
        safeEvidence(config, {
          scenario: "hosted-api-pooler-ramp",
          tested_bound: {
            target_fingerprint: config.targetFingerprint,
            concurrency,
            rounds: config.apiRounds,
            load_requests: initial.length + confirmation.length,
            serialized_control_requests: baseline.length,
          },
          ceiling_reached: confirmed,
          measurements: {
            classification,
            wall_ms: elapsed(started, nowMs),
            initial_wave: summarizeApi(initial),
            recovery_baseline: summarizeApi(baseline),
            confirmation_wave: summarizeApi(confirmation),
            aggregate_load_waves: summarizeApi([...initial, ...confirmation]),
          },
          notes: [
            "A suspect wave was followed by cooldown, a healthy serialized control, a second cooldown, and an exact wave repeat.",
            "Only a 429, 5xx, or client deadline repeated across both load waves can confirm a capacity ceiling; redirects invalidate the target and network-only failures remain inconclusive.",
          ],
        }),
      );
      if (!confirmed) {
        throw new CapacityRunError(
          "API load candidate was transient or network-only; evidence was recorded but the run is inconclusive",
        );
      }
      break;
    }
  }

  if (config.scenario === "realtime" || config.scenario === "all") {
    // One connection proves that the supplied user token is a member of the
    // supplied private company topic before the multi-connection ramp begins.
    let probe: RealtimeConnection;
    try {
      probe = await openBefore(openRealtime, {
        supabaseOrigin: config.supabaseOrigin,
        publishableKey: config.supabasePublishableKey,
        accessToken: config.accessToken,
        topic: config.topic,
        deadlineMs: config.deadlineMs,
      });
    } catch {
      throw new CapacityRunError("private Realtime topic preflight failed; no Realtime ramp was generated");
    }
    if (!(await closeBefore(probe, config.deadlineMs))) {
      throw new CapacityRunError("private Realtime preflight cleanup exceeded its deadline; no ramp was generated");
    }

    const active: RealtimeConnection[] = [];
    const pendingRealtimeEvidence: CapacityEvidence[] = [];
    let realtimeRunFailure: { cause: unknown } | undefined;
    try {
      for (const connections of config.realtimeRamp) {
        const additions = Math.max(0, connections - active.length);
        const attemptedAt = nowMs();
        const initialBatch = await openRealtimeBatch(config, openRealtime, additions);
        active.push(...initialBatch.opened);
        const initialCumulativeBatch = cumulativeRealtimeBatch(active, initialBatch);
        await waitForDwell(sleep, config.dwellMs);
        const initialAssessment = assessRealtime(active);
        const initialUnstable = realtimeIsUnstable(
          connections,
          initialCumulativeBatch,
          initialAssessment,
        );

        if (!initialUnstable) {
          pendingRealtimeEvidence.push(
            safeEvidence(config, {
              scenario: "hosted-realtime-connection-ramp",
              tested_bound: {
                target_fingerprint: config.targetFingerprint,
                requested_connections: connections,
                credential_subjects: 1,
                dwell_ms: config.dwellMs,
              },
              ceiling_reached: false,
              measurements: {
                classification: "healthy_join_stability_level",
                wall_ms: elapsed(attemptedAt, nowMs),
                attempted_new_connections: additions,
                ...summarizeRealtime(initialCumulativeBatch, initialAssessment),
              },
              notes: [
                "Independent authenticated clients joined the private company topic and were observed for the configured dwell window.",
                "This measures hosted connection/join stability only; it sends no broadcast and does not claim hosted delivery fan-out.",
              ],
            }),
          );
          continue;
        }

        const initialSignalKinds = realtimeConfirmableSignalKinds(
          initialCumulativeBatch,
          initialAssessment,
        );
        if (!(await closeConnections(active, config.deadlineMs))) {
          throw new CapacityRunError(
            "Realtime suspect-wave cleanup exceeded its deadline; the candidate level is invalid",
          );
        }
        active.splice(0, active.length);
        await waitForDwell(sleep, config.dwellMs);

        const baselineBatch = await openRealtimeBatch(config, openRealtime, 1);
        await waitForDwell(sleep, config.dwellMs);
        const baselineAssessment = assessRealtime(baselineBatch.opened);
        const baselineUnstable = realtimeIsUnstable(
          1,
          baselineBatch,
          baselineAssessment,
        );
        const baselineClosed = await closeConnections(
          baselineBatch.opened,
          config.deadlineMs,
        );
        if (baselineUnstable || !baselineClosed) {
          throw new CapacityRunError(
            "serialized Realtime recovery baseline failed; the candidate level is invalid and was not recorded",
          );
        }

        await waitForDwell(sleep, config.dwellMs);
        const confirmationBatch = await openRealtimeBatch(
          config,
          openRealtime,
          connections,
        );
        await waitForDwell(sleep, config.dwellMs);
        const confirmationAssessment = assessRealtime(confirmationBatch.opened);
        const confirmationUnstable = realtimeIsUnstable(
          connections,
          confirmationBatch,
          confirmationAssessment,
        );
        const confirmationClosed = await closeConnections(
          confirmationBatch.opened,
          config.deadlineMs,
        );
        if (!confirmationClosed) {
          throw new CapacityRunError(
            "Realtime confirmation cleanup exceeded its deadline; the candidate level is invalid",
          );
        }

        const confirmationSignalKinds = realtimeConfirmableSignalKinds(
          confirmationBatch,
          confirmationAssessment,
        );
        const repeatedSignalKinds = initialSignalKinds.filter((kind) =>
          confirmationSignalKinds.includes(kind),
        );
        const confirmed = confirmationUnstable && repeatedSignalKinds.length > 0;
        const classification = confirmed
          ? "confirmed_join_or_stability_limit"
          : confirmationUnstable
            ? "inconclusive_join_candidate"
            : "join_burst_candidate_not_reproduced";
        pendingRealtimeEvidence.push(
          safeEvidence(config, {
            scenario: "hosted-realtime-connection-ramp",
            tested_bound: {
              target_fingerprint: config.targetFingerprint,
              requested_connections: connections,
              credential_subjects: 1,
              dwell_ms: config.dwellMs,
            },
            ceiling_reached: confirmed,
            measurements: {
              classification,
              initial_signal_kinds: initialSignalKinds,
              confirmation_signal_kinds: confirmationSignalKinds,
              repeated_signal_kinds: repeatedSignalKinds,
              wall_ms: elapsed(attemptedAt, nowMs),
              initial_cumulative_wave: summarizeRealtime(
                initialCumulativeBatch,
                initialAssessment,
              ),
              recovery_baseline: summarizeRealtime(
                baselineBatch,
                baselineAssessment,
              ),
              confirmation_full_concurrency_wave: summarizeRealtime(
                confirmationBatch,
                confirmationAssessment,
              ),
            },
            notes: [
              "A cumulative join/stability candidate was reset, followed by cooldown, a healthy serialized connection control, another cooldown, and a full-concurrency repeat.",
              "Only the same channel refusal or post-join terminal event repeated across both waves is called a join/stability limit; deadline/network-only, differently shaped, or non-reproduced candidates remain inconclusive.",
              "This sends no broadcast and does not claim hosted delivery fan-out.",
            ],
          }),
        );
        if (!confirmed) {
          throw new CapacityRunError(
            "Realtime join/stability candidate was not confirmable; evidence was recorded but the run is inconclusive",
          );
        }
        break;
      }
    } catch (cause) {
      realtimeRunFailure = { cause };
    }
    if (!(await closeConnections(active, config.deadlineMs))) {
      throw new CapacityRunError("final Realtime cleanup exceeded its deadline");
    }
    for (const evidence of pendingRealtimeEvidence) emit(evidence);
    if (realtimeRunFailure) {
      throw realtimeRunFailure.cause;
    }
  }

  return results;
}
