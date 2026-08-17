/**
 * #228 — the scheduled-send disclosure, in the language the reader reads.
 *
 * `disclose()` in `scheduled-send.ts` is the product volunteering bad news: a
 * text somebody wrote is not going out, or not going out yet. It reaches them
 * as a push, on a lock screen, before they have opened anything — which makes
 * it one of the worst sentences in the product to leave in English for a
 * workspace working in French.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FRENCH IS HERE AND THE ENGLISH IS NOT
 *
 * `SCHEDULED_HOLD_REASONS` in `@loonext/shared` is the WIRE value, not a
 * catalogue: `api_hold_scheduled_message` stores the sentence on the row
 * alongside its key, `scheduled-send-parity.test.ts` rosters the same ten
 * sentences across Kotlin and Swift, and the three clients translate them
 * themselves through `domain.scheduledHold*`. Its shape is read by every
 * client, so it does not gain a second language — the shared module's own
 * docblock says why, and #228's expand-and-contract window depends on it.
 *
 * What the clients cannot do is retranslate a push. Web's `sw.js` is served
 * raw from `public/` with no imports and iOS is handed an APNs `notification`
 * block the system draws, so the words on the lock screen are whatever the
 * server put there. That composition is the server's own obligation, which is
 * why this table lives beside the job that sends it rather than in the shared
 * package — the same argument, and the same shape, as `extra-number-copy.ts`
 * and `payment-amount-copy.ts` in `billing/`.
 *
 * ---------------------------------------------------------------------------
 * TWO RULES THIS TABLE KEEPS
 *
 * The English is IMPORTED, never retyped. A second literal would be a second
 * definition of a sentence three clients are rostered against, and the two
 * would drift the first time somebody edited the one they happened to find.
 *
 * The French must stay word for word identical to the `scheduledHold*` entries
 * in `apps/web/src/i18n/sections/domain.ts`. The same person sees both: the
 * push on the lock screen, then the reason under the row when they open the
 * scheduled list. Two renderings of one hold read as two different events, and
 * the one that says less is the one they will believe. A test asserts it.
 */
import {
  SCHEDULED_HOLD_REASONS,
  type Locale,
  type ScheduledHoldReason,
} from "@loonext/shared";

/**
 * One language's half of the disclosure.
 *
 * `Record<ScheduledHoldReason, string>` rather than a partial, deliberately: a
 * reason added to the shared roster without a sentence here fails to compile,
 * which is the only thing that keeps this complete once nobody is looking. The
 * alternative failure is `undefined` reaching a lock screen — a notification
 * that buzzes a phone and says nothing, about a text that did not go.
 */
interface ScheduledDisclosureCopy {
  /**
   * Recoverable: the message is HELD and still goes once the block clears, so
   * this title must not read as a failure.
   */
  waitingTitle: string;
  /** Terminal: it will never go, so nothing here may hint at a retry. */
  notSentTitle: string;
  /** Why, keyed by the shared roster's reasons. */
  reason: Record<ScheduledHoldReason, string>;
}

const EN: ScheduledDisclosureCopy = {
  waitingTitle: "A scheduled text is waiting",
  notSentTitle: "A scheduled text was not sent",
  reason: SCHEDULED_HOLD_REASONS,
};

/**
 * The French half.
 *
 * "texto" and "programmé" are the house words for this feature — they are what
 * `domain.scheduledCancelled` and the hold reasons below already say, and a
 * push that reached for "message planifié" would be a second vocabulary for the
 * one thing the reader is about to open.
 */
const FR_CA: ScheduledDisclosureCopy = {
  waitingTitle: "Un texto programmé est en attente",
  // "n'a pas été envoyé" is the terminal formula every sentence below uses, so
  // the title and the reason under it agree. At 37 characters it still lands
  // inside the ~40 a lock screen shows before it truncates.
  notSentTitle: "Un texto programmé n'a pas été envoyé",
  reason: {
    subscription_inactive:
      "Votre abonnement a expiré, alors ceci n'a pas été envoyé. " +
      "Le message partira une fois la facturation réglée.",
    workspace_paused:
      "Votre forfait est en pause, alors ceci n'a pas été envoyé. " +
      "Le message partira à votre reprise.",
    // "fournisseur" is the house rendering of "carrier", set here and used by
    // the registration copy the reader would go on to read.
    registration_pending:
      "Ceci attend l'approbation des fournisseurs pour les textos américains. " +
      "Le message partira dès que ce sera approuvé.",
    service_unavailable:
      "Les textos sont en pause pendant que nous réglons un problème. " +
      "Ceci est toujours en file et rien n'a été perdu.",
    // The French NAMES the actor where the English says "They". French has no
    // comfortable subject-less equivalent, and "Le client" is who it is — the
    // sentence is asking the crew to decide about a conversation, so being
    // vague about whose reply arrived would cost them the decision.
    customer_replied:
      "Le client a répondu après votre programmation, alors nous avons retenu " +
      "le message plutôt que de lui couper la parole. Envoyez-le quand même, " +
      "ou annulez-le.",
    // STOP stays English: it is the keyword the carrier network matches, and a
    // customer told to send a word Telnyx does not listen for would be worse
    // off. Same rule as the SMS copy in `locale.ts`.
    recipient_opted_out:
      "Le client a répondu STOP après votre programmation, alors le message " +
      "n'a pas été envoyé. Lui seul peut annuler cela.",
    invalid_destination:
      "Nous ne pouvons plus texter ce numéro, alors ceci n'a pas été envoyé.",
    expired:
      "La fenêtre d'envoi est passée avant que ceci ne parte, alors le message " +
      "n'a pas été envoyé. Un message en retard vaut habituellement moins que " +
      "pas de message du tout.",
    workspace_closed:
      "L'espace de travail a été fermé avant l'heure d'envoi prévue.",
    job_no_longer_scheduled:
      "Cette tâche n'est plus prévue, alors ce rappel n'a pas été envoyé.",
  },
};

export const SCHEDULED_DISCLOSURE_COPY: Record<Locale, ScheduledDisclosureCopy> =
  {
    en: EN,
    "fr-CA": FR_CA,
  };
