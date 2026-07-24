/**
 * Merge-field substitution (FEATURE-GAPS Step 0a / D6-adjacent fast-follow #6).
 *
 * A single canonical substitution function shared by:
 *  - the SERVER send path (applied at send time, server-side truth), and
 *  - the WEB composer/template preview (so what the owner sees is exactly what
 *    ships).
 *
 * Supported tokens (case-sensitive, curly-brace delimited):
 *   {first_name}     — the first whitespace-delimited token of the contact name.
 *   {business_name}  — the company name.
 *
 * DEGRADE GRACEFULLY (Step 0a): an unknown token, or a supported token whose
 * value is null/empty, is dropped CLEANLY — the literal `{first_name}` never
 * reaches the wire, and no stray double-spaces or dangling punctuation are left
 * behind. The values come from the contact + company already loaded on the send
 * path; this function performs NO I/O.
 */

/** The values a caller supplies for substitution. All optional/nullable. */
export interface MergeFieldValues {
  /** Full contact name; the first token becomes {first_name}. */
  contactName?: string | null;
  /** Company name → {business_name}. */
  businessName?: string | null;
}

/** The literal tokens this substituter understands. */
export const MERGE_FIELD_TOKENS = [
  "first_name",
  "business_name",
] as const;

export type MergeFieldToken = (typeof MERGE_FIELD_TOKENS)[number];

/** {token} where token is one of the supported names OR any [a-z_] word. */
const TOKEN_PATTERN = /\{([a-z_][a-z0-9_]*)\}/gi;

/** First whitespace-delimited token of a name, or "" when there is none. */
function firstName(contactName: string | null | undefined): string {
  if (!contactName) return "";
  const trimmed = contactName.trim();
  if (trimmed.length === 0) return "";
  const [first] = trimmed.split(/\s+/);
  return first ?? "";
}

/**
 * Resolve one token to its replacement string. A supported token with a
 * present, non-empty value returns that value; a supported token with an
 * empty/absent value, and every UNKNOWN token, resolves to "" (dropped).
 */
function resolveToken(token: string, values: MergeFieldValues): string {
  switch (token) {
    case "first_name":
      return firstName(values.contactName);
    case "business_name":
      return (values.businessName ?? "").trim();
    default:
      // Unknown token: drop it (never render the literal braces).
      return "";
  }
}

/**
 * Collapse the whitespace/punctuation artifacts left when a token resolves to
 * "" — so "Hi {first_name}, thanks" with no name becomes "Hi, thanks", not
 * "Hi , thanks", and "Call {business_name}" becomes "Call" not "Call ".
 *
 * Only runs when at least one token was dropped, so text with no empty tokens
 * is returned byte-for-byte unchanged.
 */
function tidyDroppedTokens(text: string): string {
  return (
    text
      // " ," / " ." / " !" etc. left by a dropped token before punctuation.
      .replace(/[ \t]+([,.;:!?])/g, "$1")
      // Collapse runs of intra-line spaces/tabs to a single space.
      .replace(/[ \t]{2,}/g, " ")
      // Trim trailing spaces/tabs at end of each line.
      .replace(/[ \t]+$/gm, "")
      // Trim leading spaces/tabs at start of each line.
      .replace(/^[ \t]+/gm, "")
  );
}

/**
 * Substitute all {tokens} in `text` from `values`. Pure and side-effect free.
 * Unknown or empty tokens are dropped and the resulting whitespace is tidied.
 */
export function applyMergeFields(
  text: string,
  values: MergeFieldValues,
): string {
  if (!text.includes("{")) return text;

  let anyDropped = false;
  const substituted = text.replace(TOKEN_PATTERN, (_match, rawToken: string) => {
    const token = rawToken.toLowerCase();
    const replacement = resolveToken(token, values);
    if (replacement.length === 0) anyDropped = true;
    return replacement;
  });

  return anyDropped ? tidyDroppedTokens(substituted) : substituted;
}

/**
 * True when `text` contains at least one {token} applyMergeFields would act on.
 * This matches TOKEN_PATTERN (ANY {token}), not just the KNOWN tokens: an
 * unknown token like {foo} is still stripped by applyMergeFields, so gating the
 * preview on known-only tokens hid a preview while the sent text silently
 * changed. Now the preview shows whenever the composed text will differ.
 */
export function hasMergeFields(text: string): boolean {
  if (!text.includes("{")) return false;
  TOKEN_PATTERN.lastIndex = 0;
  const result = TOKEN_PATTERN.test(text);
  TOKEN_PATTERN.lastIndex = 0;
  return result;
}
