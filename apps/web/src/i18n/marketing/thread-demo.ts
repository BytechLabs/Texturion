import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — the two demo conversations and the chrome around them.
 *
 * ## Why these are not in `home.ts`
 *
 * The water-heater thread is the home page's centrepiece, but it is not only
 * the home page's: `DARK_BAND_SCRIPT` renders inside a bento cell, the
 * primitives are shared with the feature pages' embeds, and the deep-dive
 * frame is its own section. A conversation is also a different kind of copy
 * from a headline — it has speakers and a running order — so it gets its own
 * file rather than a wing of somebody else's.
 *
 * ## The status pills and the tag are product vocabulary
 *
 * Open, Waiting, Closed and the Scheduled tag are controls the app itself
 * shows. The French here has to be the French the app uses, for the reason
 * `shared-inbox.ts` gives: a demo that labels a control differently is showing
 * the reader a button they will not find.
 *
 * ## Names are not translated
 *
 * Karen, Marcus, Dale, Priya and Reyes Plumbing are people and a business.
 * They live in {@link DEMO_CAST} rather than here, and read the same in both
 * languages. The two event lines that mention them take them as holes, because
 * French puts the indirect object somewhere English does not.
 */
export const threadDemoEn = {
  statusNew: "New",
  statusOpen: "Open",
  statusWaiting: "Waiting",
  statusClosed: "Closed",

  callNoAnswer: "Called, no answer",
  callYouCalled: "You called",
  callLeftVoicemail: "Left a voicemail",
  callWentToVoicemail: "Call went to voicemail",
  callMissed: "Missed call",
  callAnswered: "Call answered",
  missedCallTextBack:
    "This customer called and no one picked up, so we texted them back",

  waterVoicemail:
    "Hi, this is Karen on Delaware Ave. I'm trying to reach someone about our water heater, there's water on the floor underneath it. I'll send you a picture. Thanks.",
  waterTextBack:
    "Sorry we missed your call, this is Reyes Plumbing. Text us right here and someone will get back to you.",
  waterInbound:
    "Hi, do you service tankless water heaters? Ours is showing error E110 and there's water pooling underneath",
  waterPhotoLabel: "Leaking tankless heater",
  waterNote:
    "Sounds like the Navien on Delaware Ave. Dale, you're two streets over this afternoon",
  waterAssigned: "{by} assigned this conversation to {to}",
  waterReply:
    "Hi Karen, it's Dale from Reyes Plumbing. E110 with pooling water usually means a heat exchanger leak, so please don't run hot water for now. I can come by tomorrow between 9 and 11. Does that work?",
  waterConfirm: "Tomorrow between 9 and 11 works. Thank you so much",
  waterTagged: "{by} added the tag {tag}",
  tagScheduled: "Scheduled",

  darkInbound: "No hot water since this morning, any chance someone could come by today?",
  darkReply: "On my way, should be with you in about 20 minutes.",
  darkThanks: "You're a lifesaver, thank you",

  frameEyebrow: "FIRST RESPONSE",
  frameLabel: "The fix, shown",
  frameCta: "Get your number",
  frameStepThrough: "Step through it",
  frameSeeItWork: "See it work",
  frameTitle: "What actually happens when a customer reaches you.",
  frameLead:
    "Here's one conversation, slowed down. A customer calls your business number and then texts it, and step by step, this is what your crew sees and does: read the voicemail, note it, assign it, reply, confirm, tag.",
  frameAria: "A Reyes Plumbing conversation in the Loonext inbox",
  framePlayAgain: "Play it again",
  frameNext: "Next",

  stepVoicemail:
    "A call you can't take texts them back on its own, and the voicemail lands in the thread, written out.",
  stepText:
    "Their text joins the same conversation. One customer, one thread, calls and texts together.",
  stepNote: "Leave a note for the team. Customers never see notes.",
  stepAssign: "Assign it to whoever's closest. One owner, no double replies.",
  stepReply: "Reply from any phone. Delivery is confirmed, in writing.",
  stepTag: "Tag it the way you sell: quote sent, scheduled, won.",
} as const;

