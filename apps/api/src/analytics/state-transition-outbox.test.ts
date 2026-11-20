import { afterEach, expect, it, vi } from "vitest";

import { getEnv } from "../env";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { deliverStateTransitions } from "./state-transition-outbox";

afterEach(() => vi.unstubAllGlobals());

it("retries a refused batch with the same event identity and acknowledges only after acceptance", async () => {
  const binding = { ...completeEnv(), POSTHOG_API_KEY: "phc_fixture" };
  const env = getEnv(binding);
  const db = supabaseStub(binding);
  const claimPath = "/rest/v1/rpc/api_claim_state_transitions";
  const ackPath = "/rest/v1/rpc/api_ack_state_transitions";
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    company_id: "00000000-0000-4000-8000-000000000002",
    machine: "task",
    record_id: "00000000-0000-4000-8000-000000000003",
    from_state: "open",
    to_state: "done",
    expected: true,
    cause: "/v1/tasks?query=private",
    occurred_at: "2026-11-20T12:00:00.000Z",
  };
  db.on("POST", claimPath, () => [row]);
  db.on("POST", ackPath, () => new Response(null, { status: 204 }));
  const batches: unknown[] = [];
  stubFetch(db.route, async (url, request) => {
    if (url.href !== "https://us.i.posthog.com/batch/") return;
    batches.push(await request.json());
    return new Response(null, { status: batches.length === 1 ? 503 : 200 });
  });

  await expect(deliverStateTransitions(env)).rejects.toThrow("PostHog batch answered HTTP 503");
  expect(db.find("POST", ackPath)).toHaveLength(0);
  await deliverStateTransitions(env);
  expect(batches).toHaveLength(2);
  expect(batches[1]).toEqual(batches[0]);
  expect(batches[0]).toEqual({
    api_key: "phc_fixture",
    batch: [{
      event: "state_transition",
      uuid: row.id,
      timestamp: row.occurred_at,
      distinct_id: row.company_id,
      properties: {
        machine: "task",
        record_id: row.record_id,
        from: "open",
        to: "done",
        expected: true,
        cause: "/v1/tasks",
        environment: "local",
        $process_person_profile: false,
      },
    }],
  });
  expect(db.find("POST", ackPath)).toHaveLength(1);
});
