/**
 * #251 — Supabase Realtime fan-out, reproducible instead of a number in prose.
 *
 * This is deliberately local-only. It resolves the local Supabase publishable
 * key from `supabase status`, refuses any non-loopback URL, creates one real
 * authenticated member, then opens one independent supabase-js client (and
 * therefore one websocket) per subscriber. Broadcasts are emitted by the real
 * `realtime.send` database function; neither the transport nor topic RLS is
 * doubled.
 *
 * What transfers: exact delivery, duplicates, join failures, hangs, and the
 * spread between the first and last subscriber for one event. What does not:
 * the hosted service's connection ceiling or these laptop milliseconds.
 */
import { execFileSync } from "node:child_process";

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startHarness, type Harness } from "./harness";
import { capacityResult, emitCapacityResult } from "./load-report";

const SUBSCRIBERS = 40;
const BROADCASTS = 20;
const JOIN_DEADLINE_MS = 15_000;
const DELIVERY_DEADLINE_MS = 15_000;
const EVENT = "capacity.probe";
const PASSWORD = "Capacity-local-only-251!";

type JoinState = "subscribed" | "channel_error" | "timed_out" | "closed" | "hang";

interface JoinOutcome {
  index: number;
  state: JoinState;
  ms: number;
}

interface LocalSupabasePublic {
  apiUrl: string;
  publishableKey: string;
}

let h: Harness;
let userId: string | undefined;
let authClient: SupabaseClient | undefined;
const subscribers: Array<{ client: SupabaseClient; channel: RealtimeChannel }> = [];
const companyId = crypto.randomUUID();

/**
 * No fallback key on purpose. A guessed key can turn a join failure into a
 * misleading capacity result; a missing CLI/status is an actionable setup
 * error. `startHarness` already requires the same local stack.
 */
function resolveLocalSupabasePublic(): LocalSupabasePublic {
  const root = new URL("../../..", import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  );
  // Node's Windows spawn cannot execute the `.cmd` shim directly. The command
  // is a fixed literal — no path, key, or user input is interpolated into it.
  const command =
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npx";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npx supabase status -o json"]
      : ["supabase", "status", "-o", "json"];
  const output = execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = JSON.parse(output) as Record<string, string>;
  const apiUrl = status.API_URL ?? status.api_url;
  const publishableKey =
    status.PUBLISHABLE_KEY ??
    status.publishable_key ??
    status.ANON_KEY ??
    status.anon_key;
  if (!apiUrl || !publishableKey) {
    throw new Error(
      "local Supabase status did not report API_URL and PUBLISHABLE_KEY/ANON_KEY",
    );
  }

  const hostname = new URL(apiUrl).hostname;
  if (!new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(hostname)) {
    throw new Error(
      `refusing Realtime load target ${hostname}: this harness is loopback-only`,
    );
  }
  return { apiUrl, publishableKey };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function milliseconds(value: number): number {
  return Math.round(value * 10) / 10;
}

function subscribe(index: number, channel: RealtimeChannel): Promise<JoinOutcome> {
  const started = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (state: JoinState) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({ index, state, ms: performance.now() - started });
    };
    const deadline = setTimeout(() => finish("hang"), JOIN_DEADLINE_MS);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") finish("subscribed");
      else if (status === "CHANNEL_ERROR") finish("channel_error");
      else if (status === "TIMED_OUT") finish("timed_out");
      else if (status === "CLOSED") finish("closed");
    }, JOIN_DEADLINE_MS - 250);
  });
}

