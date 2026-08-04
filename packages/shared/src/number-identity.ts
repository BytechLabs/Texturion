/**
 * #307 — which identity a caller actually meets.
 *
 * Greeting, hours, timezone, away reply and the line's name are company-scoped
 * today, so a workspace running a service line and a sales line gets one
 * identity across both. Somebody who bought a second number BECAUSE it is a
 * different business finds the product quietly making it the same one.
 *
 * ── ONE RULE, ONE IMPLEMENTATION ──────────────────────────────────────────
 *
 * The precedence is trivial — the number's value if it has one, else the
 * workspace's — which is exactly why it must not be written five times. The
 * live call runtime, the away-reply path, the API and three clients all need
 * the same answer, and a rule this small is the kind that gets re-derived
 * slightly differently in each place until a caller hears one name in the
 * greeting and a different one in the text that follows.
 *
 * ── NULL IS "INHERIT", NEVER "EMPTY" ──────────────────────────────────────
 *
 * The migration's whole shape. A cleared override restores the workspace
 * value rather than silencing the line — an owner who empties a greeting box
 * must not get silence on a live call. `awayEnabled` is therefore tri-state:
 * `null` follows the workspace, and `false` is a real "not on this line".
 *
 * ── WHY IT REPORTS `inherited` ────────────────────────────────────────────
 *
 * The acceptance asks that an unset value "display as inherited". A UI that
 * shows the resolved text in a box cannot tell an owner whether editing it
 * changes one line or all of them — and that is the difference between fixing
 * a sales greeting and rewriting the one their customers already know.
 */

/** The workspace-level identity every number falls back to. */
export interface CompanyIdentity {
  name: string;
  timezone: string;
  voicemailGreeting: string | null;
  awayMessage: string | null;
  awayEnabled: boolean;
  businessHours: unknown;
  businessHoursExceptions: unknown;
  mctbEnabled: boolean;
  mctbMessage: string | null;
  /** #309: the RECORDED greeting selected, or null for the written words. */
  voicemailGreetingId: string | null;
  /** #278: what an inbound call does outside business hours. */
  afterHoursCalls: AfterHoursCalls;
  /** #278: the recording played after hours, or null for the ordinary one. */
  afterHoursGreetingId: string | null;
}

/**
 * #278 — the three shapes an inbound call can take outside business hours.
 *
 * There are exactly three because the emergency path belongs INSIDE the two
 * non-default options rather than beside them: "route by hours" and "but the
 * person on call still gets the 3am pipe burst" are not two decisions an owner
 * makes separately, and offering them as two is how somebody ends up with
 * hours routing and no hole in it.
 */
export type AfterHoursCalls = "ring_everyone" | "on_call_only" | "voicemail";

/** The three, as a value — for validation and for a picker. */
export const AFTER_HOURS_CALLS: readonly AfterHoursCalls[] = [
  "ring_everyone",
  "on_call_only",
  "voicemail",
] as const;

/** True when `value` is one of the three. Anything else must never reach the
 *  runtime, where an unrecognised value would fall through to whichever branch
 *  the `if` chain happens to end on — a routing decision made by a typo. */
export function isAfterHoursCalls(value: unknown): value is AfterHoursCalls {
  return (
    typeof value === "string" &&
    (AFTER_HOURS_CALLS as readonly string[]).includes(value)
  );
}

/** A number's overrides. Every field null means "follow the workspace". */
export interface NumberOverrides {
  label?: string | null;
  timezone?: string | null;
  voicemailGreeting?: string | null;
  awayMessage?: string | null;
  awayEnabled?: boolean | null;
  businessHours?: unknown;
  businessHoursExceptions?: unknown;
  mctbEnabled?: boolean | null;
  mctbMessage?: string | null;
  voicemailGreetingId?: string | null;
  afterHoursCalls?: AfterHoursCalls | null;
  afterHoursGreetingId?: string | null;
}

/** A resolved value, and whether it came from the workspace. */
export interface Resolved<T> {
  value: T;
  /** True when the number set nothing and the workspace's value is in use. */
  inherited: boolean;
}

