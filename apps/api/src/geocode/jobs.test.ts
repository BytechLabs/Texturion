import { afterEach, expect, it, vi } from "vitest";

import { getEnv } from "../env";
import { completeEnv } from "../test/support";
import { geocodeContactsJob, geocodeTasksJob } from "./jobs";

afterEach(() => {
  vi.restoreAllMocks();
});

it.each([
  { job: "geocode-contacts", run: geocodeContactsJob, provider: undefined },
  { job: "geocode-contacts", run: geocodeContactsJob, provider: "none" },
  { job: "geocode-tasks", run: geocodeTasksJob, provider: undefined },
  { job: "geocode-tasks", run: geocodeTasksJob, provider: "none" },
] as const)("skips $job with provider $provider without reading addresses", async ({
  job, run, provider,
}) => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected fetch"));
  const log = vi.spyOn(console, "info").mockImplementation(() => {});

  await run(getEnv({ ...completeEnv(), GEOCODER_PROVIDER: provider }));

  expect(fetch).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledExactlyOnceWith({
    job,
    geocode_provider: "none",
    geocode_status: "not_geocoded",
  });
});

it("rejects an unconfigured provider", () => {
  expect(() => getEnv({ ...completeEnv(), GEOCODER_PROVIDER: "nominatim" }))
    .toThrow("GEOCODER_PROVIDER");
});
