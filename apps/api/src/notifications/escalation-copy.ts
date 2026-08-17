/**
 * #228 — what the second page says, in the language its reader chose.
 *
 * The sentence that gets somebody out of bed at 11:52pm is the last one that
 * should arrive in a language they do not read, and #244's whole argument for
 * narrowing a page to one person rests on this alert landing when they sleep
 * through it. So it is composed per reader, like every other push.
 *
 * Shaped so a MISSING TRANSLATION IS A TYPE ERROR: `Record<Locale, …>` over an
 * interface, so a new language will not compile until every sentence exists in
 * it.
 *
 * THE WHOLE TITLE PER KIND, not a fragment plus a shared tail. English can
 * build `${what} is still waiting` from three nouns because nothing downstream
 * of the noun changes; French cannot be trusted to keep that property — the
 * three subjects differ in gender (un appel manqué / une urgence / une alerte),
 * "attend toujours" happens to be invariable today, and the next sentence
 * anybody writes in this shape will not be. Three whole titles cost two extra
 * lines and cannot break that way.
 */
import type { Locale } from "@loonext/shared";

interface EscalationCopy {
  /** The unanswered alert was a missed call. */
  missedCallTitle: string;
  /** The customer texted an urgent keyword and nobody has claimed it. */
  emergencyTitle: string;
  /**
   * Any other alert kind (poor_rating today, whatever is added next). A kind
   * this build has never heard of still escalates with a sentence rather than
   * a blank.
   */
  genericTitle: string;
  /** Shared by every kind: what actually happened, and whose it is now. */
  body: string;
}

const EN: EscalationCopy = {
  missedCallTitle: "A missed call is still waiting",
  emergencyTitle: "An emergency is still waiting",
  genericTitle: "An alert is still waiting",
  body: "Nobody has picked this up. It is open to the whole crew now.",
};

/**
 * Quebec French.
 *
 * "urgence" is the house noun for an emergency (packages/shared/src/locale.ts
 * `emergencyAck`), and both halves of the body have precedents in domain.ts:
 * `onCallBannerWaiting` says "Personne ne s'en est encore occupé" and
 * `onCallBannerYours` says "toute l'équipe". The "encore" is dropped here on
 * purpose — by escalation time it is no longer a matter of not yet.
 */
const FR_CA: EscalationCopy = {
  missedCallTitle: "Un appel manqué attend toujours",
  emergencyTitle: "Une urgence attend toujours",
  genericTitle: "Une alerte attend toujours",
  body: "Personne ne s'en est occupé. C'est maintenant ouvert à toute l'équipe.",
};

export const ESCALATION_COPY: Record<Locale, EscalationCopy> = {
  en: EN,
  "fr-CA": FR_CA,
};
