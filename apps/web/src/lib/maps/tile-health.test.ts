import { describe, expect, it, vi } from "vitest";

import { reportClientError } from "@/lib/observability/errors";
import { scrubUnknown } from "@/lib/observability/scrub";

import { createTileHealth, reportTileFailure, TILE_ERROR_THRESHOLD } from "./tile-health";

vi.mock("@/lib/observability/errors", () => ({ reportClientError: vi.fn() }));

/**
 * #428 ask 4 — noticing that the basemap stopped drawing.
 *
 * The bug being prevented is an ABSENCE: a blocked provider leaves tiles blank,
 * markers still plot, nothing throws. Every test here is about the difference
 * between "incidental" and "we are being refused".
 */

describe("createTileHealth", () => {
  it("stays quiet below the threshold", () => {
    // A single 404 is ordinary: the edge of the world at high zoom, a sea tile a
    // provider does not store, a dropped request on a job-site connection.
    const onUnhealthy = vi.fn();
    const health = createTileHealth({ onUnhealthy });
    for (let i = 0; i < TILE_ERROR_THRESHOLD - 1; i += 1) {
      health.recordError("https://tiles.example.com/1/2/3.png");
    }
    expect(onUnhealthy).not.toHaveBeenCalled();
    expect(health.unhealthy).toBe(false);
  });

  it("reports once the failures stop looking incidental", () => {
    const onUnhealthy = vi.fn();
    const health = createTileHealth({ onUnhealthy });
    for (let i = 0; i < TILE_ERROR_THRESHOLD; i += 1) {
      health.recordError("https://tiles.example.com/1/2/3.png");
    }
    expect(onUnhealthy).toHaveBeenCalledTimes(1);
    expect(onUnhealthy).toHaveBeenCalledWith({
      errors: TILE_ERROR_THRESHOLD,
      sample: "https://tiles.example.com/1/2/3.png",
    });
    expect(health.unhealthy).toBe(true);
  });

  it("reports ONCE, however many more tiles fail", () => {
    // A blocked provider fails every tile in the viewport, and a report per tile
    // would turn an outage into a telemetry bill while saying nothing new.
    const onUnhealthy = vi.fn();
    const health = createTileHealth({ onUnhealthy });
    for (let i = 0; i < TILE_ERROR_THRESHOLD * 10; i += 1) {
      health.recordError("https://tiles.example.com/1/2/3.png");
    }
    expect(onUnhealthy).toHaveBeenCalledTimes(1);
    expect(health.errorCount).toBe(TILE_ERROR_THRESHOLD * 10);
  });

  it("keeps the FIRST failing tile as the sample", () => {
    // The first one is the diagnostic: it carries the URL template actually in use,
    // which is what tells us which provider refused us.
    const onUnhealthy = vi.fn();
    const health = createTileHealth({ onUnhealthy });
    health.recordError("https://tiles.example.com/first.png");
    for (let i = 1; i < TILE_ERROR_THRESHOLD; i += 1) {
      health.recordError("https://tiles.example.com/later.png");
    }
    expect(onUnhealthy.mock.calls[0][0].sample).toBe(
      "https://tiles.example.com/first.png",
    );
  });

  it("survives a tileerror with no URL", () => {
    const onUnhealthy = vi.fn();
    const health = createTileHealth({ onUnhealthy });
    for (let i = 0; i < TILE_ERROR_THRESHOLD; i += 1) health.recordError();
    expect(onUnhealthy).toHaveBeenCalledWith({
      errors: TILE_ERROR_THRESHOLD,
      sample: null,
    });
  });
});

describe("reportTileFailure", () => {
  it("sends one exception naming the count and the first failing tile", () => {
    reportTileFailure({ errors: 7, sample: "https://tiles.example.com/1/2/3.png?key=secret" });

    expect(reportClientError).toHaveBeenCalledTimes(1);
    const [error, properties] = vi.mocked(reportClientError).mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Basemap tiles are not loading");
    // Under a URL key, so the scrubber cuts the query that carries a provider's key.
    expect(scrubUnknown(properties)).toEqual({
      tile_errors: "7",
      tile_url: "https://tiles.example.com/1/2/3.png",
    });
  });
});
