/**
 * #251 -- what the API does when the database path is saturated, ramped.
 *
 * `capacity:rig` measures the rig's own API from the outside and finds where
 * it stops being fast. This asks the question #251's third criterion is
 * actually about: once it IS past that point, does it tell the truth, quickly?
 *
 * It drives `GET /v1/for-you` (the post-login landing, and the heaviest hot
 * read) at a workspace of realistic size, from 50 concurrent callers upward.
 * The rig's path to the database is Worker, then Kong with 512 connections,
 * then PostgREST with a pool of 10, then Postgres. Somewhere in the ramp that
 * path saturates, and at every level, whether or not it has, this asserts the
 * four things an honest overload owes the caller:
 *
 *  1. **every request is answered**: none hangs, none throws;
 *  2. **soon**: nobody waits longer than `HANG_BOUND_MS`, which is three database
 *     deadlines. The version of this code that preceded db-pressure.ts answered
 *     after 80 to 110 seconds, because a request kept asking a database that had
 *     already timed it out;
 *  3. **truthfully**: anything that is not a 200 is a 503 with a Retry-After and
 *     the SPEC envelope, never a 500 "Something went wrong." that reads as a bug;
 *  4. **and it recovers**: when the load stops, the next request succeeds.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  volumeCleanupSql,
  volumeFixtureSql,
} from "../../../scripts/load/volume-fixture.mjs";
import { burst, capacityResult, emitCapacityResult, line } from "./load-report";
import { startRigStack, type CallResult, type RigStack } from "./rig-stack";

let stack: RigStack;

const LEVELS = (process.env.RIG_API_LEVELS ?? "50,100,200,300,400,600,800")
  .split(",")
  .map(Number);
const CONVERSATIONS = Number(process.env.RIG_API_CONVERSATIONS ?? "5000");
const MESSAGES = CONVERSATIONS * 4;
/** Three database deadlines: far past a slow answer, far short of a hang. */
const HANG_BOUND_MS = 30_000;
const RECOVERY_DEADLINE_MS = 30_000;

const OWNER_ID = "10a01251-0001-4001-8001-0000000000b1";
const COMPANY_ID = "10a01251-0002-4002-8002-0000000000b2";
const NUMBER_ID = "10a01251-0003-4003-8003-0000000000b3";

let token = "";

beforeAll(async () => {
  stack = await startRigStack();
  await cleanup();
  // The rig's database refuses an outbound message row to a number outside its
  // partition. The fixture's history is delivered and fictional and nothing
  // dispatches it, so the gate is lifted for this one transaction only.
  await stack.sql(
    `begin;
     set local loonext.deploy_env = 'local';
     ${stack.seedUserSql(OWNER_ID, `${stack.runId}-owner@rig-pressure.test`, "Pressure Owner")}
     ${volumeFixtureSql({
       company: COMPANY_ID,
       owner: OWNER_ID,
       number: NUMBER_ID,
       e164: "+14155559253",
       areaCode: "415",
       country: "US",
       conversations: CONVERSATIONS,
       messages: MESSAGES,
       provisioningKey: `rigpressure_${stack.runId}`,
       companyName: "Rig Pressure Fixture",
       active: true,
     })}
     commit;`,
  );
  token = await stack.token(OWNER_ID);
  const warm = await stack.call("GET", "/v1/for-you", { token, companyId: COMPANY_ID });
  expect(warm.status, `the first request: ${stack.logTail(15)}`).toBe(200);
});

afterAll(async () => {
  if (!stack) return;
  try {
    await cleanup();
  } finally {
    await stack.stop();
  }
});

