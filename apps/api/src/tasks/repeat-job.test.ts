import { afterEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch } from "../test/support";
import { restMatch, rpcMatch, stubRoute } from "../test/messaging-support";
import { runTaskRepeatsJob } from "./repeat-job";

const env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runTaskRepeatsJob (#693)", () => {
  it("asks for a bounded batch at the tick's own time and returns what was made", async () => {
    const rpc = stubRoute(rpcMatch(env, "api_materialize_task_repeats"), () => 3);
    stubFetch(rpc.route);
    const made = await runTaskRepeatsJob(env, new Date("2027-03-02T12:00:00Z"));
    expect(made).toBe(3);
    expect(rpc.calls[0].body).toEqual({
      p_limit: 200,
      p_now: "2027-03-02T12:00:00.000Z",
    });
  });

  it("fails the job when the database refuses, so the failure is reported", async () => {
    const rpc = stubRoute(rpcMatch(env, "api_materialize_task_repeats"), () =>
      new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    stubFetch(rpc.route);
    await expect(runTaskRepeatsJob(env)).rejects.toThrow(/task repeat run failed/);
    void restMatch;
  });
});
