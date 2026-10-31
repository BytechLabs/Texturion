/**
 * The diag class's redaction (docs/RIG.md): production reads for
 * workstation agents, with phone numbers cut to their last four digits and
 * message bodies and recording URLs removed. Credentials that come back in
 * resource settings (a connection's SIP password, a profile's v1 secret) are
 * removed too: a read tier that returns passwords is not a read tier.
 */
const SECRET_KEY = /secret|password|passwd|token|api_key|private_key/i;
const BODY_KEY = /^(?:text|body|subject|media|media_urls|parts|transcription_text|transcript)$/i;
const RECORDING_KEY = /recording_url|download_url|public_recording|recording_urls|^mp3$|^wav$/i;
/** Fields that hold a number even without a `+`. */
const NUMBER_KEY =
  /^(?:from|to|cc|phone_number|phone_numbers|cld|cli|ani|dnis|caller_id_number|translated_number|forwards_to|alternate_resource_id|number|e164|caller_number|called_number|calling_number|destination|source|sip_from|sip_to)$/i;

const E164_ANYWHERE = /\+[1-9]\d{6,14}/g;
const DIGIT_RUN = /\d{7,15}/g;

/**
 * A Telnyx answer with every credential-named field removed, at any depth:
 * a messaging profile's `v1_secret`, a credential's `sip_password`. The rig's
 * callers get resources, never a way to authenticate as the account.
 */
export function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(value as Record<string, unknown>)) {
    if (!SECRET_KEY.test(field)) out[field] = withoutSecrets(item);
  }
  return out;
}

export function cutNumber(digits: string): string {
  return `***${digits.slice(-4)}`;
}

export function redactString(value: string, numberField: boolean): string {
  const cut = value.replace(E164_ANYWHERE, (match) => cutNumber(match));
  return numberField ? cut.replace(DIGIT_RUN, (match) => cutNumber(match)) : cut;
}

export function redact(value: unknown, key = ""): unknown {
  if (typeof value === "string") return redactString(value, NUMBER_KEY.test(key));
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(field) || RECORDING_KEY.test(field)) continue;
    if (BODY_KEY.test(field)) continue;
    // A speak command's text travels as a string `payload`; a webhook's
    // `payload` is an object whose own fields are redacted one by one.
    if (field === "payload" && typeof item === "string") continue;
    out[field] = redact(item, field);
  }
  return out;
}
