/**
 * #283 — the flags, declared in code.
 *
 * Every deploy reached 100% of customers in the same minute, and the only
 * operational switch in the whole env surface was `BILLING_WRITES_DISABLED`.
 * We have already paid for that: the launch-blocking calls outage was our own
 * `Permissions-Policy: microphone=()` header, shipped to everyone, and the fix
 * required another deploy through CI.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DECLARATION IS HERE AND THE VALUE IS IN THE DATABASE.
 *
 * The row can only ever OVERRIDE what this file declares. That split buys four
 * things, and the last one is the reason:
 *
 *   1. A flag key is a type, not a string. A typo does not compile.
 *   2. Hygiene is enforceable: `owner` and `removeBy` are required fields, and
 *      a flag past its removal date fails CI (`registry.test.ts`). Permanent
 *      flags are how a codebase becomes untestable — the issue says so, and it
 *      is right.
 *   3. The default is readable next to the code it governs.
 *   4. THE STORE CAN BE DOWN AND NOTHING BREAKS. If the flag read fails, every
 *      flag falls back to the default declared here. A feature-flag system
 *      that turns a database blip into a product outage has made reliability
 *      worse, not better — it would be one more shared dependency with the
 *      same total blast radius the flags exist to shrink.
 *
 * ---------------------------------------------------------------------------
 * KILL SWITCHES vs ROLLOUTS. Both are flags; they differ in which direction
 * "unknown" points.
 *
 * A KILL SWITCH defaults ON — the subsystem works — and is flipped off in an
 * incident. A ROLLOUT defaults OFF and is turned on for a cohort, then a
 * percentage, then everyone.
 *
 * The kill switches here are exactly the four the issue names: AI, calls,
 * realtime, and outbound send. They are the direct enforcement mechanism for
 * the cost mandate, which until now depended on code paths behaving as
 * designed rather than on an operator being able to intervene at all.
 */

export interface FlagSpec {
  /** One sentence: what turning this OFF does, in the customer's terms. */
  what: string;
  /**
   * The value when nothing has been said — no row, or the store unreachable.
   *
   * For a kill switch this is `true` (the feature works). For a rollout it is
   * `false` (nobody has it yet). Getting this backwards for a kill switch
   * means a database outage disables the product.
   */
  default: boolean;
  /**
   * A kill switch protects a running subsystem; a rollout introduces a new
   * one. Marked because they are operated differently and because
   * `docs/ROLLBACK.md` lists the kill switches specifically.
   */
  kind: "kill-switch" | "rollout";
  /** Who decides this flag's fate. Not a team — a person. */
  owner: string;
  /**
   * When this flag must be gone, `YYYY-MM-DD`.
   *
   * CI fails once the date passes, which is the point: the alternative is a
   * flag nobody removes and a combinatorial explosion of untested paths. A
   * kill switch that is genuinely permanent says so with a far date and a
   * comment explaining why it outlives a rollout.
   */
  removeBy: string;
}

export const FEATURE_FLAGS = {
  // -------------------------------------------------------------------------
  // Kill switches (#283). Default ON, flipped OFF in an incident.
  //
  // These are long-lived by design: the removal date is far out because their
  // job is to exist unused. They are reviewed, not expired.
  // -------------------------------------------------------------------------
  "kill:ai": {
    what:
      "Turns off every AI feature at the single gate (runAiFeature). Threads, " +
      "tasks and voicemail keep working; they simply stop being enriched.",
    default: true,
    kind: "kill-switch",
    owner: "founder",
    removeBy: "2030-01-01",
  },
  "kill:calls": {
    what:
      "Stops new calls being placed or accepted. A call already in progress is " +
      "never dropped — the customer on the other end did nothing wrong.",
    default: true,
    kind: "kill-switch",
    owner: "founder",
    removeBy: "2030-01-01",
  },
  "kill:realtime": {
    what:
      "Stops handing out realtime tokens. Clients fall back to polling, so the " +
      "inbox is slower but never wrong.",
    default: true,
    kind: "kill-switch",
    owner: "founder",
    removeBy: "2030-01-01",
  },
  "kill:outbound-send": {
    what:
      "Stops all outbound SMS at the single dispatch choke point. The most " +
      "serious switch here: it silences the product's core promise, and exists " +
      "for a carrier incident or a runaway loop billing us per message.",
    default: true,
    kind: "kill-switch",
    owner: "founder",
    removeBy: "2030-01-01",
  },
} as const satisfies Record<string, FlagSpec>;

export type FlagKey = keyof typeof FEATURE_FLAGS;

/** Every declared key, for the roster test and the ops script's validation. */
export const FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FlagKey[];

/** The value to use when nothing has been said, or nothing could be read. */
export function flagDefault(key: FlagKey): boolean {
  return FEATURE_FLAGS[key].default;
}

/** The kill switches, which `docs/ROLLBACK.md` and the ops script enumerate. */
export function killSwitchKeys(): FlagKey[] {
  return FLAG_KEYS.filter((key) => FEATURE_FLAGS[key].kind === "kill-switch");
}
