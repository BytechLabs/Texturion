import { HEADER, type GuardRefusal } from "@loonext/rig-protocol";

/**
 * Every rule the guard can refuse under. The names are a contract: rig
 * verdicts, G01's negative probes and triage key on them, so a rename is a
 * breaking change, not a tidy-up.
 */
export const RULES = [
  "class.unknown",
  "class.not_allowed",
  "route.unknown",
  "request.malformed_path",
  "request.body_invalid",
  "startup.unsafe",
  "startup.unconfigured",

  "telnyx.key_missing",
  "registry.missing",
  "read.account_wide",
  "read.no_filter_rule",
  "read.filter_required",
  "read.filter_not_nonprod",
  "read.not_in_partition",
  "read.leg_not_registered",

  "refused.10dlc",
  "refused.porting",
  "refused.hosted_messaging",
  "refused.documents",
  "refused.verification",
  "refused.api_keys",
  "refused.managed_accounts",
  "refused.auto_recharge",
  "refused.setup_only",
  "refused.registry",

  "leg.not_registered",
  "leg.field_refused",
  "leg.recording_not_registered",

  "dial.lease_missing",
  "dial.lease_not_live",
  "dial.connection_not_nonprod",
  "dial.from_not_owned",
  "dial.to_not_owned",
  "dial.field_refused",
  "dial.leg_not_registered",

  "message.from_not_owned",
  "message.to_not_owned",
  "message.profile_not_nonprod",
  "message.field_refused",

  "provisioning.search_needs_lease",
  "provisioning.search_rate",
  "provisioning.ordering_off",
  "provisioning.order_needs_lease",
  "provisioning.order_interval",
  "provisioning.order_one_number",
  "provisioning.numbers_held",
  "provisioning.order_group",
  "provisioning.order_profile",
  "provisioning.order_connection",
  "provisioning.number_not_owned",
  "provisioning.number_standing",
  "provisioning.patch_field",
  "provisioning.profile_count",
  "provisioning.profile_spend_limit",
  "provisioning.profile_whitelist",
  "provisioning.profile_webhook",
  "provisioning.credential_connection",
  "provisioning.credential_not_nonprod",
  "provisioning.sentinel_full",

  "admission.limit_unknown",
  "admission.outside_window",
  "admission.ratios_unknown",
  "admission.abandoned_ratio",
  "admission.short_ratio",
  "admission.reserve_unknown",
  "admission.no_room",
  "admission.production_call_live",
  "admission.production_calls_unknown",

  "budget.dials_day",
  "budget.dials_hour",
  "budget.texts_day",
  "budget.texts_month",
  "budget.credentials_day",
  "budget.tier_amber",
  "budget.tier_red",
  "budget.balance_floor",
  "budget.balance_unknown",
  "budget.resend_day",
  "budget.fcm_day",
  "budget.ai_neurons_day",

  "signal.halted",
  "signal.latched",

  "lease.busy",
  "lease.not_found",
  "lease.scenario_invalid",

  "legs.connection_not_nonprod",
  "legs.via_mismatch",

  "resend.key_missing",
  "resend.path_refused",
  "resend.recipient_refused",
  "resend.robot_needs_lease",
  "resend.mail_heartbeat_stale",
  "resend.robot_mail_halted",

  "fcm.key_missing",
  "fcm.path_refused",
  "fcm.target_not_token",

  "ai.binding_missing",
  "ai.model_refused",
  "ai.stream_refused",

  "diag.method",
  "diag.path_refused",
  "diag.filter_required",
] as const;

export type RuleName = (typeof RULES)[number];

/** The status a refusal under `rule` carries: 429 for a spent budget, else 403. */
export function statusFor(rule: RuleName): 403 | 429 {
  return rule.startsWith("budget.") ||
    rule === "provisioning.search_rate" ||
    rule === "provisioning.order_interval"
    ? 429
    : 403;
}

export class Refusal extends Error {
  readonly rule: RuleName;

  constructor(rule: RuleName) {
    super(`guard refused: ${rule}`);
    this.name = "Refusal";
    this.rule = rule;
  }
}

/** The response for a refusal: a {@link GuardRefusal} body and the refused-by header. */
export function refuse(rule: RuleName): Response {
  const body: GuardRefusal = { error: "guard_refused", rule };
  return new Response(JSON.stringify(body), {
    status: statusFor(rule),
    headers: {
      "content-type": "application/json",
      [HEADER.refusedBy]: rule,
    },
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
