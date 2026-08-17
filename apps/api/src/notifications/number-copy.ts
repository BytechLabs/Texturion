/**
 * #228 — everything we say about the workspace's OWN line, in the language the
 * reader reads.
 *
 * Four senders share this table because they are four moments of one story: the
 * ported line cuts over to us (`port-completed.ts`), the carriers clear it to
 * send (`registration-approved.ts`), the subscription ends and the clock starts
 * on it, and the clock runs out (`billing/grace.ts`). A crew that reads French
 * met all four in English, on a lock screen, before opening anything.
 *
 * A MISSING TRANSLATION IS A TYPE ERROR. Every locale implements the same
 * interface, so a sentence cannot be added in one language and forgotten in the
 * other — which is the whole reason the payload is composed per reader rather
 * than looked up by key.
 *
 * PLAIN PARAMETERS, never a caller's shapes. `daysLeft` is a number and
 * `numberE164` is a string; neither knows what `GRACE_PERIOD_DAYS - day` or a
 * `phone_numbers` row looks like, so the sentence survives the call site being
 * refactored around it.
 *
 * WHAT IS NOT COPY. `numberE164` is the workspace's own E.164 line passing
 * through: never translated, never reformatted, and never localised into a
 * pretty national format here — the whole point of naming it is that the reader
 * can match it against the line they are porting.
 *
 * ── THE THREE GRACE TITLES ARE ALSO EMAIL SUBJECTS ────────────────────────
 *
 * `grace.ts` reuses each warning's subject as the push title on purpose, so a
 * customer who gets both does not wonder whether they are two events. Only the
 * PUSH is composed per reader: `deliverPush` resolves a language per device,
 * while the email goes to `billingRecipients` addresses with no reader attached
 * and an English body. So the email pins `en` at its call site, and a French
 * subject can never arrive on top of an English letter.
 */
import type { Locale } from "@loonext/shared";

interface NumberNoticeCopy {
  /** #319: the ported line is ours as of this second. */
  portCompletedTitle: string;
  /**
   * Names WHICH line moved — a crew mid-port may be moving several, and "your
   * number" would not say which. `numberE164` is their own number, untranslated.
   */
  portCompletedBody(numberE164: string): string;
  /** #310: US 10DLC registration cleared and sending is open. */
  registrationApprovedTitle: string;
  registrationApprovedBody: string;
  /** #525: the same approval, landing on a workspace every send path refuses. */
  registrationApprovedPausedTitle: string;
  registrationApprovedPausedBody: string;
  /**
   * #252 rung 1 — cancelled, with the whole window still ahead. `daysLeft` is
   * the remainder of `GRACE_PERIOD_DAYS`, computed by the caller.
   */
  graceDay1Title(daysLeft: number): string;
  /** #252 rung 2 — half the window gone. */
  graceDay15Title(daysLeft: number): string;
  /** #252 rung 3 — the last warning with runway left to act on. */
  graceDay27Title(daysLeft: number): string;
  /** One body for all three rungs: the action is the same at every one. */
  graceBody: string;
  /** #54: the notice that is already true when it arrives. */
  numberReleasedTitle: string;
  numberReleasedBody: string;
}

const EN: NumberNoticeCopy = {
  portCompletedTitle: "Your number is live",
  portCompletedBody: (numberE164) =>
    `${numberE164} is on Loonext now. Text your customers from your inbox.`,
  registrationApprovedTitle: "Your texting is live",
  registrationApprovedBody:
    "Carrier approval came through. You can text customers now.",
  registrationApprovedPausedTitle: "Your US registration is approved",
  registrationApprovedPausedBody:
    "Carrier approval came through. Texts send once you resume your plan.",
  graceDay1Title: (daysLeft) =>
    `Your Loonext subscription was canceled. Your number is safe for ${daysLeft} more days`,
  graceDay15Title: (daysLeft) =>
    `${daysLeft} days left before your Loonext business number is released`,
  graceDay27Title: (daysLeft) =>
    `Final notice: your Loonext business number is released in ${daysLeft} days`,
  graceBody: "Open Loonext to keep your number.",
  numberReleasedTitle: "Your Loonext business number has been released",
  numberReleasedBody:
    "Open Loonext to see what this means and what you can still do.",
};

