#!/usr/bin/env node
/**
 * #251 -- Realtime broadcast fan-out on a temporary deployed stack.
 *
 * N independent authenticated sockets join the workspace's private topic the
 * clients use (`company:<id>`). The driver then emits inbound messages the way
 * the carrier does: a signed `message.received` webhook to the API Worker, which
 * inserts the message, whose database trigger calls `realtime.send`. Nothing is
 * published by the driver itself, and an ordinary member cannot publish to the
 * topic.
 *
 * Per level (sockets x events per second) it reports:
 *  - emit-to-socket latency for every delivery, on one clock: this process sends
 *    and receives, so there is no clock skew. It includes the Worker's
 *    acknowledge-then-ingest path, so it is "carrier sent it" to "client saw it";
 *  - first-delivery latency per event (the ingest and broadcast path) and the
 *    spread from first to last socket (the fan-out);
 *  - the share of sockets that got each event, and any socket that got one twice.
 *
 * The driver's own event-loop lag is reported beside every level, because one
 * Node process receiving thousands of frames a second can be the bottleneck.
 *
 * Environment (values never go on the command line):
 *   LOONEXT_CAPACITY_CONFIRM, LOONEXT_CAPACITY_ACCESS_TOKEN (an ordinary
 *   member), LOONEXT_CAPACITY_SUPABASE_PUBLISHABLE_KEY, LOONEXT_CAPACITY_COMPANY_ID,
 *   LOONEXT_CAPACITY_NUMBER_ID, LOONEXT_CAPACITY_SIGNING_KEY_FILE
 */
import { monitorEventLoopDelay } from "node:perf_hooks";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";

import { assertHostedTarget, CapacityConfigError } from "./deployed-capacity-lib.ts";
import {
  countStatuses,
  loadSigner,
  postSigned,
  requiredEnv,
  sleep,
  summarize,
  type Ack,
} from "./capacity-support.ts";

const JOIN_BATCH = 25;
const JOIN_DEADLINE_MS = 20_000;
const SETTLE_MAX_MS = 20_000;
const SETTLE_QUIET_MS = 3_000;
/** Fictional numbers only (555-0100 to 555-0199). */
const SENDER = "+16135550111";

const HELP = `
Usage:
  node --experimental-strip-types scripts/hosted-capacity-fanout.ts \\
    --target-id capacity-251 --api-origin https://<api>.workers.dev \\
    --supabase-origin https://<project>.supabase.co \\
    --number-e164 <the workspace's number> \\
    [--matrix 50:1,50:10,200:1,500:5] [--seconds 12] \\
    [--run-id <id> --start-at <epoch ms> [--listen-only]]

--matrix is sockets:events-per-second, in order; sockets are kept between levels.
`;

interface Socket {
  client: SupabaseClient;
  channel: RealtimeChannel;
}

