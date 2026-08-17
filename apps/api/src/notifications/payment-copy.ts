/**
 * #228 — what a payment alert says, in the language the reader chose.
 *
 * The three ways money moves after an ask is sent (`payment.ts`). This is the
 * sentence a crew reads standing in a driveway, on a lock screen, before they
 * have opened anything — so of everything #607 shipped it is the half that
 * could least afford to stay English.
 *
 * ONE VOCABULARY WITH THE TIMELINE, IN BOTH LANGUAGES. The English verbs here
 * are the thread's own ("paid", "went back to", "pulled back"), and the French
 * is that same timeline's French: « a payé » (thread.sysPaymentPaid),
 * « remboursé » (sysPaymentRefunded), « repris » (sysPaymentDisputed). A crew
 * reading one word on the lock screen and another in the thread is the #273
 * failure this feature is otherwise careful about, and translating the two
 * halves separately is exactly how it would have come back.
 *
 * A MISSING TRANSLATION IS A TYPE ERROR: `Record<Locale, …>` over an interface,
 * so an outcome cannot gain a sentence that only English answers.
 *
 * WITH AND WITHOUT A FIGURE IS THE LANGUAGE'S BRANCH, not the call site's. Each
 * rendering answers a null `amount` itself, because "The money went back to" and
 * « L'argent a été remboursé à » are whole sentences rather than substitutions —
 * the same reasoning `thread-copy.ts` gives for keeping a plural inside the
 * translation.
 *
 * WHAT IS NOT IN HERE: the contact's name and the formatted sum. Those are
 * somebody else's data and pass through untranslated as plain parameters, which
 * is also why the amount arrives already formatted rather than as cents this
 * table would have to know a currency for.
 */
import type { Locale } from "@loonext/shared";

/** One outcome's two sentences, in one language. */
interface OutcomeCopy {
  /**
   * The lock-screen title. `amount` is null when the event carried no figure,
   * and every arm reads correctly without one — an alert with no number in it
   * is still worth sending.
   */
  title(contact: string, amount: string | null): string;
  /**
   * Our own body: the fallback when the ask had no description, and the #430
   * replacement when the workspace has content withheld. One string for both,
   * because they answer the same question — what can this alert say when it
   * cannot say what the money was for.
   */
  line: string;
}

/** Keyed by `PaymentOutcome`, spelled out so the copy imports nothing back. */
interface PaymentPushCopy {
  paid: OutcomeCopy;
  refunded: OutcomeCopy;
  disputed: OutcomeCopy;
}

const EN: PaymentPushCopy = {
  paid: {
    title: (contact, amount) =>
      amount ? `${contact} paid ${amount}` : `${contact} paid`,
    line: "The payment cleared.",
  },
  refunded: {
    title: (contact, amount) =>
      amount
        ? `${amount} went back to ${contact}`
        : `The money went back to ${contact}`,
    line: "The refund has settled.",
  },
  disputed: {
    title: (contact, amount) =>
      amount
        ? `${contact}'s bank pulled back ${amount}`
        : `${contact}'s bank pulled this payment back`,
    // Says where the next step is rather than what happened, because with a
    // dispute there IS a next step and it is not in this app — evidence goes to
    // Stripe, against a deadline Stripe sets.
    line: "Your Stripe dashboard has the details.",
  },
};

const FR: PaymentPushCopy = {
  paid: {
    // The timeline's own verb, with the contact's real name where
    // thread.sysPaymentPaid says « Le client ».
    title: (contact, amount) =>
      amount ? `${contact} a payé ${amount}` : `${contact} a payé`,
    // « passer » is the house verb for a payment going through or not —
    // appShell already says « Votre dernier paiement n'est pas passé ».
    line: "Le paiement est passé.",
  },
  refunded: {
    // sysPaymentRefunded's « {amount} lui a été remboursé », with the pronoun
    // resolved to the named contact.
    title: (contact, amount) =>
      amount
        ? `${amount} a été remboursé à ${contact}`
        : `L'argent a été remboursé à ${contact}`,
    // Plain rather than « effectué » or « complété », matching the English's
    // plainness: the money has actually moved, not merely been asked for.
    line: "Le remboursement est fait.",
  },
  disputed: {
    // « repris », not « contesté » — the house already chose that verb for this
    // event (sysPaymentDisputed, « Sa banque a repris {amount} »). A judgement
    // call on length came with it: French cannot front the name the way the
    // English possessive does, so with a real name this runs a character or two
    // past the English. Both are trimmed at the same cut and the half that
    // survives it — the bank took the money back — is the one that matters.
    title: (contact, amount) =>
      amount
        ? `La banque de ${contact} a repris ${amount}`
        : `La banque de ${contact} a repris ce paiement`,
    // Stripe is a product name and stays, as the house i18n rules require
    // (appShell keeps « le portail sécurisé Stripe »).
    line: "Les détails sont dans votre tableau de bord Stripe.",
  },
};

export const PAYMENT_PUSH_COPY: Record<Locale, PaymentPushCopy> = {
  en: EN,
  "fr-CA": FR,
};
