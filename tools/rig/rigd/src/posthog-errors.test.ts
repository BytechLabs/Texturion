import { describe, expect, it } from "vitest";
import { PostHogErrors, POSTHOG_CAPTURE_URL } from "./posthog-errors.ts";
import { fakeFetch, json } from "./test-support.ts";

describe("PostHogErrors", () => {
  it("sends a scenario failure as a synthetic exception with its fingerprint, and says whether it went", async () => {
    const { fetch, requests } = fakeFetch({ POST: () => new Response("{}") });
    const posthog = new PostHogErrors({ projectKey: "phc_rig_test_key", fetch });
    expect(posthog.canSend).toBe(true);
    expect(await posthog.send({ fingerprint: ["synthetic", "S02", "no_ring"], message: "S02 failed: no_ring", level: "fatal", runId: "r1", tags: { scenario: "S02" } })).toEqual({ sent: true });

    expect(requests[0]!.url).toBe(POSTHOG_CAPTURE_URL);
    const body = JSON.parse(requests[0]!.body!);
    expect(body).toMatchObject({ api_key: "phc_rig_test_key", event: "$exception", distinct_id: "loonext-rig" });
    expect(body.properties).toMatchObject({
      environment: "synthetic",
      $exception_fingerprint: "synthetic:S02:no_ring",
      $exception_level: "fatal",
      run_id: "r1",
      scenario: "S02",
      $process_person_profile: false,
    });

    const down = fakeFetch({ POST: () => new Response("no", { status: 503 }) });
    expect(await new PostHogErrors({ projectKey: "k", fetch: down.fetch }).send({ fingerprint: ["a"], message: "m" })).toEqual({ sent: false, reason: "send_failed" });
    expect(await new PostHogErrors({}).send({ fingerprint: ["a"], message: "m" })).toEqual({ sent: false, reason: "send_failed" });
  });

  it("reads the rig's exceptions with HogQL under the personal key, and refuses to read without one", async () => {
    const { fetch, requests } = fakeFetch({ POST: () => json({ results: [[1_700_000_000, "error", null, [{ type: "Error", value: "boom" }], "api", "GET /x", null, null, null]] }) });
    const posthog = new PostHogErrors({ personalKey: "phx_rig_test_key", projectId: "7", fetch });
    const [seen] = await posthog.apiExceptions(1_699_999_000_000);

    expect(requests[0]!.url).toBe("https://us.posthog.com/api/environments/7/query/");
    expect(requests[0]!.headers.authorization).toBe("Bearer phx_rig_test_key");
    const sql = JSON.parse(requests[0]!.body!).query.query as string;
    expect(sql).toContain("properties.environment = 'rig'");
    expect(sql).toContain("toDateTime(1699999000)");
    expect(seen).toMatchObject({ at: 1_700_000_000_000, level: "error", message: "boom", tags: { source: "api", route: "GET /x" } });

    await expect(new PostHogErrors({}).apiExceptions(0)).rejects.toThrow(/not both in the rig's store/);
    const rejected = fakeFetch({ POST: () => new Response("no", { status: 401 }) });
    await expect(new PostHogErrors({ personalKey: "k", projectId: "7", fetch: rejected.fetch }).apiExceptions(0)).rejects.toThrow(/401/);
  });
});
