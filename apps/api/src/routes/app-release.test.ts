/**
 * #339 — the update policy endpoint.
 *
 * Almost everything here asserts the same property from a different angle: it
 * FAILS OPEN. The issue's devil's advocate is blunt about why — a misconfigured
 * floor "locks out every user at once with no way in to fix it", and the people
 * being locked out are running their business phone line off this app. So a
 * missing row, an unknown platform, a database outage and a malformed query all
 * have to end at the same place: 200, no demands.
 *
 * The second property is that it is reachable WITHOUT a token, because the
 * reason to force an update may be that auth is broken in the old build.
 */
import { describe, expect, it, vi } from "vitest";

import { app } from "../index";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

const env = completeEnv();

/** A PostgREST responder for the policy RPC. */
function policyRoute(policy: unknown, status = 200): FetchRoute {
  return (url) =>
    url.pathname.endsWith("/rpc/api_app_release_policy")
      ? new Response(JSON.stringify(policy), {
          status,
          headers: { "content-type": "application/json" },
        })
      : undefined;
}

describe("GET /app-release", () => {
  it("answers without any Authorization header at all", async () => {
    // The point of the route. If forcing an update ever becomes necessary
    // BECAUSE sign-in is broken (#268), a gate behind sign-in is no gate.
    stubFetch(
      policyRoute({
        platform: "ios",
        recommended_version: "1.4.0",
        minimum_version: null,
        message: "Faster threads",
        update_url: "https://apps.apple.com/app/id123",
      }),
    );

    const res = await app.request("/app-release?platform=ios", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      platform: "ios",
      recommended_version: "1.4.0",
      minimum_version: null,
      message: "Faster threads",
    });
  });

  it("carries the floor and the reason together", async () => {
    stubFetch(
      policyRoute({
        platform: "android",
        recommended_version: "2.1.0",
        minimum_version: "2.0.0",
        message: "A security fix",
        update_url: "https://play.google.com/store/apps/details?id=x",
      }),
    );

    const res = await app.request("/app-release?platform=android", {}, env);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.minimum_version).toBe("2.0.0");
    // A demand with no reason reads as an ad for our own convenience.
    expect(body.message).toBe("A security fix");
    expect(body.update_url).toContain("play.google.com");
  });

  it("asks nothing of an unknown platform instead of erroring", async () => {
    stubFetch();  // must not reach the database at all

    const res = await app.request("/app-release?platform=symbian", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      platform: "symbian",
      minimum_version: null,
      recommended_version: null,
    });
  });

  it("asks nothing when the platform is missing entirely", async () => {
    stubFetch();
    const res = await app.request("/app-release", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ minimum_version: null });
  });

  it("fails OPEN when the database is unreachable", async () => {
    // The failure that would otherwise be catastrophic: a Postgres blip
    // becoming a fleet-wide update screen. One person on last week's build is
    // a cost worth paying to make that impossible.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch((url) =>
      url.pathname.endsWith("/rpc/api_app_release_policy")
        ? new Response("boom", { status: 500 })
        : undefined,
    );

    const res = await app.request("/app-release?platform=web", {}, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      platform: "web",
      minimum_version: null,
      recommended_version: null,
    });
    // Permissive, but never silent.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fails OPEN when the policy row is missing", async () => {
    stubFetch(policyRoute(null));
    const res = await app.request("/app-release?platform=web", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ minimum_version: null });
  });

  it("is cacheable, so a cold start does not cost a database round trip", async () => {
    stubFetch(policyRoute({ platform: "web", recommended_version: null, minimum_version: null, message: null, update_url: null }));
    const res = await app.request("/app-release?platform=web", {}, env);
    // Short enough that LOWERING a floor takes effect quickly, which is the
    // direction that matters — lowering is the rollback.
    expect(res.headers.get("cache-control")).toContain("max-age=300");
  });

  it("normalises the platform rather than treating case as unknown", async () => {
    stubFetch(policyRoute({ platform: "ios", recommended_version: "1.4.0", minimum_version: null, message: null, update_url: null }));
    const res = await app.request("/app-release?platform=iOS", {}, env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.recommended_version).toBe("1.4.0");
  });
});
