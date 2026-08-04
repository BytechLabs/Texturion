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
