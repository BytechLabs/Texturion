/**
 * Every Telnyx REST endpoint the API calls, and the policy class the rig's
 * guard applies to it.
 *
 * The rig reaches Telnyx only through `loonext-telnyx-guard`, whose policy is
 * generated from this list (docs/RIG.md), so a call with no entry is refused on
 * the rig. `scripts/check-telnyx-endpoints.mjs` keeps this list equal to the
 * calls in both directions.
 *
 * Production never reads this. Entries are literal data on purpose: the check
 * reads them from source and refuses anything it would have to evaluate.
 */

export type TelnyxMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type TelnyxPolicyClass =
  /** A GET whose answer the guard filters down to nonprod resources. */
  | "read"
  /** A command on a call leg the guard dialled or the edge registered. */
  | "leg-command"
  /** Places or joins a call: nonprod connection, owned `from` and `to`, a run
   *  lease and room in the call budget. */
  | "dial"
  /** Sends a text: owned `from` and `to` on a nonprod messaging profile. */
  | "message"
  /** Number, credential and profile lifecycle, each under the guard's own
   *  limits and only on nonprod resources. */
  | "provisioning"
  /** Never forwarded from the rig: 10DLC, porting, hosted messaging and its
   *  verification codes all act on the whole account. */
  | "refused";

export interface TelnyxEndpoint {
  readonly method: TelnyxMethod;
  /** Under the API base, with `:id` for each id and no query string. */
  readonly path: string;
  readonly policy: TelnyxPolicyClass;
}

export const TELNYX_ENDPOINTS = [
  { method: "GET", path: "/v2/10dlc/brand", policy: "refused" },
  { method: "POST", path: "/v2/10dlc/brand", policy: "refused" },
  { method: "GET", path: "/v2/10dlc/brand/:id", policy: "refused" },
  { method: "PUT", path: "/v2/10dlc/brand/:id", policy: "refused" },
  { method: "POST", path: "/v2/10dlc/brand/:id/smsOtp", policy: "refused" },
  { method: "PUT", path: "/v2/10dlc/brand/:id/smsOtp", policy: "refused" },
  { method: "GET", path: "/v2/10dlc/campaign/:id", policy: "refused" },
  { method: "PUT", path: "/v2/10dlc/campaign/:id", policy: "refused" },
  { method: "DELETE", path: "/v2/10dlc/campaign/:id", policy: "refused" },
  { method: "POST", path: "/v2/10dlc/campaignBuilder", policy: "refused" },
  { method: "POST", path: "/v2/10dlc/phoneNumberCampaign", policy: "refused" },

  // A search, but rate-limited and leased like an order, so not a plain read.
  { method: "GET", path: "/v2/available_phone_numbers", policy: "provisioning" },

  { method: "POST", path: "/v2/calls", policy: "dial" },
  { method: "GET", path: "/v2/calls/:id", policy: "read" },
  { method: "POST", path: "/v2/calls/:id/actions/answer", policy: "leg-command" },
  // Bridge and transfer connect a leg to somebody new, so they are checked
  // like a dial rather than trusted like a command on a known leg.
  { method: "POST", path: "/v2/calls/:id/actions/bridge", policy: "dial" },
  { method: "POST", path: "/v2/calls/:id/actions/hangup", policy: "leg-command" },
  { method: "POST", path: "/v2/calls/:id/actions/playback_start", policy: "leg-command" },
  { method: "POST", path: "/v2/calls/:id/actions/record_start", policy: "leg-command" },
  { method: "POST", path: "/v2/calls/:id/actions/reject", policy: "leg-command" },
  { method: "POST", path: "/v2/calls/:id/actions/speak", policy: "leg-command" },
  { method: "POST", path: "/v2/calls/:id/actions/transfer", policy: "dial" },

  // Porting and hosted-messaging paperwork.
  { method: "POST", path: "/v2/documents", policy: "refused" },
  { method: "GET", path: "/v2/documents/:id/download", policy: "refused" },

  { method: "POST", path: "/v2/messages", policy: "message" },

  { method: "POST", path: "/v2/messaging_hosted_number_orders", policy: "refused" },
  { method: "GET", path: "/v2/messaging_hosted_number_orders/:id", policy: "refused" },
  { method: "DELETE", path: "/v2/messaging_hosted_number_orders/:id", policy: "refused" },
  {
    method: "POST",
    path: "/v2/messaging_hosted_number_orders/:id/actions/file_upload",
    policy: "refused",
  },
  {
    method: "POST",
    path: "/v2/messaging_hosted_number_orders/:id/validation_codes",
    policy: "refused",
  },
  {
    method: "POST",
    path: "/v2/messaging_hosted_number_orders/:id/verification_codes",
    policy: "refused",
  },
  { method: "DELETE", path: "/v2/messaging_hosted_numbers/:id", policy: "refused" },

  // Always sent with a messaging-profile filter; the guard refuses it without one.
  { method: "GET", path: "/v2/messaging_optouts", policy: "read" },
  { method: "POST", path: "/v2/messaging_profiles", policy: "provisioning" },

  { method: "POST", path: "/v2/number_orders", policy: "provisioning" },
  { method: "GET", path: "/v2/number_orders/:id", policy: "read" },
  { method: "GET", path: "/v2/phone_numbers", policy: "read" },
  { method: "GET", path: "/v2/phone_numbers/:id", policy: "read" },
  { method: "PATCH", path: "/v2/phone_numbers/:id", policy: "provisioning" },
  { method: "DELETE", path: "/v2/phone_numbers/:id", policy: "provisioning" },
  { method: "GET", path: "/v2/phone_numbers/:id/voice", policy: "read" },
  { method: "PATCH", path: "/v2/phone_numbers/:id/voice", policy: "provisioning" },

  { method: "POST", path: "/v2/portability_checks", policy: "refused" },
  { method: "POST", path: "/v2/porting_orders", policy: "refused" },
  { method: "GET", path: "/v2/porting_orders/:id", policy: "refused" },
  { method: "PATCH", path: "/v2/porting_orders/:id", policy: "refused" },
  { method: "POST", path: "/v2/porting_orders/:id/actions/cancel", policy: "refused" },
  { method: "POST", path: "/v2/porting_orders/:id/actions/confirm", policy: "refused" },

  { method: "GET", path: "/v2/recordings", policy: "read" },
  // Addressed by recording id, not call id: the guard reads the recording's
  // leg and allows the delete only when that leg is one it registered.
  { method: "DELETE", path: "/v2/recordings/:id", policy: "leg-command" },

  { method: "POST", path: "/v2/telephony_credentials", policy: "provisioning" },
  { method: "DELETE", path: "/v2/telephony_credentials/:id", policy: "provisioning" },
  { method: "POST", path: "/v2/telephony_credentials/:id/token", policy: "provisioning" },
] as const satisfies readonly TelnyxEndpoint[];
