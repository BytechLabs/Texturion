/**
 * geocode-tasks cron (#214 Map fix): selects address-bearing tasks needing a
 * geocode, geocodes each via Nominatim (1 req/s), caches lat/lng/geocoded_at/
 * geocode_status, and gates the write-back on the address columns so a
 * concurrent edit wins. Only the network edge (PostgREST + Nominatim) is
 * stubbed; the injected sleeper avoids real waits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import {
  geocodeTasksJob,
  taskAddressQuery,
  type Sleeper,
} from "./geocode-tasks";
import { NOMINATIM_BASE } from "./nominatim";

const env = completeEnv();
afterEach(() => vi.unstubAllGlobals());

interface TaskRow {
  id: string;
  addr_street: string | null;
  addr_unit: string | null;
  addr_city: string | null;
  addr_state: string | null;
  addr_postal_code: string | null;
  addr_country: string | null;
}

function stubWorld(
  scanRows: TaskRow[],
  geocodeFor: (q: string) => unknown,
): {
  route: FetchRoute;
  captured: { nominatim: URL[]; updates: { url: URL; body: unknown }[] };
} {
  const captured = { nominatim: [] as URL[], updates: [] as { url: URL; body: unknown }[] };
  const route: FetchRoute = (url, request) => {
    if (url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/tasks`)) {
      if (request.method === "GET") return Response.json(scanRows);
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

const CN_TOWER: TaskRow = {
  id: "t1",
  addr_street: "CN Tower",
  addr_unit: null,
  addr_city: "Toronto",
  addr_state: "ON",
  addr_postal_code: null,
  addr_country: "Canada",
};

describe("taskAddressQuery", () => {
  it("joins the non-null address columns into one geocodable string", () => {
    expect(taskAddressQuery(CN_TOWER)).toBe("CN Tower, Toronto, ON, Canada");
  });
});

describe("geocodeTasksJob", () => {
  it("geocodes the task's OWN address and caches lat/lng + status=ok", async () => {
    const { route, captured } = stubWorld([CN_TOWER], () => [
      { lat: "43.6426", lon: "-79.3871" },
    ]);
    stubFetch(route);

    await geocodeTasksJob(env, undefined, noSleep);

    expect(captured.nominatim).toHaveLength(1);
    expect(captured.nominatim[0].searchParams.get("q")).toBe(
      "CN Tower, Toronto, ON, Canada",
    );
    expect(captured.updates).toHaveLength(1);
    const write = captured.updates[0];
    expect(write.url.searchParams.get("id")).toBe("eq.t1");
    // The write-back gates on the address columns (concurrent edit wins).
    expect(write.url.searchParams.get("addr_street")).toBe("eq.CN Tower");
    expect(write.url.searchParams.get("addr_unit")).toBe("is.null");
    expect(write.body).toMatchObject({
      lat: 43.6426,
      lng: -79.3871,
      geocode_status: "ok",
    });
  });

  it("marks a task Nominatim can't place as no_address (terminal)", async () => {
    const { route, captured } = stubWorld([CN_TOWER], () => []);
    stubFetch(route);

    await geocodeTasksJob(env, undefined, noSleep);

    expect(captured.updates[0].body).toMatchObject({
      geocode_status: "no_address",
    });
    expect(captured.updates[0].body).not.toHaveProperty("lat");
  });
});
