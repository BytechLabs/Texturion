import type { Translated } from "../translated";

/**
 * #245 — the words the schedule-feed card says, in both languages.
 *
 * ## Register
 *
 * Written for the crew member, not for whoever will implement the sync later.
 * So: "your calendar", "your scheduled work" — never "ICS", "iCalendar",
 * "endpoint" or "subscription URL" in the body copy. The one place the format
 * is named at all is where somebody has to recognise it in their calendar app's
 * own dialog, and even there it is described rather than abbreviated.
 *
 * ## What the copy has to carry that the UI cannot
 *
 * Two facts, both of which cost somebody an afternoon if they are missing:
 *
 * 1. The URL is shown ONCE. The server keeps a hash, so there is no screen
 *    anywhere that can show it again — losing it means rotating, and rotating
 *    breaks the calendar they already set up. Said before they generate it, not
 *    after.
 * 2. Anyone holding the URL can read that schedule. It is a password in the
 *    shape of a link, and it will be pasted into a third-party app, so the
 *    warning has to be in the words rather than implied by the amber border.
 */
export const calendarFeedEn = {
  title: "Your schedule in your calendar",
  description:
    "Add your scheduled jobs to Google Calendar, Apple Calendar, Outlook or any other calendar app. It updates on its own — you only set it up once.",

  create: "Set up my calendar",
  rotate: "Get a new link",
  revoke: "Turn it off",
  /** The second press. Says what breaks, rather than asking "are you sure". */
  revokeConfirm: "Turn it off — my calendar stops updating",

  shownOnceTitle: "Copy this link now",
  shownOnceDetail:
    "This is the only time you will see it. Paste it into your calendar app to subscribe. Anyone with this link can see your scheduled jobs, so keep it to yourself — if it gets out, get a new link and the old one stops working.",
  copy: "Copy link",
  copied: "Copied",
  done: "Done",

  /** The fact that answers "did I finish setting this up?". */
  lastRead: "Your calendar last checked {when}",
  neverRead:
    "Your calendar has not checked yet. It usually takes a few minutes after you subscribe.",

  failed: "That didn't go through. Try again.",
} as const;

export const calendarFeedFr: Translated<typeof calendarFeedEn> = {
  title: "Votre horaire dans votre calendrier",
  description:
    "Ajoutez vos travaux planifiés à Google Agenda, Calendrier Apple, Outlook ou n'importe quelle autre application de calendrier. La mise à jour se fait toute seule — vous ne le configurez qu'une fois.",

  create: "Configurer mon calendrier",
  rotate: "Obtenir un nouveau lien",
  revoke: "Désactiver",
  // The same "say what breaks" rule as the English, kept short enough to fit a
  // button: the consequence, not a confirmation question.
  revokeConfirm: "Désactiver — mon calendrier cesse de se mettre à jour",

  shownOnceTitle: "Copiez ce lien maintenant",
  shownOnceDetail:
    "C'est la seule fois que vous le verrez. Collez-le dans votre application de calendrier pour vous abonner. Toute personne ayant ce lien peut voir vos travaux planifiés, alors gardez-le pour vous — s'il circule, obtenez un nouveau lien et l'ancien cessera de fonctionner.",
  copy: "Copier le lien",
  copied: "Copié",
  done: "Terminé",

  lastRead: "Votre calendrier a vérifié pour la dernière fois {when}",
  neverRead:
    "Votre calendrier n'a pas encore vérifié. Cela prend habituellement quelques minutes après l'abonnement.",

  failed: "Ça n'a pas fonctionné. Réessayez.",
};
