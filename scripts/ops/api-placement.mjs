import { setTimeout } from "node:timers/promises";

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 5000;
// In Vancouver, warm reads took 16 to 37 ms when placed and 75 to 80 ms at the edge.
const MAX_DB_ROUND_TRIP_MS = 45;
const TARGET_COLO = "IAD";

async function sample(url, headers) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return { status: response.status, headers: response.headers };
  } catch (error) {
    return { error: String(error?.message ?? error).slice(0, 80) };
  }
}

export async function verifyApiPlacement(api, headers) {
  const healthUrl = `${api}/health`;
  const healthAttempts = [];
  let healthy = false;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await setTimeout(RETRY_DELAY_MS);
    const health = await sample(healthUrl, headers);
    const placement = health.headers?.get("cf-placement");
    if (health.status === 200) {
      healthy = true;
      if (placement === `remote-${TARGET_COLO}`) {
        return { ok: true, message: `API answers with cf-placement ${placement}` };
      }
    }
    healthAttempts.push(health.error ?? `HTTP ${health.status}, cf-placement ${placement ?? "absent"}`);
  }

  if (!healthy) {
    return { ok: false, message: `${healthUrl} did not answer 200 (${healthAttempts.join(" / ")})` };
  }

  const dbUrl = `${healthUrl}/db`;
  const dbAttempts = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await setTimeout(RETRY_DELAY_MS);
    const probe = await sample(dbUrl, headers);
    const timing = probe.headers?.get("server-timing") ?? "";
    const metric = /(?:^|,\s*)db;dur=(\d+(?:\.\d+)?)(?:;desc="([A-Z]{3})")?(?=\s*(?:,|$))/.exec(timing);
    const duration = Number(metric?.[1]);
    const colo = metric?.[2];
    const validTiming = Number.isFinite(duration) && duration > 0;
    if (probe.status === 204 && validTiming && (colo === TARGET_COLO || duration < MAX_DB_ROUND_TRIP_MS)) {
      return { ok: true, message: `API reached Supabase in ${duration} ms${colo ? ` through ${colo}` : ""}` };
    }
    dbAttempts.push(probe.error ?? `HTTP ${probe.status}, ${timing || "no Server-Timing"}`);
  }

  return {
    ok: false,
    message: `${dbUrl} did not show database proximity (need ${TARGET_COLO} or under ${MAX_DB_ROUND_TRIP_MS} ms). Health attempts (${healthAttempts.join(" / ")}). Database attempts (${dbAttempts.join(" / ")}).`,
  };
}
