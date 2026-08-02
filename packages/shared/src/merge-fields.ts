/**
 * Merge-field substitution (FEATURE-GAPS Step 0a / D6-adjacent fast-follow #6).
 *
 * A single canonical substitution function shared by:
 *  - the SERVER send path (applied at send time, server-side truth), and
 *  - the WEB composer/template preview (so what the owner sees is exactly what
 *    ships).
 *
 * Supported tokens (curly-brace delimited, matched case-insensitively):
 *   {first_name}     — the first whitespace-delimited token of the contact name.
 *   {business_name}  — the company name.
 *   {address}        — the contact's service address (#274).
 *   {my_name}        — the crew member sending it (#274).
 *   {our_number}     — the workspace number to reply to, formatted (#274).
 *   {job_day}        — the day of the next scheduled visit, e.g. "Tuesday".
 *   {job_time}       — the time of it, e.g. "2:00 PM".
 *
 * #274 added the last five. The two originals covered the greeting and nothing
 * else, so a crew's most-repeated messages — "on my way to {address}",
 * "confirming {job_day} at {job_time}" — were still typed by hand every time.
 *
 * WHY THESE FIVE AND NOT MORE. Every one resolves from something the product
 * already holds. A token whose value does not exist yet would render as nothing
 * forever, which is worse than its absence: the picker would promise a
 * substitution that never happens, and the graceful-degradation contract would
 * hide the fact that it never happens.
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
  /** #274: the contact's service address → {address}. */
  contactAddress?: string | null;
  /** #274: the sending crew member's display name → {my_name}. */
  senderName?: string | null;
  /**
   * #274: the workspace number to reply to → {our_number}.
   *
   * Pre-formatted by the caller, through `formatNanpNumber` in this same
   * package. It is pre-formatted rather than formatted here so this module
   * stays a pure substituter — but it goes through ONE shared function,
   * because the number lands inside a customer's message and a preview
   * formatted differently from the wire defeats the point of previewing.
   */
  ourNumber?: string | null;
  /** #274: the day of the next scheduled visit → {job_day}, e.g. "Tuesday". */
  jobDay?: string | null;
  /** #274: the time of it → {job_time}, e.g. "2:00 PM". */
  jobTime?: string | null;
}