export const threadDemoFr: Translated<typeof threadDemoEn> = {
  statusNew: "Nouveau",
  statusOpen: "Ouvert",
  statusWaiting: "En attente",
  statusClosed: "Fermé",

  callNoAnswer: "Appelé, sans réponse",
  callYouCalled: "Vous avez appelé",
  callLeftVoicemail: "A laissé un message vocal",
  callWentToVoicemail: "L'appel est allé à la boîte vocale",
  callMissed: "Appel manqué",
  callAnswered: "Appel répondu",
  missedCallTextBack:
    "Ce client a appelé et personne n'a répondu, alors on lui a écrit en retour",

  waterVoicemail:
    "Bonjour, ici Karen sur l'avenue Delaware. J'essaie de joindre quelqu'un au sujet de notre chauffe-eau, il y a de l'eau sur le plancher en dessous. Je vais vous envoyer une photo. Merci.",
  waterTextBack:
    "Désolés d'avoir manqué votre appel, ici Reyes Plumbing. Écrivez-nous ici même et quelqu'un vous reviendra.",
  waterInbound:
    "Bonjour, faites-vous l'entretien des chauffe-eau sans réservoir ? Le nôtre affiche l'erreur E110 et il y a de l'eau qui s'accumule en dessous",
  waterPhotoLabel: "Chauffe-eau sans réservoir qui coule",
  waterNote:
    "On dirait le Navien sur l'avenue Delaware. Dale, tu es à deux rues cet après-midi",
  waterAssigned: "{by} a assigné cette conversation à {to}",
  waterReply:
    "Bonjour Karen, ici Dale de Reyes Plumbing. Une erreur E110 avec de l'eau qui s'accumule veut habituellement dire une fuite à l'échangeur de chaleur, alors n'utilisez pas d'eau chaude pour l'instant. Je peux passer demain entre 9 h et 11 h. Est-ce que ça vous convient ?",
  waterConfirm: "Demain entre 9 h et 11 h, ça marche. Merci beaucoup",
  waterTagged: "{by} a ajouté l'étiquette {tag}",
  tagScheduled: "Planifié",

  darkInbound:
    "Plus d'eau chaude depuis ce matin, est-ce que quelqu'un pourrait passer aujourd'hui ?",
  darkReply: "En route, on devrait être chez vous dans une vingtaine de minutes.",
  darkThanks: "Vous me sauvez la vie, merci",

  frameEyebrow: "PREMIÈRE RÉPONSE",
  frameLabel: "La solution, montrée",
  frameCta: "Obtenez votre numéro",
  frameStepThrough: "Parcourez-la étape par étape",
  frameSeeItWork: "Voyez-la fonctionner",
  frameTitle: "Ce qui se passe vraiment quand un client vous joint.",
  frameLead:
    "Voici une conversation, au ralenti. Un client appelle votre numéro d'entreprise puis lui écrit, et étape par étape, voici ce que votre équipe voit et fait : lire le message vocal, le noter, l'assigner, répondre, confirmer, étiqueter.",
  frameAria: "Une conversation de Reyes Plumbing dans la boîte Loonext",
  framePlayAgain: "Rejouer",
  frameNext: "Suivant",

  stepVoicemail:
    "Un appel que vous ne pouvez pas prendre leur écrit de lui-même, et le message vocal atterrit dans le fil, mis par écrit.",
  stepText:
    "Leur texto rejoint la même conversation. Un client, un fil, les appels et les textos ensemble.",
  stepNote:
    "Laissez une note à l'équipe. Les clients ne voient jamais les notes.",
  stepAssign:
    "Assignez-la à qui est le plus proche. Un seul responsable, aucune double réponse.",
  stepReply:
    "Répondez depuis n'importe quel téléphone. La livraison est confirmée, par écrit.",
  stepTag:
    "Étiquetez selon votre façon de vendre : soumission envoyée, planifié, gagné.",
};

/**
 * The people and the business in both demo threads.
 *
 * Not part of the catalogue: a name is not a word to translate, which is the
 * same rule the bilingual guard states when it leaves `name` out of its
 * data-copy list. They live here so no bilingual file holds a bare literal.
 */
export const DEMO_CAST = {
  karen: "Karen M",
  marcus: "Marcus T",
  dale: "Dale",
  priya: "Priya",
  business: "Reyes Plumbing",
} as const;

const THREAD_DEMO_COPY = {
  en: threadDemoEn,
  "fr-CA": threadDemoFr,
} as const;

export type ThreadDemoCopy = typeof threadDemoEn | typeof threadDemoFr;

export function threadDemoCopy(
  locale: MarketingLocale = "en",
): ThreadDemoCopy {
  return THREAD_DEMO_COPY[locale] ?? threadDemoEn;
}
