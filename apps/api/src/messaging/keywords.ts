import { isEmergencyKeyword } from "@loonext/shared";
import type { Locale } from "@loonext/shared";

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

export const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

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

export function helpKeywordLocale(body: string): Locale | undefined {
  const keyword = normaliseKeyword(body);
  if (HELP_KEYWORDS.has(keyword)) return "en";
  if (FRENCH_HELP_KEYWORDS.has(keyword)) return "fr-CA";
  return undefined;
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
  return isCarrierKeyword(body) || isEmergencyKeyword(body) || isFrenchHelpKeyword(body);
}