/** The literal tokens this substituter understands. */
export const MERGE_FIELD_TOKENS = [
  "first_name",
  "business_name",
  "address",
  "my_name",
  "our_number",
  "job_day",
  "job_time",
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
    case "address":
      // #274: one line, whatever the contact stored. Newlines are collapsed
      // because this lands mid-sentence ("on my way to {address}") and a
      // multi-line address there would break the message in two.
      return (values.contactAddress ?? "").replace(/\s*\n+\s*/g, ", ").trim();
    case "my_name":
      return firstName(values.senderName);
    case "our_number":
      return (values.ourNumber ?? "").trim();
    case "job_day":
      return (values.jobDay ?? "").trim();
    case "job_time":
      return (values.jobTime ?? "").trim();
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

/**
 * #274 — which supported tokens `text` actually uses.
 *
 * Exists so a caller can resolve ONLY what a message asks for. Three of the new
 * tokens cost a read to resolve ({my_name} needs the member, {job_day} and
 * {job_time} need the conversation's next visit), and paying for those on every
 * send — the overwhelming majority of which carry no tokens at all — would be a
 * tax on the common path for a feature used by a minority of messages.
 *
 * Returns supported tokens only. An unknown token is dropped by
 * applyMergeFields and needs nothing fetched for it.
 */
export function mergeFieldsNeeded(text: string): Set<MergeFieldToken> {
  const found = new Set<MergeFieldToken>();
  if (!text.includes("{")) return found;
  const supported = new Set<string>(MERGE_FIELD_TOKENS);
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(text);
  while (match !== null) {
    const token = match[1].toLowerCase();
    if (supported.has(token)) found.add(token as MergeFieldToken);
    match = TOKEN_PATTERN.exec(text);
  }
  TOKEN_PATTERN.lastIndex = 0;
  return found;
}

/**
 * #274 — the tokens an editor offers, in the order it offers them.
 *
 * # Why the list lives here and not in each editor
 *
 * It was duplicated in three template editors, and duplicated lists drift. The
 * failure is not cosmetic: a token offered on one client and not another means
 * a crew member writes a template on a phone that the laptop cannot maintain,
 * and a token whose LABEL differs across clients means two people describing
 * the same field to each other do not realise they mean the same thing.
 *
 * Order is deliberate: greeting first, because that is what most templates
 * start with; then the two facts about the job; then the two about us.
 */
export interface MergeFieldVariable {
  token: MergeFieldToken;
  /** What the chip says. Short — it sits on a button. */
  label: string;
  /**
   * What it becomes, for somebody deciding whether they want it. An editor can
   * show this on a long-press or a title; it is not required chrome.
   */
  hint: string;
}

export const MERGE_FIELD_VARIABLES: readonly MergeFieldVariable[] = [
  { token: "first_name", label: "First name", hint: "The customer's first name" },
  { token: "address", label: "Address", hint: "The address on their contact" },
  { token: "job_day", label: "Day", hint: "The day of their next booked visit" },
  { token: "job_time", label: "Time", hint: "The time of it" },
  { token: "my_name", label: "My name", hint: "Your first name" },
  { token: "business_name", label: "Business", hint: "Your business name" },
  { token: "our_number", label: "Our number", hint: "The number they reply to" },
];

/**
 * #274 — stand-in values so a preview SHOWS each token working.
 *
 * A preview is the only place somebody finds out what a token does. Left
 * unresolved, {address} would render as nothing — which is exactly what a
 * broken token looks like, and the graceful-degradation contract means it
 * would look broken in precisely the same way as a token that genuinely has no
 * value. So the editor's preview supplies samples, and every client uses THESE
 * samples: a preview that differs per client is a preview that is teaching two
 * different things about one message.
 *
 * Obvious placeholders, not plausible data. "18 Rosewood Ave" reads as an
 * example; a real-looking address in a preview gets mistaken for the
 * customer's own and shipped without a second look.
 */
export const MERGE_FIELD_SAMPLES: Readonly<
  Omit<MergeFieldValues, "businessName" | "ourNumber">
> = {
  contactName: "Dana",
  contactAddress: "18 Rosewood Ave",
  senderName: "Sam",
  jobDay: "Tuesday",
  jobTime: "2:00 PM",
};

/**
 * #274 — the tokens a CLIENT cannot resolve honestly, and why.
 *
 * `{job_day}` and `{job_time}` come from the conversation's next open
 * due-dated task. A composer could look that up in its own cache and usually be
 * right — and "usually right" is the worst possible property for a preview,
 * because the whole reason a preview exists is that it is exactly what ships.
 * The moment a teammate completes or reschedules that task on another device,
 * a cached answer here is confidently wrong.
 *
 * Duplicating the server's query on three clients would also make it a
 * hand-ported QUERY rather than a hand-ported pure function, which is a much
 * worse thing to keep in sync.
 *
 * So a composer resolves everything it genuinely knows and SAYS that these two
 * fill in on send. Silently dropping them would show the sender a message
 * different from the one the customer receives, which is the one failure a
 * preview must never have.
 *
 * The editor is a different case: it has no real contact, so it previews with
 * samples and every token is honestly a sample.
 */
export const SERVER_ONLY_TOKENS: readonly MergeFieldToken[] = [
  "job_day",
  "job_time",
];

/** True when `text` uses a token only the send path can resolve. */
export function hasServerOnlyTokens(text: string): boolean {
  const needed = mergeFieldsNeeded(text);
  return SERVER_ONLY_TOKENS.some((token) => needed.has(token));
}

/**
 * The note a composer preview appends when it cannot show the whole truth.
 *
 * One sentence, in the product's voice, from one place — three clients writing
 * their own would each be describing the same mechanism slightly differently.
 */
export const SERVER_ONLY_TOKENS_NOTE =
  "The day and time fill in when you send.";
