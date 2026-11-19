import { isEmergencyKeyword } from "@loonext/shared";

/** The app records STOP-family requests even when Telnyx leaves them to us. */
export const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "ARRET",
  "ARRÊT",
]);

export const START_KEYWORDS = new Set(["START", "UNSTOP", "YES", "OUI"]);

/**
 * AIDE IS DELIBERATELY ABSENT, and that is the interesting half.
 *
 * Membership of this set means "the carrier is answering, so we must not".
 * Telnyx does not answer AIDE any more than it answers ARRET, so adding it here
 * would suppress our reply to a message the carrier also ignores, and a French
 * speaker asking for help would get silence.
 *
 * It lives in {@link FRENCH_HELP_KEYWORDS} instead, which carries the opposite
 * instruction: nobody else is answering, so we do.
 */
export const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

/**
 * #228 - the French request for help, which WE answer because nobody else does.
 *
 * Kept out of {@link HELP_KEYWORDS} deliberately, and the distinction is the
 * whole reason this set exists. Membership of that one means "the carrier is
 * answering, so we must not"; Telnyx answers AIDE no more than it answers
 * ARRET, so putting it there would suppress our reply to a message nothing else
 * replies to and leave a French speaker asking for help in silence.
 *
 * It DOES suppress the ordinary auto-replies (see {@link suppressesAutoReply}),
 * because somebody asking how this works should not receive the after-hours
 * message instead, and should certainly not receive both.
 */
export const FRENCH_HELP_KEYWORDS = new Set(["AIDE"]);

/**
 * The body in the form the keyword sets are written in: "Stop.", "STOP!!!" and
 * "stop 🙏" all become "STOP", while "Stop. Never mind" keeps its inner text.
 */
export function normaliseKeyword(body: string): string {
  return body
    .normalize("NFKC")
    .toUpperCase()
    .replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replaceAll(/\s+/g, " ");
}

export function isFrenchStopRequest(body: string): boolean {
  const keyword = normaliseKeyword(body)
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll(/[’‘]/g, "'");
  return keyword === "ARRET" || keyword === "ARRETEZ DE M'ECRIRE";
}

/** True when the inbound body is exactly a French request for help. */
export function isFrenchHelpKeyword(body: string): boolean {
  return FRENCH_HELP_KEYWORDS.has(normaliseKeyword(body));
}

/**
 * #414 — the emergency keywords live in `shared`, not here, because the
 * settings screen needs the SAME list to tell an owner whether their away
 * message still invites the reply. Two lists would drift apart in exactly the
 * way that caused the bug.
 */
export {
  EMERGENCY_KEYWORDS,
  effectiveEmergencyKeywords,
  isEmergencyKeyword,
} from "@loonext/shared";

/** These requests take precedence over ordinary automated replies. */
export function isCarrierKeyword(body: string): boolean {
  const keyword = normaliseKeyword(body);
  return (
    STOP_KEYWORDS.has(keyword) ||
    isFrenchStopRequest(keyword) ||
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
  // #228: AIDE is answered by `help-reply.ts` rather than by the carrier, so it
  // belongs here even though it is not a carrier keyword. Without it a French
  // speaker asking for help would get the help reply AND the away message.
  return isCarrierKeyword(body) || isEmergencyKeyword(body) || isFrenchHelpKeyword(body);
}