function option(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

function inbound(eventId: string, messageId: string, to: string, text: string) {
  const now = new Date().toISOString();
  return {
    data: {
      event_type: "message.received",
      id: eventId,
      occurred_at: now,
      payload: {
        id: messageId,
        type: "SMS",
        direction: "inbound",
        from: { phone_number: SENDER, carrier: "Bell", line_type: "Wireless" },
        to: [{ phone_number: to, status: "webhook_delivered" }],
        text,
        media: [],
        received_at: now,
        encoding: "GSM-7",
        parts: 1,
      },
    },
    meta: { attempt: 1 },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  const { apiOrigin, supabaseOrigin } = assertHostedTarget({
    targetId: option(args, "--target-id") ?? "",
    apiOrigin: option(args, "--api-origin") ?? "",
    supabaseOrigin: option(args, "--supabase-origin") ?? "",
    confirmation: requiredEnv("LOONEXT_CAPACITY_CONFIRM"),
  });
  const number = option(args, "--number-e164") ?? "";
  if (!/^\+1\d{3}5550\d{3}$/.test(number)) {
    throw new CapacityConfigError("--number-e164 must be a fictional 555-01xx number");
  }
  const matrix = (option(args, "--matrix") ?? "50:1,50:10,200:1,200:10,500:1,500:5").split(",").map((cell) => {
    const [sockets, rate] = cell.split(":").map(Number);
    if (!sockets || !rate || sockets > 600 || rate > 100) throw new CapacityConfigError("--matrix cells are sockets:rate, up to 600 and 100");
    return { sockets, rate };
  });
  const seconds = Number(option(args, "--seconds") ?? "12");
  const token = requiredEnv("LOONEXT_CAPACITY_ACCESS_TOKEN");
  const publishable = requiredEnv("LOONEXT_CAPACITY_SUPABASE_PUBLISHABLE_KEY");
  const companyId = requiredEnv("LOONEXT_CAPACITY_COMPANY_ID");
  // The clients join the per-number topic (#480); the company topic no longer carries messages.
  const topic = `company:${companyId}:number:${requiredEnv("LOONEXT_CAPACITY_NUMBER_ID")}`;
  const sign = await loadSigner(requiredEnv("LOONEXT_CAPACITY_SIGNING_KEY_FILE"));
  const runId = option(args, "--run-id") ?? Date.now().toString(36);
  const listenOnly = args.includes("--listen-only");
  const startAt = Number(option(args, "--start-at") ?? "0");

  /** message id -> every (socket, receive time) for it. */
  const receipts = new Map<string, Array<{ socket: number; at: number }>>();
  const sockets: Socket[] = [];
  const joinMs: number[] = [];
  let conversationId: string | undefined;
  let otherFrames = 0;
  let joinFailures = 0;

  async function join(index: number): Promise<void> {
    const started = performance.now();
    const client = createClient(supabaseOrigin, publishable, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await client.realtime.setAuth(token);
    const channel = client.channel(topic, { config: { private: true } });
    channel.on("broadcast", { event: "message.created" }, (message) => {
      const at = performance.timeOrigin + performance.now();
      const payload = message.payload as { message_id?: string; conversation_id?: string } | undefined;
      const id = payload?.message_id;
      if (!id) return;
      conversationId ??= payload?.conversation_id;
      const list = receipts.get(id) ?? [];
      list.push({ socket: index, at });
      receipts.set(id, list);
    });
    channel.on("broadcast", { event: "conversation.updated" }, () => {
      otherFrames += 1;
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("join deadline")), JOIN_DEADLINE_MS);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          clearTimeout(timer);
          reject(new Error(String(status)));
        }
      });
    });
    joinMs.push(performance.now() - started);
    sockets[index] = { client, channel };
  }

  async function growTo(target: number): Promise<void> {
    while (sockets.length < target) {
      const from = sockets.length;
      const batch = Array.from({ length: Math.min(JOIN_BATCH, target - from) }, (_, k) => from + k);
      const outcomes = await Promise.allSettled(batch.map((index) => join(index)));
      const reasons = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [String((outcome.reason as Error)?.message)] : []));
      const failed = reasons.length;
      joinFailures += failed;
      if (failed > 0) {
        // A socket that failed to join leaves a hole; stop growing rather than count it.
        throw new CapacityConfigError(`${failed} of ${batch.length} sockets failed to join at ${from + batch.length} (${[...new Set(reasons)].join(", ")})`);
      }
    }
  }

  const loop = monitorEventLoopDelay({ resolution: 10 });

  /** The member reads the thread back through the Worker, newest first, a page at a time. */
  async function readMessageIds(prefix: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!conversationId) return out;
    let cursor: string | null = null;
    for (let page = 0; page < 40; page += 1) {
      const url: string = `${apiOrigin}/v1/conversations/${conversationId}/messages?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}`, "x-company-id": companyId },
      });
      if (!response.ok) throw new CapacityConfigError(`reading the thread back answered ${response.status}`);
      const body = (await response.json()) as { data: Array<{ id: string; body: string }>; next_cursor: string | null };
      for (const row of body.data) if (row.body.startsWith(prefix)) out.set(row.body, row.id);
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    return out;
  }

  try {
    for (const { sockets: count, rate } of matrix) {
      await growTo(count);
      await sleep(1_500);
      const level = `${runId}-${count}x${rate}`;
      const total = Math.round(rate * seconds);
      const sentAt: number[] = [];
      const acks: Ack[] = [];
      const otherBefore = otherFrames;
      loop.reset();
      loop.enable();
      const windowStart = new Date().toISOString();
      // A second process can listen to the same send: both start at the same wall-clock instant.
      if (startAt > Date.now()) await sleep(startAt - Date.now());
      const origin = performance.timeOrigin + performance.now();
      const sends: Promise<void>[] = [];
      if (listenOnly) await sleep(seconds * 1_000);
      for (let i = 0; i < total && !listenOnly; i += 1) {
        const due = origin + (i * 1_000) / rate;
        const wait = due - (performance.timeOrigin + performance.now());
        if (wait > 0) await sleep(wait);
        sentAt[i] = performance.timeOrigin + performance.now();
        const event = inbound(`fanout-${level}-${i}`, `fanout-${level}-${i}-msg`, number, `fanout-${level}-${i}`);
        sends.push(postSigned(apiOrigin, sign, event).then((ack) => void acks.push(ack)));
      }
      await Promise.all(sends);

      // Settle: until deliveries stop arriving for SETTLE_QUIET_MS, or the cap.
      let seen = -1;
      let quietSince = performance.now();
      const settleStart = performance.now();
      for (;;) {
        const now = [...receipts.values()].reduce((sum, list) => sum + list.length, 0);
        if (now !== seen) {
          seen = now;
          quietSince = performance.now();
        }
        if (performance.now() - quietSince > SETTLE_QUIET_MS) break;
        if (performance.now() - settleStart > SETTLE_MAX_MS) break;
        await sleep(250);
      }
      loop.disable();
      const windowEnd = new Date().toISOString();

      const ids = await readMessageIds(`fanout-${level}-`);
      const allLatencies: number[] = [];
      const firstLatencies: number[] = [];
      const spreads: number[] = [];
      const shares: number[] = [];
      let deliveries = 0;
      let duplicates = 0;
      let ingested = 0;
      for (let i = 0; i < total; i += 1) {
        const id = ids.get(`fanout-${level}-${i}`);
        if (!id) continue;
        ingested += 1;
        const list = receipts.get(id) ?? [];
        const distinct = new Set(list.map((receipt) => receipt.socket));
        duplicates += list.length - distinct.size;
        deliveries += distinct.size;
        shares.push(distinct.size / count);
        const times = list.map((receipt) => receipt.at - (sentAt[i] ?? origin + (i * 1_000) / rate));
        allLatencies.push(...times);
        if (times.length > 0) {
          firstLatencies.push(Math.min(...times));
          spreads.push(Math.max(...times) - Math.min(...times));
        }
      }
      const fullyDelivered = shares.filter((share) => share === 1).length;
      const record = {
        schema: "loonext.capacity.v1",
        scenario: listenOnly ? "hosted-realtime-broadcast-listener" : "hosted-realtime-broadcast-fanout",
        environment: "deployed-nonproduction",
        tested_bound: { sockets: count, events_per_second: rate, seconds, events_sent: total },
        window: { start: windowStart, end: windowEnd },
        ceiling_reached: ingested < total || fullyDelivered < ingested || duplicates > 0,
        measurements: {
          webhook_acks: countStatuses(acks),
          events_ingested: ingested,
          events_delivered_to_every_socket: fullyDelivered,
          deliveries_expected: ingested * count,
          deliveries_received: deliveries,
          deliveries_duplicated: duplicates,
          share_of_sockets_per_event_min: Math.round(Math.min(1, ...shares) * 1000) / 1000,
          emit_to_socket_ms: summarize(allLatencies),
          emit_to_first_socket_ms: summarize(firstLatencies),
          first_to_last_socket_ms: summarize(spreads),
          driver_event_loop_lag_p99_ms: Math.round(loop.percentile(99) / 1e6),
          driver_event_loop_lag_max_ms: Math.round(loop.max / 1e6),
          join_ms: summarize(joinMs),
          conversation_updated_frames_received: otherFrames - otherBefore,
          join_failures: joinFailures,
        },
        notes: [
          "One clock: this process sends the webhook and receives every frame. Includes the Worker's acknowledge-then-ingest path.",
          "A driver event-loop lag near the latency means the driver, not the service, is the limit.",
        ],
      };
      process.stdout.write(`CAPACITY_RESULT ${JSON.stringify(record)}\n`);
    }
  } finally {
    await Promise.allSettled(
      sockets.map(async (socket) => {
        await socket.client.removeChannel(socket.channel);
        await socket.client.realtime.disconnect();
      }),
    );
  }
}

main().catch((cause: unknown) => {
  process.stderr.write(
    cause instanceof CapacityConfigError || (cause instanceof Error && /required/.test(cause.message))
      ? `capacity: ${cause.message}\n`
      : "capacity: driver failed; no unreviewed error details were printed\n",
  );
  process.exitCode = 1;
});
