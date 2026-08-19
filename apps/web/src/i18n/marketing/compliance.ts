import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /features/compliance, in both languages.
 *
 * ## This page is in scope, and Rule 8 is why that needed checking
 *
 * D138 Rule 8 holds four documents back for a professional translator: Terms,
 * the DPA, the AUP and the privacy policy. They state obligations that read
 * differently under Quebec law. This page *describes* those rules rather than
 * imposing them, and Rule 8 names feature pages as translated now. The links
 * out of it still point at the English contracts, which is the same boundary
 * from the other side.
 *
 * ## The keyword list changed while this was being written
 *
 * The English page listed five opt-out words. `apps/api/src/messaging/
 * keywords.ts` honours seven: ARRET (and its accented twin) went in on
 * 2026-08-04 because Telnyx's built-in set is English-only and a French
 * speaker's "ARRET" was arriving as an ordinary message. STOPALL had never
 * been named at all. So the page understated the product in both languages,
 * and worst in the one where it mattered most.
 *
 * Neither omission was found by reading. The test that guards this sentence
 * used to pin its exact wording, which made it a ceiling; it reads the
 * canonical Set now, and named both gaps on its first run.
 *
 * Both languages say it all now. The French list leads with ARRÊT, because
 * that is the word its reader's customers will actually send.
 *
 * ## The acronyms
 *
 * CASL is LCAP in French (Loi canadienne anti-pourriel) and a Quebec reader
 * knows it by that name. It appears as "la LCAP" with the English acronym once
 * in parentheses, so somebody who has only ever seen it written in English can
 * still find themselves. 10DLC and TCPA are US system names with no French
 * form and stay as they are.
 */
