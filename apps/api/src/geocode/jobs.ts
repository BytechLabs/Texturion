import type { Env } from "../env";

type GeocodeJob = "geocode-contacts" | "geocode-tasks";

interface Geocoder {
  run(job: GeocodeJob, env: Env): Promise<void>;
}

const geocoders: Record<NonNullable<Env["GEOCODER_PROVIDER"]>, Geocoder> = {
  none: {
    run(job) {
      console.info({
        job,
        geocode_provider: "none",
        geocode_status: "not_geocoded",
      });
      return Promise.resolve();
    },
  },
};

export function geocodeContactsJob(env: Env): Promise<void> {
  return geocoders[env.GEOCODER_PROVIDER ?? "none"].run("geocode-contacts", env);
}

export function geocodeTasksJob(env: Env): Promise<void> {
  return geocoders[env.GEOCODER_PROVIDER ?? "none"].run("geocode-tasks", env);
}
