#!/usr/bin/env node
/**
 * #251 -- simultaneous inbound calls against a temporary deployed Worker.
 *
 * The driver is the carrier. It tells the fake switch (a second temporary
 * workers.dev Worker, capacity-fake-telnyx-worker.ts) that a customer is
 * calling, delivers the switch's `call.initiated` to the API Worker as a signed
 * webhook, and keeps delivering what the switch queues as the Worker dials the
 * crew, until the call rings, is answered and ends. Nothing reaches Telnyx: the
 * API Worker's TELNYX_API_BASE is the fake switch.
 *
 * What it records per level, all from outside the Worker:
 *  - ring, answer and end settle times as the driver saw them;
 *  - per call, the same three as the switch saw them (one clock, so no skew
 *    between this machine and Cloudflare);
 *  - acknowledgement statuses, dials against the bound, and legs left alive.
 *
 * CPU and wall time of the Durable Object are NOT measured here. Each level
 * prints the UTC window it ran in, and Cloudflare's own analytics are read for
 * that window (docs/CAPACITY.md section 2e).
 *
 * Environment (values never go on the command line):
 *   LOONEXT_CAPACITY_CONFIRM, LOONEXT_CAPACITY_SIGNING_KEY_FILE,
 *   LOONEXT_CAPACITY_SWITCH_TOKEN
 */
import { readFileSync } from "node:fs";

import { assertHostedTarget, CapacityConfigError } from "./deployed-capacity-lib.ts";
import {
  countStatuses,
  loadSigner,
  postSigned,
  requiredEnv,
  sleep,
  summarize,
  type Ack,
  type Signer,
} from "./capacity-support.ts";

const QUIET_MS = 1_500;
/** Fictional numbers only (555-0100 to 555-0199). */
const farEnd = (index: number) => `+16135550${String(100 + index)}`;

interface Line {
  e164: string;
  sip: string[];
}

interface Leg {
  callControlId: string;
  callSessionId: string;
  origin: "far-end" | "dial" | "transfer";
  to: string;
  state: "ringing" | "answered" | "ended";
  startedAtMs: number;
  answeredAtMs: number | null;
  endedAtMs: number | null;
}

const HELP = `
Usage:
  node --experimental-strip-types scripts/hosted-capacity-calls.ts \\
    --target-id capacity-251 --api-origin https://<api>.workers.dev \\
    --switch-origin https://<fake>.workers.dev \\
    --supabase-origin https://<project>.supabase.co \\
    --lines-file <json> [--levels 2,8,16,32] [--gap-ms 3000]
`;