export interface NumberIdentity {
  /** The name this line answers as. Inherits the workspace name. */
  label: Resolved<string>;
  timezone: Resolved<string>;
  voicemailGreeting: Resolved<string | null>;
  awayMessage: Resolved<string | null>;
  awayEnabled: Resolved<boolean>;
  businessHours: Resolved<unknown>;
  businessHoursExceptions: Resolved<unknown>;
  /**
   * Whether a missed call on THIS line texts back, and what it says.
   *
   * The reason this is per number and not just per workspace: a tracked number
   * on a yard sign and the office line are missed for different reasons, and
   * the text that should follow is different too — or should not be sent at
   * all, which no company-wide toggle can express.
   */
  mctbEnabled: Resolved<boolean>;
  mctbMessage: Resolved<string | null>;
  /**
   * #309 — which RECORDING plays, if any.
   *
   * Null is not "no greeting": it means the written words, spoken by TTS,
   * which is what every line does until somebody records something. The
   * runtime falls back to those words anyway when a recording cannot be
   * played, so this is a preference rather than a switch.
   */
  voicemailGreetingId: Resolved<string | null>;
  /**
   * #278 — what happens to a call that arrives outside this line's hours.
   *
   * Per number for the same reason the greeting is: a service line and a sales
   * line are two businesses, and the one that must reach somebody at 3am is
   * rarely the one taking invoice questions.
   */
  afterHoursCalls: Resolved<AfterHoursCalls>;
  /**
   * #278 — which recording plays after hours.
   *
   * Null is not "no greeting after hours": it falls back to the ordinary one,
   * which is what every line does today. There is no configuration here that
   * can produce silence.
   */
  afterHoursGreetingId: Resolved<string | null>;
}

/**
 * A single field's resolution.
 *
 * `undefined` is treated exactly as `null`: a row read with a narrower select
 * has an absent key, and "the column was not fetched" must mean inherit for
 * the same reason "the owner set nothing" does. The alternative is a partial
 * read silently becoming an override.
 */
function pick<T>(override: T | null | undefined, fallback: T): Resolved<T> {
  return override === null || override === undefined
    ? { value: fallback, inherited: true }
    : { value: override, inherited: false };
}

export function resolveNumberIdentity(
  company: CompanyIdentity,
  number: NumberOverrides | null | undefined,
): NumberIdentity {
  const overrides = number ?? {};
  return {
    label: pick(blankToNull(overrides.label), company.name),
    timezone: pick(blankToNull(overrides.timezone), company.timezone),
    voicemailGreeting: pick(
      blankToNull(overrides.voicemailGreeting),
      company.voicemailGreeting,
    ),
    awayMessage: pick(blankToNull(overrides.awayMessage), company.awayMessage),
    awayEnabled: pick(overrides.awayEnabled, company.awayEnabled),
    businessHours: pick(overrides.businessHours, company.businessHours),
    businessHoursExceptions: pick(
      overrides.businessHoursExceptions,
      company.businessHoursExceptions,
    ),
    mctbEnabled: pick(overrides.mctbEnabled, company.mctbEnabled),
    mctbMessage: pick(blankToNull(overrides.mctbMessage), company.mctbMessage),
    voicemailGreetingId: pick(
      overrides.voicemailGreetingId,
      company.voicemailGreetingId,
    ),
    afterHoursCalls: pick(overrides.afterHoursCalls, company.afterHoursCalls),
    afterHoursGreetingId: pick(
      overrides.afterHoursGreetingId,
      company.afterHoursGreetingId,
    ),
  };
}

/**
 * A whitespace-only override is not an override.
 *
 * A form that posts an empty string when somebody clears a box would
 * otherwise store `""` — which is not null, so it resolves as a real
 * override, and the line goes silent while the database still says the
 * workspace has a greeting. That is the exact failure the nullable column was
 * chosen to prevent, arriving through the UI instead of the schema.
 */
function blankToNull(value: string | null | undefined): string | null | undefined {
  if (typeof value !== "string") return value;
  return value.trim() === "" ? null : value;
}

/**
 * Every field an owner is looking at, and whether it is this line's or the
 * workspace's — for the settings screen, which has to say which.
 */
export function inheritedFields(identity: NumberIdentity): string[] {
  return Object.entries(identity)
    .filter(([, resolved]) => (resolved as Resolved<unknown>).inherited)
    .map(([field]) => field);
}
