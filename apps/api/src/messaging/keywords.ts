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
 * Adding it here would look like the matching fix and would make things worse.
 * Membership of this set means "the carrier is answering, so we must not", and
 * Telnyx does not answer AIDE any more than it answers ARRET. Adding it would
 * suppress our reply to a message the carrier also ignores, and a French
 * speaker asking for help would get silence instead of the away message they
 * get today.
 *
 * The real fix is a French help response, which belongs with the rest of #228's
 * fr-CA copy rather than as a one-line addition here. Opt-out is separable
 * because suppressing a send is the whole remedy; help is not, because the
 * remedy is a sentence nobody has written yet.
 */
export const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

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
  return isCarrierKeyword(body) || isEmergencyKeyword(body);
}