export const complianceEn = {
  metaTitle: "Compliance built in: registration, opt-outs, consent",
  metaDescription:
    "We register your business with the US phone companies at signup, honor STOP instantly, and record consent with a name and a date. Helps you follow TCPA and CASL.",

  breadcrumbHome: "Home",
  breadcrumbSelf: "Compliance built in",

  dateline: "STOP MEANS STOP · INSTANTLY",
  h1: "Texting rules are real. We deal with them so you don't have to.",
  heroSubUs:
    "Business texting in the US comes with real rules: registering with the phone companies, honoring opt-outs, recording consent. Most tools hand you a homework packet. Loonext files the paperwork, enforces the opt-outs, and keeps the records, so you can get back to the job.",
  heroSubCa:
    "Business texting in Canada comes with real rules under CASL: getting consent, honoring opt-outs, keeping records. There is no carrier registration to text Canadian customers. Loonext enforces the opt-outs and keeps the consent records, so you can get back to the job.",
  heroCaptionUs:
    "The registration tracker, three days in: filed, in review, nothing for you to do.",
  heroAriaUs:
    "The Loonext registration tracker showing a filing in carrier review",
  heroCaptionCa:
    "Consent on the record: a name and a date on every contact, nothing to register or wait on.",
  heroAriaCa: "Two Loonext contacts showing their recorded consent",

  regEyebrowUs: "Registration, filed for you",
  regTitleUs: "The carrier registration, without the homework.",
  regBodyUsOne:
    "In the US, the phone companies require every business that texts to register first. It's called 10DLC, and it's an industry rule, not a Loonext rule. Done yourself, it means brand and campaign forms, carrier vetting, and a resubmission if anything bounces. On Loonext you answer a few plain questions at signup, your legal name, address, and EIN, and we file the whole thing the minute you pay, follow it through review, and resubmit if it comes back.",
  regBodyUsTwo:
    "Here's the part to know up front, not buried in a footnote: approval typically takes 3 to 7 business days, about a week. That wait is the carriers', not ours, and every provider has it. You aren't idle while it happens: your number is live and receiving texts on day one. We email you the moment US texting turns on.",

  regEyebrowCa: "No registration for Canada",
  regTitleCa: "Texting Canadian customers needs no carrier registration.",
  regBodyCaOne:
    "Texting Canadian customers doesn't go through 10DLC. That US carrier-registration system applies to texting US numbers, so a Canadian business texting Canadian customers skips it entirely: no brand forms, no campaign vetting, and no filing to wait on. Your number is live and you can text Canadian customers the same day it goes active, usually a minute or two after signup.",
  regBodyCaTwo:
    "What matters in Canada is CASL, the consent law. You may text a customer who agreed to hear from you, and Loonext records that consent with a name and a date, honors every opt-out on the spot, and keeps the records if a question ever comes up. The mechanics are the same ones on this page; there is just no registration step and no approval wait in front of them.",

  optOutEyebrow: "Opt-outs",
  optOutTitle: "STOP means stop, instantly.",
  optOutCaption: "A STOP arrives, and the composer is replaced by the block.",
  optOutAria:
    "A conversation where a customer texted STOP and sends to them are blocked",
  optOutBodyOne:
    "When a customer texts STOP, they're opted out on the spot, and Loonext blocks any future send to that number until they opt back in. There's no toggle to remember and no way to text them by accident afterward: a send to an opted-out number is rejected in the app before it ever reaches the carrier.",
  optOutBodyTwo:
    'The rules also count "please stop texting me" the same as STOP, so every conversation and contact has a mark-opted-out action for requests made in the customer\'s own words. One click marks them out, and Loonext blocks every send until they ask back in. Opt-outs and opt-ins are logged with who did it and when.',

  consentEyebrow: "Consent",
  consentTitle: "Consent, on the record.",
  consentCaption:
    "The consent record on each contact: how it came to be, who recorded it, and when.",
  consentAria: "Two Loonext contacts showing their consent records",
  consentBodyOne:
    "Replying to a customer who texted you first is unrestricted: they started the conversation, and that consent is recorded automatically the moment their first text arrives. Starting a brand-new outbound conversation is the attestation that the customer asked you to text them, and Loonext stamps that record with your name and the date.",
  consentBodyTwo:
    "The record lives on the contact: how the consent came to be, who recorded it, and when. If a question ever comes up later, the answer is a lookup, not a memory. What you write is never altered either: Loonext doesn't add anything to your messages, the guardrails act on the send, not the text.",

  quietEyebrow: "The late-night check",
  quietTitle: "A gentle check before a late-night first text.",
  quietCaption:
    "Starting a conversation at 9:14 PM the customer's time: send, or wait for morning.",
  quietAria:
    "The Loonext late-night check asking whether to send a new conversation now or wait",
  quietBodyOne:
    'Start a new conversation late at night and we quietly ask first: "It\'s 9:14 PM for this customer. Send anyway?" You can send or wait. It\'s a nudge, not a hard block. We work out the customer\'s local time from their area code, and when the area code is wrong, which happens every time somebody moves and keeps their number, you can set the right timezone on their contact and we use that instead.',
  quietBodyTwo:
    "Replies to a customer who already texted you are never held up, at any hour. If someone messages you at 11pm with a burst pipe, you answer them without a dialog getting in the way.",

  factsEyebrow: "The careful version",
  // Read against `apps/api/src/messaging/keywords.ts` by features.test.tsx,
  // so a keyword added to the product fails until this sentence names it.
  factsKeywords:
    "STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, and ARRET are honored instantly, and blocked sends never reach the carrier.",
  factsWaitUs:
    "US texting turns on after carrier approval, typically 3 to 7 business days. Every provider has this wait.",
  factsLawUs:
    "Loonext helps you follow TCPA and CASL. Staying inside the law also depends on you only texting people who agreed to hear from you.",
  factsNoWaitCa:
    "Texting Canadian customers needs no carrier registration and has no approval wait; it works the same day your number is active.",
  factsLawCa:
    "Loonext helps you follow CASL. Staying inside the law also depends on you only texting people who agreed to hear from you.",

  claimsEyebrow: "What we claim, precisely",
  claimsLead:
    "Compliance copy is where it's easy to overpromise, so here is the careful version of what Loonext does and doesn't do.",
  claimsHelpTitle: "We help you follow the rules. We don't make you 'compliant'.",
  claimsHelpBody:
    "Loonext handles the mechanics: registration, opt-out enforcement, consent records. Following the law (TCPA in the US, CASL in Canada) also depends on how you use it. We give you the tools and the guardrails; the accurate word is 'helps'.",
  claimsAlterTitle: "Your messages are never altered.",
  claimsAlterBody:
    "What you write is exactly what your customer receives. Loonext doesn't append anything to your texts; the guardrails act on the send instead: blocked sends to opted-out numbers, the consent record when a conversation starts, the late-night check.",
  claimsBlastTitle: "No blast tools, on purpose.",
  claimsBlastBody:
    "There's no bulk-send or purchased-list feature. Consent can't be bought or transferred, and importing a purchased, rented, or scraped list violates our acceptable use policy. The product steers you away from what breaks the rules.",
  claimsNudgeTitle: "The late-night check is a nudge, not a lock.",
  claimsNudgeBody:
    "It fires only when you start a new conversation between 8pm and 8am in the customer's local time, and you can always choose to send. Replies to existing conversations are never delayed.",

  pricingBefore:
    "Compliance handling is part of every plan. There's no separate carrier or compliance line item on your bill, ever: the recurring carrier campaign fees are absorbed into the flat",
  pricingOr: "or",
  pricingUsBefore: "The one exception for US shops is the one-time",
  pricingUsMiddle:
    "to register your business with the phone companies, charged once, ever, so the first month is",
  pricingUsAnd: "and every month after is",
  pricingCaBefore:
    "Texting Canadian customers needs no registration fee and no approval wait, so your first month is the same flat",
  pricingCaAfter: "as every month after.",

  relatedEyebrow: "The rules, in plain language",
  relatedTitle:
    "Compliance touches everything you send, so it's worth reading the policies plainly, and seeing how the handling plays out where you work.",
  relatedAupTitle: "Acceptable use policy",
  relatedAupBody:
    "Opt-in and opt-out in plain language, the consent rule, and the purchased-list ban.",
  relatedSmsTitle: "SMS messaging policy",
  relatedSmsBody: "The STOP and consent policy language, in full.",
  relatedCanadaTitle: "Loonext in Canada",
  relatedCanadaBody:
    "Canadian crews text day one: the registration wait doesn't apply.",

  faqTitle: "Compliance questions, straight answers.",
  faq10dlcQ: "What is 10DLC, and do I really have to register?",
  faq10dlcA:
    "10DLC is the US system for registering the local numbers that businesses use to text. Registration is required by the phone companies for every business that texts US numbers; it's not optional and it's not specific to Loonext. The difference is that we file it for you and carry it through approval, instead of handing you the forms.",
  faqWaitQ: "Why does US texting take about a week to turn on?",
  faqWaitA:
    "The carriers review and approve every business before it can text US numbers, and that review typically takes 3 to 7 business days. We submit yours the minute you pay and email you the moment it's approved. Throughout the wait, receiving texts already works.",
  faqStopQ: "What happens when a customer replies STOP?",
  faqStopA:
    "They're opted out instantly, and Loonext blocks any further texts to that number until they opt back in. A send to an opted-out number is rejected in the app before it reaches the carrier, so there's no accidental message. A teammate can also mark someone opted out when they ask to stop in their own words.",
  faqConsentQ: "How is consent recorded?",
  faqConsentA:
    "Customers who text you first are recorded as having consented automatically, the moment their first text arrives. When you start a new conversation, that send is your confirmation the customer asked to hear from you, and Loonext stamps the consent record with your name and the date. The record lives on the contact, so the answer to 'did they agree?' is a lookup, not a memory.",
  faqAlterQ: "Does Loonext add anything to my messages?",
  faqAlterA:
    "No. What you write is exactly what your customer receives. The guardrails act on the send instead of the text: a send to an opted-out number is rejected, starting a conversation writes the consent record, and a late-night first text gets the quiet check.",
  faqLegalQ: "Are you saying Loonext makes me legally compliant?",
  faqLegalAUs:
    "No. We say it helps you follow the rules, and we mean the difference. Loonext handles registration, opt-outs, and consent records, but staying within TCPA and CASL also depends on you only texting people who agreed to hear from you. We give you the tooling and the guardrails; we don't claim to absolve you of the rules.",
  faqRegisterCaQ: "Do I need to register to text customers in Canada?",
  faqRegisterCaA:
    "No. The US 10DLC registration applies to texting US numbers. A Canadian business texting Canadian customers skips it entirely: there's nothing to file and nothing to wait on, and your number can text Canadian customers the same day it's active. If you later turn on US texting, Loonext files the 10DLC registration for you then.",
  faqCaslQ: "What does CASL require, and how does Loonext help?",
  faqCaslA:
    "CASL is Canada's consent law: you may text customers who agreed to hear from you, you have to honor opt-outs, and you should keep records. Loonext records consent with a name and a date, blocks every send to a number that opted out, and keeps the log, so the answer to 'did they agree?' is a lookup, not a memory.",
  faqLegalACa:
    "No. We say it helps you follow the rules, and we mean the difference. Loonext handles opt-outs and consent records, but staying within CASL also depends on you only texting people who agreed to hear from you. We give you the tooling and the guardrails; we don't claim to absolve you of the rules.",

  ctaTitleUs: "Let us handle the carrier paperwork.",
  ctaSubUs:
    "Registration filed for you, opt-outs enforced, consent recorded, so you can text customers back without becoming a compliance department.",
  ctaTitleCa: "Let us handle the compliance details.",
  ctaSubCa:
    "Opt-outs enforced, consent recorded with a name and a date, records kept, so you can text Canadian customers back without becoming a compliance department.",

  stepperHeading: "US texting registration",
  stepperStatus: "In review",
  stepperFiledTitle: "Business registered with the phone companies",
  stepperFiledBody: "Legal name, address, and EIN submitted the minute you paid.",
  stepperReviewTitle: "Carrier review, in progress",
  stepperReviewBody: "Typically 3 to 7 business days. Nothing for you to do.",
  stepperLiveTitle: "US texting turns on",
  stepperLiveBody: "We email you the moment it's approved.",
  stepperNote:
    "Receiving texts already works while you wait. Approval gates only your outbound texting.",

  optOutStamp: "opted out · today, 4:12 PM",
  optOutBlocked: "This customer opted out of texting. Sends are blocked.",
  optOutNote:
    "Rejected in the app before it reaches the carrier. No accidental texts.",

  quietPrompt: "It's 9:14 PM for this customer.",
  quietAsk: "Send anyway?",
  quietWait: "Wait",
  quietSend: "Send",
  quietNote:
    "Only when you start a late-night conversation. Replies are never held up.",
} as const;

