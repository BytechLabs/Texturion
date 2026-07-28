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
 * #414 — the emergency keywords live in `shared`, not here, because the
 * settings screen needs the SAME list to tell an owner whether their away
 * message still invites the reply. Two lists would drift apart in exactly the
 * way that caused the bug.
 */
import { isEmergencyKeyword } from "@loonext/shared";

export { EMERGENCY_KEYWORDS, isEmergencyKeyword } from "@loonext/shared";

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

/**
 * #414: an emergency must never draw the ordinary away reply.
 *
 * Without this, someone who did exactly what we asked gets "we're out of the
 * office right now and will reply first thing. For a no-heat or burst-pipe
 * emergency, reply URGENT and we'll call you" — the same instruction, again,
 * in answer to having followed it. A robot telling a person with a gas smell
 * to wait until morning is worse than saying nothing.
 */
export function suppressesAutoReply(body: string): boolean {
  return isCarrierKeyword(body) || isEmergencyKeyword(body);
}