function option(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  const targetId = option(args, "--target-id") ?? "";
  const switchOrigin = option(args, "--switch-origin") ?? "";
  const linesFile = option(args, "--lines-file");
  if (!linesFile || !switchOrigin) throw new CapacityConfigError("--lines-file and --switch-origin are required");
  const { apiOrigin } = assertHostedTarget({
    targetId,
    apiOrigin: option(args, "--api-origin") ?? "",
    supabaseOrigin: option(args, "--supabase-origin") ?? "",
    confirmation: requiredEnv("LOONEXT_CAPACITY_CONFIRM"),
  });
  const switchUrl = new URL(switchOrigin);
  if (!switchUrl.hostname.endsWith(".workers.dev") || !/-capacity-\d+\./.test(switchUrl.hostname)) {
    throw new CapacityConfigError("--switch-origin must be a temporary -capacity-<issue> workers.dev switch");
  }
  const levels = (option(args, "--levels") ?? "2,8,16,32").split(",").map(Number);
  const gapMs = Number(option(args, "--gap-ms") ?? "3000");
  const lines = (JSON.parse(readFileSync(linesFile, "utf8")) as { lines: Line[] }).lines;
  if (lines.length < Math.max(...levels)) throw new CapacityConfigError("the lines file has fewer lines than the top level");

  const sign = await loadSigner(requiredEnv("LOONEXT_CAPACITY_SIGNING_KEY_FILE"));
  const control = requiredEnv("LOONEXT_CAPACITY_SWITCH_TOKEN");
  const ctl = async <T>(op: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${switchUrl.origin}/__ctl/${op}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${control}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new CapacityConfigError(`switch control ${op} answered ${response.status}`);
    return (await response.json()) as T;
  };

  const sipToLine = new Map<string, number>();
  lines.forEach((line, index) => line.sip.forEach((sip) => sipToLine.set(sip, index)));
  const lineOf = (leg: Leg): number | undefined => {
    const sip = /^sip:([^@]+)@/.exec(leg.to)?.[1];
    return sip ? sipToLine.get(sip) : undefined;
  };

  /** Deliver what the switch queues until it has been quiet for QUIET_MS. */
  async function drain(sign: Signer, acks: Ack[]): Promise<number> {
    let quietSince: number | null = null;
    let lastActivity = performance.now();
    for (;;) {
      const events = await ctl<Array<{ data: { id: string } }>>("events");
      if (events.length > 0) {
        quietSince = null;
        acks.push(...(await Promise.all(events.map((event) => postSigned(apiOrigin, sign, event)))));
        lastActivity = performance.now();
        continue;
      }
      quietSince ??= performance.now();
      if (performance.now() - quietSince > QUIET_MS) return lastActivity;
      await sleep(50);
    }
  }

  const crew = lines[0]?.sip.length ?? 0;
  for (const level of levels) {
    await ctl("reset", {});
    const windowStart = new Date().toISOString();
    const acks: Ack[] = [];
    const active = lines.slice(0, level);
    const customers = await Promise.all(
      active.map((line, index) =>
        ctl<{ callControlId: string; callSessionId: string }>("incoming", { from: farEnd(index), to: line.e164 }),
      ),
    );

    // Ring.
    const ringStart = performance.now();
    const ringEnd = await drain(sign, acks);
    let legs = await ctl<Leg[]>("legs");
    const dials = legs.filter((leg) => leg.origin === "dial");
    const perLine = new Map<number, number>();
    for (const leg of dials) {
      const at = lineOf(leg);
      if (at !== undefined) perLine.set(at, (perLine.get(at) ?? 0) + 1);
    }
    const ringed = active.filter((_, index) => (perLine.get(index) ?? 0) > 0).length;
    const maxDials = Math.max(0, ...perLine.values());
    // Per call, on the switch's own clock: customer dials in -> crew phones ring.
    const firstRingByCall = customers.flatMap((customer, index) => {
      const incoming = legs.find((leg) => leg.callControlId === customer.callControlId);
      const starts = dials.filter((leg) => lineOf(leg) === index).map((leg) => leg.startedAtMs);
      return incoming && starts.length > 0 ? [Math.min(...starts) - incoming.startedAtMs] : [];
    });
    const lastRingByCall = customers.flatMap((customer, index) => {
      const incoming = legs.find((leg) => leg.callControlId === customer.callControlId);
      const starts = dials.filter((leg) => lineOf(leg) === index).map((leg) => leg.startedAtMs);
      return incoming && starts.length > 0 ? [Math.max(...starts) - incoming.startedAtMs] : [];
    });

    // Answer: the first crew phone of each call picks up.
    const answerStart = performance.now();
    const answering = new Map<number, Leg>();
    for (const leg of dials.sort((a, b) => a.startedAtMs - b.startedAtMs)) {
      const at = lineOf(leg);
      if (at !== undefined && !answering.has(at)) answering.set(at, leg);
    }
    await Promise.all([...answering.values()].map((leg) => ctl("answer", { callControlId: leg.callControlId })));
    const answerEnd = await drain(sign, acks);
    legs = await ctl<Leg[]>("legs");
    const others = legs.filter(
      (leg) => leg.origin === "dial" && !([...answering.values()].some((a) => a.callControlId === leg.callControlId)),
    );
    const answeredAt = new Map(legs.map((leg) => [leg.callControlId, leg.answeredAtMs]));
    const othersEndedByCall = [...answering.entries()].flatMap(([index, picked]) => {
      const ended = others.filter((leg) => lineOf(leg) === index && leg.endedAtMs !== null);
      const pickedAt = answeredAt.get(picked.callControlId) ?? null;
      return ended.length > 0 && pickedAt !== null
        ? [Math.max(...ended.map((leg) => leg.endedAtMs as number)) - pickedAt]
        : [];
    });
    const strandedRinging = others.filter((leg) => leg.state === "ringing").length;

    // End: every caller hangs up.
    const endStart = performance.now();
    await Promise.all(customers.map((customer) => ctl("hangup", { callControlId: customer.callControlId })));
    const endEnd = await drain(sign, acks);
    legs = await ctl<Leg[]>("legs");
    const leaked = legs.filter((leg) => leg.state !== "ended").length;
    const ledger = await ctl<{ ledger: { dials: number; peakConcurrentLegs: number } }>("ledger");
    const windowEnd = new Date().toISOString();

    const statuses = countStatuses(acks);
    const refused = acks.filter((ack) => ack.status === 0 || ack.status >= 500).length;
    const record = {
      schema: "loonext.capacity.v1",
      scenario: "hosted-call-session-burst",
      environment: "deployed-nonproduction",
      tested_bound: { simultaneous_calls: level, crew_per_call: crew },
      window: { start: windowStart, end: windowEnd },
      ceiling_reached: refused > 0 || ringed < level || strandedRinging > 0 || leaked > 0,
      measurements: {
        driver_ring_settle_ms: Math.round(ringEnd - ringStart),
        driver_answer_settle_ms: Math.round(answerEnd - answerStart),
        driver_end_settle_ms: Math.round(endEnd - endStart),
        calls_ringing: ringed,
        dials: ledger.ledger.dials,
        dials_expected: level * crew,
        max_dials_in_one_call: maxDials,
        switch_first_ring_ms: summarize(firstRingByCall),
        switch_last_ring_ms: summarize(lastRingByCall),
        switch_answer_to_others_hung_up_ms: summarize(othersEndedByCall),
        webhook_posts: acks.length,
        ack_statuses: statuses,
        ack_ms: summarize(acks.map((ack) => ack.ms)),
        ack_5xx_or_network: refused,
        ring_legs_stranded: strandedRinging,
        legs_left_alive: leaked,
        peak_concurrent_legs: ledger.ledger.peakConcurrentLegs,
      },
      notes: [
        "Driver milliseconds include the network path to Cloudflare; switch milliseconds are one Cloudflare clock.",
        "Durable Object CPU and wall time come from Cloudflare analytics for the printed window.",
      ],
    };
    process.stdout.write(`CAPACITY_RESULT ${JSON.stringify(record)}\n`);
    await sleep(gapMs);
  }
}

main().catch((cause: unknown) => {
  process.stderr.write(
    cause instanceof CapacityConfigError || (cause instanceof Error && /required|switch control/.test(cause.message))
      ? `capacity: ${cause.message}\n`
      : "capacity: driver failed; no unreviewed error details were printed\n",
  );
  process.exitCode = 1;
});
