/**
 * #244 — the words and the windows for "who is holding the phone tonight".
 *
 * PRESETS, NOT A DATETIME BUILDER. The decision a contractor is actually making
 * is "Dana has tonight" or "I have the weekend" — not a pair of ISO instants.
 * Asking for start and end datetimes turns a five-second choice into a form,
 * and a form in a van does not get filled in. The same argument #237 made about
 * reminder offsets, for the same reason.
 *
 * Every window is computed in the WORKSPACE's timezone, server-side arithmetic
 * notwithstanding: "tonight" is 6pm where the crew is, not where the phone
 * happens to be roaming.
 */

export type OnCallPreset = "tonight" | "weekend" | "week";

export interface OnCallWindow {
  starts_at: string;
  ends_at: string;
}

/** The choices, in the order a crew thinks of them. */
import type { SayKey } from "./support";

export const ON_CALL_PRESETS: {
  key: OnCallPreset;
  label: string;
  /** What it means, said out loud — the hours are the whole content. */
  detail: string;
}[] = [
  { key: "tonight", label: "domain.onCallPresetTonight", detail: "domain.onCallPresetTonightDetail" },
  { key: "weekend", label: "domain.onCallPresetWeekend", detail: "domain.onCallPresetWeekendDetail" },
  { key: "week", label: "domain.onCallPresetWeek", detail: "domain.onCallPresetWeekDetail" },
];

/** When the evening shift starts and ends, in workspace-local hours. */
export const ON_CALL_EVENING_START_HOUR = 18;
export const ON_CALL_MORNING_END_HOUR = 8;

/**
 * Turn a preset into an actual window.
 *
 * `now` and the returned instants are UTC; `offsetMinutes` is the workspace's
 * offset from UTC at that moment, which the caller resolves. Passing the offset
 * rather than a timezone name keeps this pure and testable in three languages —
 * the hand-ports on Android and iOS do not have to agree about a tz database,
 * only about arithmetic.
 */
export function onCallWindow(
  preset: OnCallPreset,
  now: Date,
  offsetMinutes: number,
): OnCallWindow {
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const startOfLocalDay = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const toUtc = (localMs: number) =>
    new Date(localMs - offsetMinutes * 60_000).toISOString();

  if (preset === "week") {
    return {
      starts_at: now.toISOString(),
      ends_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    };
  }

  if (preset === "weekend") {
    // From the coming Friday evening. If it is ALREADY the weekend, the answer
    // is this one rather than the next — somebody setting a weekend rota on a
    // Saturday morning means today, and booking it eight days out would leave
    // tonight uncovered by the very action taken to cover it.
    const weekday = new Date(startOfLocalDay).getUTCDay(); // 0 = Sunday
    const daysToFriday = weekday === 6 || weekday === 0 ? -(weekday === 6 ? 1 : 2) : 5 - weekday;
    const friday = startOfLocalDay + daysToFriday * 86_400_000;
    return {
      starts_at: toUtc(friday + ON_CALL_EVENING_START_HOUR * 3_600_000),
      ends_at: toUtc(friday + 3 * 86_400_000 + ON_CALL_MORNING_END_HOUR * 3_600_000),
    };
  }

  // Tonight. Past 6pm already, it starts NOW rather than retroactively — a
  // shift that began three hours ago would claim responsibility for a call
  // nobody was holding, and the honest start is the moment somebody accepted
  // it.
  const eveningStart = startOfLocalDay + ON_CALL_EVENING_START_HOUR * 3_600_000;
  const localNow = local.getTime();
  const start = localNow > eveningStart ? localNow : eveningStart;
  return {
    starts_at: toUtc(start),
    ends_at: toUtc(startOfLocalDay + 86_400_000 + ON_CALL_MORNING_END_HOUR * 3_600_000),
  };
}

/**
 * What the card says, in one place.
 *
 * The empty state is the important one. A workspace with no rota is not
 * misconfigured — it is the default, and every existing workspace is in it —
 * so the sentence has to say what that MEANS rather than look like a gap
 * somebody forgot to fill.
 */
export const ON_CALL_COPY = {
  heading: "settingsMore.onCallTitle",
  /** Nobody holding it. States the consequence, because that is the decision. */
  nobody: "domain.onCallNobody",
  /** Somebody is, and this is only ever shown with their name in front. */
  until: "domain.onCallUntil",
  /** The escalation promise, so an owner knows the risk they are taking. */
  escalation: "domain.onCallEscalation",
  /** A member looking at a card they cannot change. */
  read_only: "domain.onCallReadOnly",
} as const;

/** "Dana is on call until 8:00 AM" — assembled in one place, not three. */
export function onCallLine(name: string, until: string, say: SayKey): string {
  return say("domain.onCallLine").replace("{name}", name).replace("{until}", until);
}

/**
 * #244 — the strip on a thread nobody has claimed yet.
 *
 * THE POINT IS THE NAME. "When everyone is notified, no one is accountable" —
 * so the banner exists to turn "somebody should call these people" into
 * "I have this", visible to everybody else who opens the thread.
 *
 * It shows on ANY route into the thread, not just the notification's deep
 * link, because the person best placed to claim it is often not the one who
 * was paged.
 */
export const ALERT_BANNER_COPY = {
  /** Unclaimed. Says what is owed, not what happened. */
  waiting: "domain.onCallBannerWaiting",
  /** The action. First person, because that is what tapping it means. */
  claim: "domain.onCallBannerClaim",
  /** Claimed by somebody else — the sentence that stops a second callback. */
  taken: "domain.onCallBannerTaken",
  /** Claimed by you. Confirms it stuck, and that the others were told. */
  yours: "domain.onCallBannerYours",
} as const;

/** "Sam has this" — one place, so three clients cannot word it differently. */
export function alertTakenLine(name: string, say: SayKey): string {
  return say("domain.onCallTakenLine").replace("{name}", name);
}