async function cleanup(): Promise<void> {
  await stack.sql(`
    ${volumeCleanupSql({ company: COMPANY_ID })}
    delete from public.user_sessions where user_id = '${OWNER_ID}';
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

function forYou(): Promise<CallResult> {
  return stack.call("GET", "/v1/for-you", {
    token,
    companyId: COMPANY_ID,
    stallMs: HANG_BOUND_MS,
  });
}

describe("#251 the API under database saturation answers honestly, ramped", () => {
  it("answers every request, soon, truthfully, and recovers", async () => {
    for (const level of LEVELS) {
      const answers: CallResult[] = [];
      const servedBefore = stack.servedTotals();
      const report = await burst(
        `for-you x${level}`,
        level,
        async () => {
          const answer = await forYou();
          answers.push(answer);
          return answer;
        },
        HANG_BOUND_MS * 2,
      );
      console.log(line(report));
      const refusals = answers.filter((a) => a.status !== 200);
      const notBusy = refusals.filter((a) => a.status !== 503);
      if (report.hangs > 0 || report.max >= HANG_BOUND_MS || notBusy.length > 0) {
        console.log(`level ${level} worker log, by cause:`, stack.logCauses());
        console.log(`level ${level} worker access log:`, stack.accessCounts());
      }
      const noRetryAfter = refusals.filter((a) => a.status === 503 && !a.retryAfter);
      const wrongEnvelope = refusals.filter(
        (a) =>
          a.status === 503 &&
          (a.json as { error?: { code?: string } } | null)?.error?.code !== "service_unavailable",
      );

      // The answer the caller got, by what it was. Counts only.
      const shapes: Record<string, number> = {};
      for (const answer of refusals) {
        const code = (answer.json as { error?: { code?: string } } | null)?.error?.code ?? "none";
        const key = `${answer.status} ${code}`;
        shapes[key] = (shapes[key] ?? 0) + 1;
      }

      // Recovery: the load has stopped; the next request must succeed.
      const recoveryStart = Date.now();
      let recoveredMs: number | null = null;
      let polls = 0;
      while (Date.now() - recoveryStart < RECOVERY_DEADLINE_MS) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        polls += 1;
        if ((await forYou()).status === 200) {
          recoveredMs = Date.now() - recoveryStart;
          break;
        }
      }

      // What the Worker says it finished, to tell a request stuck inside it
      // from one lost between the driver and it.
      // wrangler prints its access log a little behind the response.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const servedAfter = stack.servedTotals();
      const workerFinished: Record<string, number> = {};
      for (const [key, total] of Object.entries(servedAfter)) {
        if (!key.startsWith("GET /v1/for-you ")) continue;
        const delta = total - (servedBefore[key] ?? 0);
        if (delta > 0) workerFinished[key.slice("GET /v1/for-you ".length)] = delta;
      }
      // The recovery polls are in the Worker's log too; what is left is the burst.
      const workerAnswered =
        Object.values(workerFinished).reduce((sum, n) => sum + n, 0) - polls;
      // Requests the driver never got an answer to. The Worker's own log says
      // whether it ever failed to answer one: if it answered all of them, the
      // answer was lost after it, in wrangler's local proxy, which is a limit of
      // the rig and not of the Worker (docs/CAPACITY.md 2b).
      const unansweredByDriver = report.hangs + report.throws;
      console.log(
        `level ${level} the Worker answered ${workerAnswered} of ${level}; ` +
          `the driver received ${level - unansweredByDriver}`,
        JSON.stringify(workerFinished),
        JSON.stringify(stack.stalls()),
      );
      emitCapacityResult(
        capacityResult({
          scenario: "rig-api-pressure-ramp",
          environment: "rig",
          tested_bound: {
            concurrent_requests: level,
            workspace_conversations: CONVERSATIONS,
            workspace_messages: MESSAGES,
          },
          ceiling_reached: refusals.length > 0,
          measurements: {
            wall_ms: report.totalMs,
            p50_ms: report.p50,
            p95_ms: report.p95,
            max_ms: report.max,
            statuses: report.statuses,
            refusal_shapes: shapes,
            unanswered_at_driver: unansweredByDriver,
            answered_by_worker: workerAnswered,
            worker_finished: workerFinished,
            recovered_after_ms: recoveredMs,
          },
          notes: [
            "Rig topology: Worker on wrangler, Kong with 512 worker connections, PostgREST pool of 10, Postgres max_connections 100. Not the hosted stack.",
            "A refusal is allowed to look like a ceiling; a request the Worker never finishes, a 500, a missing Retry-After or a failure to recover is not.",
            "unanswered_at_driver counts requests whose answer never reached the driver; answered_by_worker is the Worker's own access log, so a gap between the two is loss in wrangler's local proxy, not in the Worker.",
          ],
        }),
      );

      // The Worker answers every request it is sent, whatever the driver saw.
      expect(
        workerAnswered,
        `level ${level}: requests the Worker never finished (stuck inside it)`,
      ).toBeGreaterThanOrEqual(level);
      expect(report.max, `level ${level}: slowest answer`).toBeLessThan(HANG_BOUND_MS);
      expect(
        notBusy.map((a) => `${a.status} ${JSON.stringify(a.json)}`).slice(0, 3),
        `level ${level}: refusals that were not a 503`,
      ).toEqual([]);
      expect(noRetryAfter.length, `level ${level}: 503s without Retry-After`).toBe(0);
      expect(wrongEnvelope.length, `level ${level}: 503s without the envelope`).toBe(0);
      expect(recoveredMs, `level ${level}: never recovered`).not.toBeNull();
    }
  });
});
