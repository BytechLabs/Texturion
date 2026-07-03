/**
 * geocode-contacts cron (D25): selects addressed contacts still needing
 * geocoding, geocodes via Nominatim (1 req/s), caches lat/lng/geocoded_at/
 * geocode_status, and is idempotent (skips already-geocoded). Only the network
 * edge (PostgREST + Nominatim) is stubbed; the injected sleeper avoids real
 * waits while proving the pacing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import {
  geocodeContactsJob,
  GEOCODE_BATCH,
  type Sleeper,
} from "./geocode-contacts";
import { NOMINATIM_BASE, NOMINATIM_MIN_INTERVAL_MS } from "./nominatim";

const env = completeEnv();

afterEach(() => vi.unstubAllGlobals());

interface Captured {
  scans: URL[];
  updates: { url: URL; body: unknown }[];
  nominatim: URL[];
}

/**
 * A PostgREST + Nominatim double for the cron. `contacts` returns `scanRows`
 * for the GET scan and echoes for the PATCH cache write; Nominatim answers per
 * `geocodeMap` (address query → rows), defaulting to a Toronto hit.
 */
function stubGeocodeWorld(
  scanRows: { id: string; address: string | null }[],
  geocodeFor: (q: string) => unknown,
): { route: FetchRoute; captured: Captured } {
  const captured: Captured = { scans: [], updates: [], nominatim: [] };
  const route: FetchRoute = (url, request) => {
    if (url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/contacts`)) {
      if (request.method === "GET") {
        captured.scans.push(url);
        return Response.json(scanRows);
      }
      if (request.method === "PATCH") {
        return (async () => {
          const body = await request.clone().json();
          captured.updates.push({ url, body });
          return Response.json([]);
        })();
      }
    }
    if (url.href.startsWith(`${NOMINATIM_BASE}/search`)) {
      captured.nominatim.push(url);
      return Response.json(geocodeFor(url.searchParams.get("q") ?? ""));
    }
    return undefined;
  };
  return { route, captured };
}

const noSleep: Sleeper = async () => {};

describe("geocodeContactsJob", () => {
  it("geocodes an addressed contact and caches lat/lng + status=ok", async () => {
    const { route, captured } = stubGeocodeWorld(
      [{ id: "c1", address: "1 King St W, Toronto" }],
      () => [{ lat: "43.6489", lon: "-79.3817" }],
    );
    stubFetch(route);

    await geocodeContactsJob(env, undefined, noSleep);

    expect(captured.nominatim).toHaveLength(1);
    expect(captured.updates).toHaveLength(1);
    const write = captured.updates[0];
    expect(write.url.searchParams.get("id")).toBe("eq.c1");
    expect(write.body).toMatchObject({
      lat: 43.6489,
      lng: -79.3817,
      geocode_status: "ok",
    });
    expect(typeof (write.body as { geocoded_at: string }).geocoded_at).toBe(
      "string",
    );
  });

  it("guards the cache write-back on the captured address (a concurrent edit wins, no stale coordinate)", async () => {
    const { route, captured } = stubGeocodeWorld(
      [{ id: "c1", address: "1 King St W, Toronto" }],
      () => [{ lat: "43.6489", lon: "-79.3817" }],
    );
    stubFetch(route);

    await geocodeContactsJob(env, undefined, noSleep);

    // The UPDATE is scoped to BOTH the id AND the address we geocoded, so a row
    // whose address changed under us matches zero rows and keeps its coordinate.
    const write = captured.updates[0];
    expect(write.url.searchParams.get("id")).toBe("eq.c1");
    expect(write.url.searchParams.get("address")).toBe("eq.1 King St W, Toronto");
  });

  it("scans only rows that still need geocoding (null/failed), with an address, not deleted", async () => {
    const { route, captured } = stubGeocodeWorld([], () => []);
    stubFetch(route);

    await geocodeContactsJob(env, undefined, noSleep);

    const scan = captured.scans[0];
    // Excludes soft-deleted + null-address; only pending/failed statuses.
    expect(scan.searchParams.get("deleted_at")).toBe("is.null");
    expect(scan.searchParams.get("address")).toBe("not.is.null");
    expect(scan.searchParams.get("or")).toBe(
      "(geocode_status.eq.pending,geocode_status.eq.failed)",
    );
    expect(scan.searchParams.get("limit")).toBe(String(GEOCODE_BATCH));
    // No rows → no geocode calls (skip-already-geocoded is enforced by the query).
    expect(captured.nominatim).toHaveLength(0);
  });

  it("caches status=no_address (terminal) when Nominatim has no result — no lat/lng", async () => {
    const { route, captured } = stubGeocodeWorld(
      [{ id: "c2", address: "nowhere" }],
      () => [],
    );
    stubFetch(route);

    await geocodeContactsJob(env, undefined, noSleep);
    const body = captured.updates[0].body as Record<string, unknown>;
    // Present-but-unplaceable address → the terminal 'no_address' state (no pin).
    expect(body.geocode_status).toBe("no_address");
    expect(body).not.toHaveProperty("lat");
    expect(body).not.toHaveProperty("lng");
  });

  it("caches status=failed (retryable) on a Nominatim error and does not set lat/lng", async () => {
    const captured: Captured = { scans: [], updates: [], nominatim: [] };
    stubFetch((url, request) => {
      if (url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/contacts`)) {
        if (request.method === "GET") return Response.json([{ id: "c3", address: "x" }]);
        return (async () => {
          captured.updates.push({ url, body: await request.clone().json() });
          return Response.json([]);
        })();
      }
      if (url.href.startsWith(`${NOMINATIM_BASE}/search`)) {
        return new Response("upstream", { status: 503 });
      }
      return undefined;
    });

    await geocodeContactsJob(env, undefined, noSleep);
    const body = captured.updates[0].body as Record<string, unknown>;
    expect(body.geocode_status).toBe("failed");
    expect(body).not.toHaveProperty("lat");
  });

  it("paces requests ≥1s apart between rows (Nominatim fair-use), never before the first", async () => {
    const { route } = stubGeocodeWorld(
      [
        { id: "c1", address: "a" },
        { id: "c2", address: "b" },
        { id: "c3", address: "c" },
      ],
      () => [{ lat: "1", lon: "2" }],
    );
    stubFetch(route);

    const sleeps: number[] = [];
    const recordSleep: Sleeper = async (ms) => {
      sleeps.push(ms);
    };
    await geocodeContactsJob(env, undefined, recordSleep);

    // 3 rows → 2 inter-request sleeps (none before the first request).
    expect(sleeps).toEqual([
      NOMINATIM_MIN_INTERVAL_MS,
      NOMINATIM_MIN_INTERVAL_MS,
    ]);
  });
});