const FR: NumberNoticeCopy = {
  // « en service » is the phrasing the shipped port card already settled on
  // (settingsMore.portLive, « En service sur Loonext »), so the alert and the
  // screen it links to name the same state. 27 chars, well inside the title cut.
  portCompletedTitle: "Votre numéro est en service",
  // The second sentence tracks settingsMore.portStateTextingLive (« Écrivez à
  // vos clients... »), changed from « directement d'ici » to name the inbox:
  // a push is read outside the app, where "here" is the lock screen.
  // « boîte de réception » is the house term (shell.navInbox).
  portCompletedBody: (numberE164) =>
    `${numberE164} est en service sur Loonext. ` +
    "Écrivez à vos clients depuis votre boîte de réception.",
  // Verbatim from the shipped domain.regStageApprovedTitle, which translates
  // this exact English. Consistency with the screen is binding here.
  registrationApprovedTitle: "Vos textos sont en service",
  // « fournisseur » is what this repo calls a carrier throughout
  // (domain.scheduledHoldRegistrationPending, settings.helpFaqPendingA), never
  // « transporteur ». The second sentence is verbatim domain.regStageApprovedNext.
  registrationApprovedBody:
    "Les fournisseurs vous ont approuvé. Vous pouvez texter vos clients dès maintenant.",
  // SHORTENED DELIBERATELY. The natural « Votre inscription américaine est
  // approuvée » is 42 chars and the OS truncates a push title near 40; this is
  // 32 and keeps the load-bearing fact — it is the US registration that cleared,
  // not texting generally, which is exactly the distinction #525 exists to make.
  registrationApprovedPausedTitle: "Inscription américaine approuvée",
  // « forfait » is the house word for a plan, and the resume construction
  // mirrors domain.scheduledHoldWorkspacePaused (« Le message partira à votre
  // reprise »); settingsMore.resume is « Reprendre ».
  registrationApprovedPausedBody:
    "Les fournisseurs vous ont approuvé. Les textos partiront à la reprise de votre forfait.",
  // « conservé » is the verb settings.offerPausedSeasonalBody already uses for a
  // number being held rather than released. Shorter than the English's ~84.
  graceDay1Title: (daysLeft) =>
    `Abonnement Loonext annulé. Votre numéro est conservé encore ${daysLeft} jours`,
  // « libérer » is the house verb for a number going back to the carrier
  // (settings.offerStarterTail). « d'entreprise » dropped for length — 68 chars
  // against the English's 67, and with the app name present « votre numéro
  // Loonext » is unambiguous.
  graceDay15Title: (daysLeft) =>
    `Plus que ${daysLeft} jours avant la libération de votre numéro Loonext`,
  // Space before the colon is the French typography this repo already uses
  // (inbox, « Une étape reste : »). « d'entreprise » dropped for length as above.
  graceDay27Title: (daysLeft) =>
    `Dernier avis : votre numéro Loonext est libéré dans ${daysLeft} jours`,
  graceBody: "Ouvrez Loonext pour garder votre numéro.",
  // « numéro d'entreprise » is kept in full here because the sentence has room:
  // 45 chars, the same as the English.
  numberReleasedTitle: "Votre numéro d'entreprise Loonext a été libéré",
  // Deliberately plain, like the English. The reader has just lost the number
  // and the sentence must not sound like a form letter.
  numberReleasedBody:
    "Ouvrez Loonext pour voir ce que ça veut dire et ce que vous pouvez encore faire.",
};

export const NUMBER_NOTICE_COPY: Record<Locale, NumberNoticeCopy> = {
  en: EN,
  "fr-CA": FR,
};
