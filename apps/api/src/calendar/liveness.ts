/**
 * Provider pulls normally prove calendar truth every five minutes. After three
 * missed rounds, a provider-side move may be newer than our literal reminder:
 * reminders hold and the connection owner is told that verification is stale.
 */
export const CALENDAR_VERIFICATION_MAX_AGE_MS = 15 * 60 * 1000;
