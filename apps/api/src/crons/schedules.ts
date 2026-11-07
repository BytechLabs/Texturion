/**
 * Every cron trigger in wrangler.jsonc. `CRON_JOBS` in index.ts is keyed by
 * this list, so a trigger cannot be added without saying which jobs it runs,
 * and mount.test.ts holds the list and wrangler.jsonc together.
 */
export const CRON_SCHEDULES = [
  "* * * * *",
  "*/5 * * * *",
  "*/15 * * * *",
  "0 * * * *",
  "30 * * * *",
  "20 * * * *",
  "40 * * * *",
  "25 * * * *",
  "0 13 * * *",
  "10 13 * * *",
  "0 14 * * *",
  "0 15 * * *",
  "45 15 * * *",
  "30 15 * * *",
  "35 14 1 * *",
] as const;

export type CronSchedule = (typeof CRON_SCHEDULES)[number];

export function isCronSchedule(cron: string): cron is CronSchedule {
  return (CRON_SCHEDULES as readonly string[]).includes(cron);
}