async function completesBefore(
  promise: Promise<void>,
  deadlineMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

beforeAll(async () => {
  h = await startHarness();
  const local = resolveLocalSupabasePublic();
  expect(h.supabaseUrl).toBe(local.apiUrl);

  const email = `${h.runId}-realtime@load.test`;
  const created = await h.db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Realtime Load" },
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("local Auth created no Realtime load user");
  }
  userId = created.data.user.id;

  h.sql(`
    insert into public.companies
      (id, name, owner_user_id, country, requested_area_code,
       subscription_status, aup_accepted_at)
    values ('${companyId}', 'Realtime Load', '${userId}', 'CA', '613',
            'active', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${companyId}', '${userId}', 'owner');
  `);

  authClient = createClient(local.apiUrl, local.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const signedIn = await authClient.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error || !signedIn.data.session?.access_token) {
    throw signedIn.error ?? new Error("local Auth returned no access token");
  }

  // One token, many independent clients: this measures websocket fan-out, not
  // the Auth service's ability to mint forty identical sessions.
  const token = signedIn.data.session.access_token;
  const topic = `company:${companyId}`;
  for (let index = 0; index < SUBSCRIBERS; index += 1) {
    const client = createClient(local.apiUrl, local.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    await client.realtime.setAuth(token);
    subscribers.push({
      client,
      channel: client.channel(topic, { config: { private: true } }),
    });
  }
}, 120_000);

afterAll(async () => {
  await Promise.allSettled(
    subscribers.map(({ client, channel }) => client.removeChannel(channel)),
  );
  if (h) {
    if (userId) {
      h.sql(`
        delete from public.company_members where company_id = '${companyId}';
        delete from public.companies where id = '${companyId}';
      `);
      await h.db.auth.admin.deleteUser(userId);
    }
    await h.close();
  }
}, 120_000);

describe("#251 local Realtime fan-out", () => {
  it("delivers every broadcast exactly once to every joined websocket", async () => {
    const arrivals = Array.from({ length: SUBSCRIBERS }, () => new Map<number, number>());
    let duplicateFrames = 0;
    let invalidFrames = 0;
    let uniqueFrames = 0;
    let resolveAll!: () => void;
    const allDelivered = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });

    for (const [subscriber, { channel }] of subscribers.entries()) {
      channel.on("broadcast", { event: EVENT }, ({ payload }) => {
        const sequence = Number((payload as { sequence?: unknown }).sequence);
        if (!Number.isInteger(sequence) || sequence < 1 || sequence > BROADCASTS) {
          invalidFrames += 1;
          return;
        }
        if (arrivals[subscriber].has(sequence)) {
          duplicateFrames += 1;
          return;
        }
        arrivals[subscriber].set(sequence, performance.now());
        uniqueFrames += 1;
        if (uniqueFrames === SUBSCRIBERS * BROADCASTS) resolveAll();
      });
    }

    const joins = await Promise.all(
      subscribers.map(({ channel }, index) => subscribe(index, channel)),
    );
    const joinCounts = Object.fromEntries(
      (["subscribed", "channel_error", "timed_out", "closed", "hang"] as const).map(
        (state) => [state, joins.filter((join) => join.state === state).length],
      ),
    );
    expect(joinCounts, "every websocket must join the private company topic").toEqual({
      subscribed: SUBSCRIBERS,
      channel_error: 0,
      timed_out: 0,
      closed: 0,
      hang: 0,
    });

    const broadcastStarted = performance.now();
    h.sql(`
      select realtime.send(
        jsonb_build_object('sequence', sequence),
        '${EVENT}',
        'company:${companyId}',
        true
      )
      from generate_series(1, ${BROADCASTS}) as sequence;
    `);
    const completed = await completesBefore(allDelivered, DELIVERY_DEADLINE_MS);
    // Give a duplicate frame a chance to reveal itself after the expected count.
    if (completed) await new Promise((resolve) => setTimeout(resolve, 100));

    const expectedFrames = SUBSCRIBERS * BROADCASTS;
    const perSubscriber = arrivals.map((received) => received.size);
    const missingFrames = expectedFrames - uniqueFrames;
    const eventSpreads = Array.from({ length: BROADCASTS }, (_, offset) => {
      const sequence = offset + 1;
      const times = arrivals
        .map((received) => received.get(sequence))
        .filter((time): time is number => time !== undefined);
      return times.length === 0 ? 0 : Math.max(...times) - Math.min(...times);
    });
    const deliveryLatencies = arrivals.flatMap((received) =>
      [...received.values()].map((arrived) => arrived - broadcastStarted),
    );
    const joinLatencies = joins
      .filter((join) => join.state === "subscribed")
      .map((join) => join.ms);

    expect(completed, "Realtime delivery hung past its explicit deadline").toBe(true);
    expect(uniqueFrames).toBe(expectedFrames);
    expect(missingFrames).toBe(0);
    expect(duplicateFrames).toBe(0);
    expect(invalidFrames).toBe(0);
    expect(perSubscriber).toEqual(Array(SUBSCRIBERS).fill(BROADCASTS));

    // Emit only after every exact-delivery assertion. A failed run must not
    // leave a scrapeable line that claims this bound succeeded.
    emitCapacityResult(
      capacityResult({
        scenario: "realtime-private-broadcast-fanout",
        environment: "local-realtime",
        tested_bound: {
          concurrent_websockets: SUBSCRIBERS,
          broadcasts: BROADCASTS,
          expected_deliveries: expectedFrames,
        },
        ceiling_reached: false,
        measurements: {
          joins: joinCounts,
          join_p50_ms: milliseconds(percentile(joinLatencies, 0.5)),
          join_p95_ms: milliseconds(percentile(joinLatencies, 0.95)),
          join_max_ms: milliseconds(Math.max(...joinLatencies)),
          received_deliveries: uniqueFrames,
          missing_deliveries: missingFrames,
          duplicate_deliveries: duplicateFrames,
          invalid_deliveries: invalidFrames,
          per_subscriber_min: Math.min(...perSubscriber),
          per_subscriber_max: Math.max(...perSubscriber),
          delivery_p50_ms: milliseconds(percentile(deliveryLatencies, 0.5)),
          delivery_p95_ms: milliseconds(percentile(deliveryLatencies, 0.95)),
          delivery_max_ms: milliseconds(Math.max(...deliveryLatencies)),
          fanout_spread_p95_ms: milliseconds(percentile(eventSpreads, 0.95)),
          fanout_spread_max_ms: milliseconds(Math.max(...eventSpreads)),
          delivery_deadline_ms: DELIVERY_DEADLINE_MS,
          completed_before_deadline: completed,
        },
        notes: [
          "Uses the real local Realtime server, private-topic RLS, Auth token, and realtime.send.",
          "The hosted connection ceiling and laptop-to-production latency remain unmeasured.",
        ],
      }),
    );
  }, 120_000);
});
