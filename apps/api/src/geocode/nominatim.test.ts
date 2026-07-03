/**
 * Nominatim geocoding client (D25): the network edge (fetch) is the only stub.
 * Asserts the request shape (policy UA, US/CA bias, limit 1) and the folding of
 * every outcome into a GeocodeResult (ok / not_found / failed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFetch, type FetchRoute } from "../test/support";
import {
  geocodeAddress,
  NOMINATIM_BASE,
  NOMINATIM_USER_AGENT,
} from "./nominatim";

afterEach(() => vi.unstubAllGlobals());

/** Route claiming Nominatim /search, returning `rows` and capturing the request. */
function nominatimRoute(
  rows: unknown,
  captured?: { url?: URL; headers?: Headers },
  status = 200,
): FetchRoute {
  return (url, request) => {
    if (!url.href.startsWith(`${NOMINATIM_BASE}/search`)) return undefined;
    if (captured) {
      captured.url = url;
      captured.headers = request.headers;
    }
    return Response.json(rows, { status });
  };
}

describe("geocodeAddress", () => {
  it("returns ok with parsed lat/lng and sends a policy-compliant request", async () => {
    const captured: { url?: URL; headers?: Headers } = {};
    stubFetch(
      nominatimRoute(
        [{ lat: "43.6489", lon: "-79.3817", display_name: "Toronto" }],
        captured,
      ),
    );

    const result = await geocodeAddress("1 King St W, Toronto");
    expect(result).toEqual({
      status: "ok",
      hit: { lat: 43.6489, lng: -79.3817 },
    });
    // Policy UA + US/CA bias + single result.
    expect(captured.headers?.get("User-Agent")).toBe(NOMINATIM_USER_AGENT);
    expect(captured.url?.searchParams.get("format")).toBe("json");
    expect(captured.url?.searchParams.get("limit")).toBe("1");
    expect(captured.url?.searchParams.get("countrycodes")).toBe("us,ca");
    expect(captured.url?.searchParams.get("q")).toBe("1 King St W, Toronto");
  });

  it("returns not_found on zero results (a terminal answer)", async () => {
    stubFetch(nominatimRoute([]));
    expect(await geocodeAddress("nowhere at all")).toEqual({
      status: "not_found",
    });
  });

  it("returns not_found without a request for an empty address", async () => {
    stubFetch(); // no fetch allowed
    expect(await geocodeAddress("   ")).toEqual({ status: "not_found" });
  });

  it("returns not_found when the row has no usable coordinate", async () => {
    stubFetch(nominatimRoute([{ display_name: "x" }]));
    expect(await geocodeAddress("somewhere")).toEqual({ status: "not_found" });
  });

  it("returns failed (retryable) on a non-2xx response", async () => {
    stubFetch(nominatimRoute([], undefined, 429));
    const result = await geocodeAddress("Toronto");
    expect(result.status).toBe("failed");
  });

  it("returns failed (retryable) on a transport error", async () => {
    stubFetch((url) => {
      if (url.href.startsWith(`${NOMINATIM_BASE}/search`)) {
        throw new Error("network down");
      }
      return undefined;
    });
    const result = await geocodeAddress("Toronto");
    expect(result).toMatchObject({ status: "failed" });
  });
});
