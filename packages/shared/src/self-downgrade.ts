/**
 * #538 — taking powers away from yourself, said out loud first.
 *
 * ## The trap
 *
 * An admin who sets their own role to member loses `team.manage` in the same
 * stroke — which is the capability that would let them change it back. Nothing
 * asked, nothing warned, and the way out is to go and find the owner. In a
 * workspace whose owner is on a roof with no signal, that is a real afternoon
 * lost to a control that looked like a dropdown.
 *
 * The issue asks for an explicit confirmation with the consequences named. This
 * module is the consequences: what a role change actually costs, in the words a
 * person would use, so all three clients warn with the same sentence and the
 * server can refuse a change that never showed it.
 *
 * ## Why an acknowledgement rather than a fresh two-factor prompt
 *
 * The issue suggests "2fa/email etc", and two things are worth separating.
 *
 * Session-level two-factor is ALREADY enforced here: the company context demands
 * `aal2` from anybody holding a factor, so every role change already comes from a
 * session that proved a second factor. What was missing was never the proof of
 * identity — it was that nobody was told what the button does.
 *
 * And a role change is REVERSIBLE. Nothing is destroyed; an owner restores it in
 * a tap. Reaching for an authenticator app over something reversible teaches
 * people to treat the prompt as a formality, which is exactly how it stops
 * working on `DELETE /v1/account`, where it is the last line. Friction belongs on
 * the irreversible; a clear sentence and a deliberate confirm belong here.
 */
import { capabilitiesOf, type Capability, type MemberRole } from "./capabilities";

/**
 * What a member would lose by moving from one role to another.
 *
 * Empty for a promotion or a sideways move, which is what makes this safe to call
 * on every role change rather than only the ones a caller already guessed were
 * downgrades.
 */
export function capabilitiesLost(
  from: MemberRole,
  to: MemberRole,
): Capability[] {
  const after = new Set(capabilitiesOf(to));
  return capabilitiesOf(from).filter((cap) => !after.has(cap));
}

/** Does this change take anything away? */
export function isDowngrade(from: MemberRole, to: MemberRole): boolean {
  return capabilitiesLost(from, to).length > 0;
}

/**
 * The one that cannot be undone by the person doing it.
 *
 * `team.manage` is the capability that changes roles, so losing it is the moment a
 * member stops being able to reverse their own decision. Singled out because it is
 * the difference between "you will have less access" — which people accept easily
 * and correctly — and "you will not be able to put this back", which is the part
 * they would want to know.
 */
export function losesRoleControl(from: MemberRole, to: MemberRole): boolean {
  return capabilitiesLost(from, to).includes("team.manage");
}

/**
 * What each capability means to somebody deciding whether to give it up.
 *
 * Written as things they DO, not as permission names. "team.manage" tells a
 * developer what is being revoked and tells an owner nothing.
 */
export const CAPABILITY_PLAIN_NAMES: Partial<Record<Capability, SelfDowngradeKey>> = {
  "billing.manage": "domain.capBilling",
  "settings.manage": "domain.capSettings",
  "team.manage": "domain.capTeam",
  "numbers.manage": "domain.capNumbers",
  "history.read": "domain.capHistory",
  "contacts.bulk": "domain.capContactsBulk",
};

/** Every catalogue key this module names. */
export type SelfDowngradeKey =
  | "domain.capBilling"
  | "domain.capSettings"
  | "domain.capTeam"
  | "domain.capNumbers"
  | "domain.capHistory"
  | "domain.capContactsBulk"
  | "domain.selfDowngradeSomeOfWhat"
  | "domain.selfDowngradeListPair"
  | "domain.selfDowngradeMore"
  | "domain.selfDowngradeUndo"
  | "domain.selfDowngradeWarning";

/** The reader's resolver. */
export type SaySelfDowngrade = (key: SelfDowngradeKey) => string;

/**
 * The sentence to show before somebody takes powers off themselves.
 *
 * Null when the change takes nothing away, so a caller can render this
 * unconditionally and get silence on a promotion.
 *
 * Names at most three things and then counts the rest: a list of six revoked
 * capabilities reads as legal boilerplate and gets skipped, which defeats the
 * whole point of asking.
 */
export function selfDowngradeWarning(
  from: MemberRole,
  to: MemberRole,
  say: SaySelfDowngrade,
): string | null {
  const lost = capabilitiesLost(from, to);
  if (lost.length === 0) return null;

  const named = lost
    .map((cap) => CAPABILITY_PLAIN_NAMES[cap])
    .filter((key): key is SelfDowngradeKey => Boolean(key))
    .map((key) => say(key));
  const head = named.slice(0, 3);
  const rest = named.length - head.length;
  /*
   * #228 — the JOINER is a key, and it has to be.
   *
   * "a, b and c" is "a, b et c": the comma-separated part is the same in both
   * and only the last conjunction changes. Interpolating a translated " and "
   * into a hardcoded join would have put the English word between the first
   * two items and the French one between the last two.
   *
   * All three clients build this the same way, and Android has had these keys
   * since #538 — this module is the one that was still writing the sentence
   * in English.
   */
  const list =
    head.length === 0
      ? say("domain.selfDowngradeSomeOfWhat")
      : head.length === 1
        ? head[0]!
        : say("domain.selfDowngradeListPair")
            .replace("{first}", head.slice(0, -1).join(", "))
            .replace("{last}", head[head.length - 1]!);

  const scope =
    rest > 0
      ? say("domain.selfDowngradeMore")
          .replace("{list}", list)
          .replace("{count}", String(rest))
      : list;
  const undo = losesRoleControl(from, to) ? say("domain.selfDowngradeUndo") : "";
  return say("domain.selfDowngradeWarning")
    .replace("{scope}", scope)
    .replace("{undo}", undo);
}

/**
 * The field a client must send to go through with it.
 *
 * Named for what it means rather than as a generic `confirm`, so a request that
 * carries it cannot have arrived by accident from a client that sets every
 * boolean it can find.
 */
export const SELF_DOWNGRADE_ACK = "confirm_losing_access" as const;

/** Specific catalogue copy paired with the API's legacy English refusal. */
export const SELF_DOWNGRADE_REQUIRED_MESSAGE_KEY =
  "apiErrors.selfDowngradeAcknowledgementRequired" as const;
