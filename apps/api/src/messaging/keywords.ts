/**
 * The §5 / D3 standalone opt-out / opt-in / help keyword lists — the single
 * canonical source used by BOTH the inbound opt-out handler (inbound.ts) and the
 * shared auto-send guard (auto-send.ts). Telnyx auto-handles STOP/HELP/START
 * (profile-scoped, D3); no app auto-reply may fire ON one of these keywords
 * (FEATURE-GAPS Step 0b: "never fire on a STOP/HELP message").
 *
 * ONE ENTRY IS NOT CARRIER-HANDLED. `ARRET` is enforced entirely app-side
 * because Telnyx's set is English-only, so the sentence above stopped being
 * true of the whole list on 2026-08-04. The distinction matters when reading
 * this file: for every other keyword the network is a backstop behind us, and
 * for that one there is nothing behind us. See the note beside it.
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
  // #228 - ARRET is the opt-out word a French-speaking customer in Canada will
  // actually send, and it is the ONE entry in this file the carrier does not
  // handle for us.
  //
  // Verified against the live messaging profile on 2026-08-04 rather than
  // assumed: `smart_encoding` is off, there are no autoresp configs, so opt-out
  // is Telnyx's built-in set, and that set is the English list above. An
  // inbound ARRET therefore reaches us as an ordinary message. Before this it
  // wrote no `opt_outs` row, raised no timeline event, and did not suppress the
  // auto-reply - so somebody who asked in French to be left alone could receive
  // an automated text back, and the crew's next send would go out normally.
  //
  // The basis is CASL, not the CWTA short-code rules that make STOP/ARRET/
  // HELP/AIDE/INFO mandatory: those bind short codes and this product sends on
  // long codes and toll-free. What binds us is that a clear withdrawal of
  // consent has to be honoured whatever word carries it, and the safe direction
  // for a standalone "ARRET" is never to keep texting.
  //
  // Both spellings, because a phone keyboard with French autocorrect produces
  // the accent and a keyboard without it does not, and the difference is not
  // the customer's problem.
  "ARRET",
  "ARRÊT",
]);

export const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);

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

/** True when the inbound body is exactly a French request for help. */
export function isFrenchHelpKeyword(body: string): boolean {
  return FRENCH_HELP_KEYWORDS.has(body.trim().toUpperCase());
}

/**
 * #414 — the emergency keywords live in `shared`, not here, because the
 * settings screen needs the SAME list to tell an owner whether their away
 * message still invites the reply. Two lists would drift apart in exactly the
 * way that caused the bug.
 */
import { isEmergencyKeyword } from "@loonext/shared";

export {
  EMERGENCY_KEYWORDS,
  effectiveEmergencyKeywords,
  isEmergencyKeyword,
} from "@loonext/shared";

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
  // #228: AIDE is answered by `help-reply.ts` rather than by the carrier, so it
  // belongs here even though it is not a carrier keyword. Without it a French
  // speaker asking for help would get the help reply AND the away message.
  return isCarrierKeyword(body) || isEmergencyKeyword(body) || isFrenchHelpKeyword(body);
}
