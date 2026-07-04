/**
 * The §5 / D3 standalone opt-out / opt-in / help keyword lists — the single
 * canonical source used by BOTH the inbound opt-out handler (inbound.ts) and the
 * shared auto-send guard (auto-send.ts). Telnyx auto-handles STOP/HELP/START
 * (profile-scoped, D3); no app auto-reply may fire ON one of these keywords
 * (FEATURE-GAPS Step 0b: "never fire on a STOP/HELP message").
 *
 * Matching is a case-insensitive exact match of the TRIMMED body — no Telnyx
 * payload flag is relied on.
 */
export const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

export const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);

export const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

/**
 * True when the inbound body is a standalone STOP/START/HELP-family keyword
 * (Telnyx handles these; the guard must not auto-reply on them, and the
 * after-hours branch must not treat one as a normal "first inbound").
 */
export function isCarrierKeyword(body: string): boolean {
  const keyword = body.trim().toUpperCase();
  return (
    STOP_KEYWORDS.has(keyword) ||
    START_KEYWORDS.has(keyword) ||
    HELP_KEYWORDS.has(keyword)
  );
}