export const complianceFr: Translated<typeof complianceEn> = {
  metaTitle: "La conformité intégrée : enregistrement, retraits, consentement",
  metaDescription:
    "Nous enregistrons votre entreprise auprès des compagnies de téléphone américaines à l'inscription, nous honorons ARRÊT et STOP instantanément, et nous consignons le consentement avec un nom et une date. Vous aide à respecter la LCAP et la TCPA.",

  breadcrumbHome: "Accueil",
  breadcrumbSelf: "La conformité intégrée",

  dateline: "ARRÊT VEUT DIRE ARRÊT · INSTANTANÉMENT",
  h1: "Les règles du texto sont réelles. On s'en occupe pour que vous n'ayez pas à le faire.",
  heroSubUs:
    "Le texto d'affaires aux États-Unis vient avec de vraies règles : s'enregistrer auprès des compagnies de téléphone, honorer les retraits, consigner le consentement. La plupart des outils vous remettent un paquet de devoirs. Loonext remplit la paperasse, applique les retraits et garde les dossiers, pour que vous retourniez à la job.",
  heroSubCa:
    "Le texto d'affaires au Canada vient avec de vraies règles sous la LCAP : obtenir le consentement, honorer les retraits, garder des dossiers. Il n'y a aucun enregistrement auprès des opérateurs pour écrire à des clients canadiens. Loonext applique les retraits et garde les dossiers de consentement, pour que vous retourniez à la job.",
  heroCaptionUs:
    "Le suivi de l'enregistrement, trois jours plus tard : déposé, en révision, rien à faire de votre côté.",
  heroAriaUs:
    "Le suivi d'enregistrement Loonext montrant un dépôt en révision chez les opérateurs",
  heroCaptionCa:
    "Le consentement au dossier : un nom et une date sur chaque contact, rien à enregistrer ni à attendre.",
  heroAriaCa: "Deux contacts Loonext montrant leur consentement consigné",

  regEyebrowUs: "L'enregistrement, déposé pour vous",
  regTitleUs: "L'enregistrement auprès des opérateurs, sans les devoirs.",
  regBodyUsOne:
    "Aux États-Unis, les compagnies de téléphone exigent que chaque entreprise qui envoie des textos s'enregistre d'abord. Ça s'appelle le 10DLC, et c'est une règle de l'industrie, pas une règle de Loonext. Fait vous-même, ça veut dire des formulaires de marque et de campagne, une vérification par les opérateurs, et une nouvelle soumission si quoi que ce soit est refusé. Sur Loonext, vous répondez à quelques questions simples à l'inscription — votre nom légal, votre adresse et votre EIN — et nous déposons le tout dès que vous payez, nous le suivons pendant la révision, et nous le resoumettons s'il revient.",
  regBodyUsTwo:
    "Voici la partie à savoir d'avance, pas enterrée dans une note de bas de page : l'approbation prend généralement de 3 à 7 jours ouvrables, environ une semaine. Cette attente est celle des opérateurs, pas la nôtre, et tous les fournisseurs l'ont. Vous n'êtes pas inactif pendant ce temps : votre numéro est en service et reçoit des textos dès le premier jour. Nous vous écrivons dès que l'envoi vers les États-Unis s'active.",

  regEyebrowCa: "Aucun enregistrement pour le Canada",
  regTitleCa:
    "Écrire à des clients canadiens n'exige aucun enregistrement auprès des opérateurs.",
  regBodyCaOne:
    "Écrire à des clients canadiens ne passe pas par le 10DLC. Ce système américain d'enregistrement auprès des opérateurs s'applique aux envois vers des numéros américains, alors une entreprise canadienne qui écrit à des clients canadiens le saute entièrement : aucun formulaire de marque, aucune vérification de campagne, aucun dépôt à attendre. Votre numéro est en service et vous pouvez écrire à des clients canadiens le jour même où il est activé, habituellement une minute ou deux après l'inscription.",
  regBodyCaTwo:
    "Ce qui compte au Canada, c'est la LCAP, la loi sur le consentement. Vous pouvez écrire à un client qui a accepté d'avoir de vos nouvelles, et Loonext consigne ce consentement avec un nom et une date, honore chaque retrait sur-le-champ, et garde les dossiers si une question survient un jour. Les mécaniques sont les mêmes que sur cette page ; il n'y a simplement aucune étape d'enregistrement ni aucune attente d'approbation devant elles.",

  optOutEyebrow: "Les retraits",
  optOutTitle: "ARRÊT veut dire arrêt, instantanément.",
  optOutCaption:
    "Un ARRÊT arrive, et le champ de saisie est remplacé par le blocage.",
  optOutAria:
    "Une conversation où un client a écrit ARRÊT et où les envois vers lui sont bloqués",
  optOutBodyOne:
    "Quand un client écrit ARRÊT ou STOP, il est retiré sur-le-champ, et Loonext bloque tout envoi futur vers ce numéro jusqu'à ce qu'il revienne. Il n'y a aucun interrupteur à retenir et aucun moyen de lui écrire par accident après coup : un envoi vers un numéro retiré est rejeté dans l'application avant même d'atteindre l'opérateur.",
  optOutBodyTwo:
    "Les règles comptent aussi « arrêtez de m'écrire » comme un ARRÊT, alors chaque conversation et chaque contact ont une action « marquer comme retiré » pour les demandes faites dans les mots du client. Un clic le retire, et Loonext bloque chaque envoi jusqu'à ce qu'il redemande. Les retraits et les retours sont journalisés avec qui l'a fait et quand.",

  consentEyebrow: "Le consentement",
  consentTitle: "Le consentement, au dossier.",
  consentCaption:
    "Le dossier de consentement sur chaque contact : comment il est né, qui l'a consigné, et quand.",
  consentAria: "Deux contacts Loonext montrant leur dossier de consentement",
  consentBodyOne:
    "Répondre à un client qui vous a écrit en premier n'est jamais restreint : c'est lui qui a commencé la conversation, et ce consentement est consigné automatiquement dès l'arrivée de son premier texto. Démarrer une toute nouvelle conversation sortante est l'attestation que le client vous a demandé de lui écrire, et Loonext estampille ce dossier avec votre nom et la date.",
  consentBodyTwo:
    "Le dossier vit sur le contact : comment le consentement est né, qui l'a consigné, et quand. Si une question survient plus tard, la réponse est une recherche, pas un souvenir. Ce que vous écrivez n'est jamais modifié non plus : Loonext n'ajoute rien à vos textos, les garde-fous agissent sur l'envoi, pas sur le texte.",

  quietEyebrow: "La vérification de fin de soirée",
  quietTitle: "Une vérification douce avant un premier texto tard le soir.",
  quietCaption:
    "Démarrer une conversation à 21 h 14 chez le client : envoyer, ou attendre au matin.",
  quietAria:
    "La vérification de fin de soirée de Loonext demandant s'il faut envoyer une nouvelle conversation maintenant ou attendre",
  quietBodyOne:
    "Démarrez une nouvelle conversation tard le soir et on demande discrètement d'abord : « Il est 21 h 14 chez ce client. Envoyer quand même ? » Vous pouvez envoyer ou attendre. C'est un rappel, pas un blocage. On déduit l'heure locale du client à partir de son indicatif régional, et quand l'indicatif est trompeur — ce qui arrive chaque fois que quelqu'un déménage en gardant son numéro — vous pouvez inscrire le bon fuseau horaire sur son contact et on utilise celui-là.",
  quietBodyTwo:
    "Les réponses à un client qui vous a déjà écrit ne sont jamais retenues, à aucune heure. Si quelqu'un vous écrit à 23 h avec un tuyau qui a éclaté, vous lui répondez sans qu'une fenêtre se mette en travers.",

  factsEyebrow: "La version prudente",
  factsKeywords:
    "ARRÊT, STOP, STOPALL, UNSUBSCRIBE, CANCEL, END et QUIT sont honorés instantanément, et les envois bloqués n'atteignent jamais l'opérateur.",
  factsWaitUs:
    "L'envoi vers les États-Unis s'active après l'approbation des opérateurs, généralement de 3 à 7 jours ouvrables. Tous les fournisseurs ont cette attente.",
  factsLawUs:
    "Loonext vous aide à respecter la TCPA et la LCAP. Rester dans la légalité dépend aussi de vous : n'écrivez qu'aux gens qui ont accepté d'avoir de vos nouvelles.",
  factsNoWaitCa:
    "Écrire à des clients canadiens n'exige aucun enregistrement auprès des opérateurs et n'a aucune attente d'approbation ; ça fonctionne le jour même où votre numéro est actif.",
  factsLawCa:
    "Loonext vous aide à respecter la LCAP. Rester dans la légalité dépend aussi de vous : n'écrivez qu'aux gens qui ont accepté d'avoir de vos nouvelles.",

  claimsEyebrow: "Ce que nous affirmons, précisément",
  claimsLead:
    "La conformité est l'endroit où il est facile de trop promettre, alors voici la version prudente de ce que Loonext fait et ne fait pas.",
  claimsHelpTitle:
    "Nous vous aidons à respecter les règles. Nous ne vous rendons pas « conforme ».",
  claimsHelpBody:
    "Loonext s'occupe des mécaniques : l'enregistrement, l'application des retraits, les dossiers de consentement. Respecter la loi (la TCPA aux États-Unis, la LCAP au Canada) dépend aussi de votre façon de l'utiliser. Nous vous donnons les outils et les garde-fous ; le mot juste est « aide ».",
  claimsAlterTitle: "Vos messages ne sont jamais modifiés.",
  claimsAlterBody:
    "Ce que vous écrivez est exactement ce que votre client reçoit. Loonext n'ajoute rien à vos textos ; les garde-fous agissent plutôt sur l'envoi : les envois bloqués vers les numéros retirés, le dossier de consentement quand une conversation commence, la vérification de fin de soirée.",
  claimsBlastTitle: "Aucun outil d'envoi en masse, volontairement.",
  claimsBlastBody:
    "Il n'y a aucune fonction d'envoi en masse ni de liste achetée. Le consentement ne s'achète ni ne se transfère, et importer une liste achetée, louée ou récoltée viole notre politique d'utilisation acceptable. Le produit vous éloigne de ce qui brise les règles.",
  claimsNudgeTitle:
    "La vérification de fin de soirée est un rappel, pas un verrou.",
  claimsNudgeBody:
    "Elle se déclenche seulement quand vous démarrez une nouvelle conversation entre 20 h et 8 h à l'heure locale du client, et vous pouvez toujours choisir d'envoyer. Les réponses aux conversations existantes ne sont jamais retardées.",

  pricingBefore:
    "Le traitement de la conformité fait partie de tous les forfaits. Il n'y a jamais de ligne distincte d'opérateur ou de conformité sur votre facture : les frais récurrents de campagne des opérateurs sont absorbés dans le prix fixe de",
  pricingOr: "ou",
  pricingUsBefore: "La seule exception pour les commerces américains est le",
  pricingUsMiddle:
    "unique pour enregistrer votre entreprise auprès des compagnies de téléphone, facturé une seule fois, à vie, alors le premier mois est de",
  pricingUsAnd: "et chaque mois ensuite est de",
  pricingCaBefore:
    "Écrire à des clients canadiens n'exige aucuns frais d'enregistrement ni aucune attente d'approbation, alors votre premier mois est le même prix fixe de",
  pricingCaAfter: "que chaque mois ensuite.",

  relatedEyebrow: "Les règles, en langage simple",
  relatedTitle:
    "La conformité touche tout ce que vous envoyez, alors ça vaut la peine de lire les politiques simplement, et de voir comment le traitement se vit dans votre métier.",
  relatedAupTitle: "Politique d'utilisation acceptable",
  relatedAupBody:
    "L'adhésion et le retrait en langage simple, la règle du consentement, et l'interdiction des listes achetées.",
  relatedSmsTitle: "Politique de messagerie texte",
  relatedSmsBody: "Le texte complet de la politique sur ARRÊT et le consentement.",
  relatedCanadaTitle: "Loonext au Canada",
  relatedCanadaBody:
    "Les équipes canadiennes écrivent dès le premier jour : l'attente d'enregistrement ne s'applique pas.",

  faqTitle: "Questions sur la conformité, réponses directes.",
  faq10dlcQ: "C'est quoi le 10DLC, et dois-je vraiment m'enregistrer ?",
  faq10dlcA:
    "Le 10DLC est le système américain d'enregistrement des numéros locaux que les entreprises utilisent pour envoyer des textos. L'enregistrement est exigé par les compagnies de téléphone pour toute entreprise qui écrit à des numéros américains ; ce n'est pas facultatif et ce n'est pas propre à Loonext. La différence, c'est que nous le déposons pour vous et le portons jusqu'à l'approbation, au lieu de vous remettre les formulaires.",
  faqWaitQ:
    "Pourquoi l'envoi vers les États-Unis prend-il environ une semaine à s'activer ?",
  faqWaitA:
    "Les opérateurs révisent et approuvent chaque entreprise avant qu'elle puisse écrire à des numéros américains, et cette révision prend généralement de 3 à 7 jours ouvrables. Nous soumettons la vôtre dès que vous payez et nous vous écrivons dès qu'elle est approuvée. Pendant toute l'attente, la réception des textos fonctionne déjà.",
  faqStopQ: "Que se passe-t-il quand un client répond ARRÊT ?",
  faqStopA:
    "Il est retiré instantanément, et Loonext bloque tout autre texto vers ce numéro jusqu'à ce qu'il revienne. Un envoi vers un numéro retiré est rejeté dans l'application avant d'atteindre l'opérateur, alors il n'y a aucun message accidentel. Un collègue peut aussi marquer quelqu'un comme retiré quand il demande d'arrêter dans ses propres mots.",
  faqConsentQ: "Comment le consentement est-il consigné ?",
  faqConsentA:
    "Les clients qui vous écrivent en premier sont consignés comme ayant consenti automatiquement, dès l'arrivée de leur premier texto. Quand vous démarrez une nouvelle conversation, cet envoi est votre confirmation que le client a demandé d'avoir de vos nouvelles, et Loonext estampille le dossier de consentement avec votre nom et la date. Le dossier vit sur le contact, alors la réponse à « a-t-il accepté ? » est une recherche, pas un souvenir.",
  faqAlterQ: "Est-ce que Loonext ajoute quelque chose à mes messages ?",
  faqAlterA:
    "Non. Ce que vous écrivez est exactement ce que votre client reçoit. Les garde-fous agissent sur l'envoi plutôt que sur le texte : un envoi vers un numéro retiré est rejeté, démarrer une conversation écrit le dossier de consentement, et un premier texto tard le soir reçoit la vérification tranquille.",
  faqLegalQ: "Dites-vous que Loonext me rend légalement conforme ?",
  faqLegalAUs:
    "Non. Nous disons que ça vous aide à respecter les règles, et la nuance compte. Loonext s'occupe de l'enregistrement, des retraits et des dossiers de consentement, mais rester à l'intérieur de la TCPA et de la LCAP dépend aussi de vous : n'écrivez qu'aux gens qui ont accepté d'avoir de vos nouvelles. Nous vous donnons l'outillage et les garde-fous ; nous ne prétendons pas vous absoudre des règles.",
  faqRegisterCaQ:
    "Dois-je m'enregistrer pour écrire à des clients au Canada ?",
  faqRegisterCaA:
    "Non. L'enregistrement 10DLC américain s'applique aux envois vers des numéros américains. Une entreprise canadienne qui écrit à des clients canadiens le saute entièrement : il n'y a rien à déposer et rien à attendre, et votre numéro peut écrire à des clients canadiens le jour même où il est actif. Si vous activez plus tard l'envoi vers les États-Unis, Loonext dépose l'enregistrement 10DLC pour vous à ce moment-là.",
  faqCaslQ: "Qu'exige la LCAP, et comment Loonext aide-t-il ?",
  faqCaslA:
    "La LCAP est la loi canadienne sur le consentement : vous pouvez écrire aux clients qui ont accepté d'avoir de vos nouvelles, vous devez honorer les retraits, et vous devriez garder des dossiers. Loonext consigne le consentement avec un nom et une date, bloque chaque envoi vers un numéro qui s'est retiré, et garde le journal, alors la réponse à « a-t-il accepté ? » est une recherche, pas un souvenir.",
  faqLegalACa:
    "Non. Nous disons que ça vous aide à respecter les règles, et la nuance compte. Loonext s'occupe des retraits et des dossiers de consentement, mais rester à l'intérieur de la LCAP dépend aussi de vous : n'écrivez qu'aux gens qui ont accepté d'avoir de vos nouvelles. Nous vous donnons l'outillage et les garde-fous ; nous ne prétendons pas vous absoudre des règles.",

  ctaTitleUs: "Laissez-nous la paperasse des opérateurs.",
  ctaSubUs:
    "L'enregistrement déposé pour vous, les retraits appliqués, le consentement consigné, pour que vous répondiez à vos clients sans devenir un service de conformité.",
  ctaTitleCa: "Laissez-nous les détails de la conformité.",
  ctaSubCa:
    "Les retraits appliqués, le consentement consigné avec un nom et une date, les dossiers gardés, pour que vous répondiez à vos clients canadiens sans devenir un service de conformité.",

  stepperHeading: "Enregistrement pour l'envoi aux États-Unis",
  stepperStatus: "En révision",
  stepperFiledTitle:
    "Entreprise enregistrée auprès des compagnies de téléphone",
  stepperFiledBody:
    "Nom légal, adresse et EIN soumis dès la minute où vous avez payé.",
  stepperReviewTitle: "Révision des opérateurs, en cours",
  stepperReviewBody: "Généralement de 3 à 7 jours ouvrables. Rien à faire de votre côté.",
  stepperLiveTitle: "L'envoi vers les États-Unis s'active",
  stepperLiveBody: "Nous vous écrivons dès que c'est approuvé.",
  stepperNote:
    "La réception des textos fonctionne déjà pendant l'attente. L'approbation ne conditionne que vos envois sortants.",

  optOutStamp: "retiré · aujourd'hui, 16 h 12",
  optOutBlocked: "Ce client s'est retiré des textos. Les envois sont bloqués.",
  optOutNote:
    "Rejeté dans l'application avant d'atteindre l'opérateur. Aucun texto accidentel.",

  quietPrompt: "Il est 21 h 14 chez ce client.",
  quietAsk: "Envoyer quand même ?",
  quietWait: "Attendre",
  quietSend: "Envoyer",
  quietNote:
    "Seulement quand vous démarrez une conversation tard le soir. Les réponses ne sont jamais retenues.",
};

const COMPLIANCE_COPY = {
  en: complianceEn,
  "fr-CA": complianceFr,
} as const;

export type ComplianceCopy = typeof complianceEn | typeof complianceFr;

export function complianceCopy(locale: MarketingLocale = "en"): ComplianceCopy {
  return COMPLIANCE_COPY[locale] ?? complianceEn;
}
