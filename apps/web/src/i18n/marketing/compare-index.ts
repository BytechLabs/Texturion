import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const compareIndexEn = {
  metadataTitle: "Compare Loonext: the same crew, priced elsewhere",
  metadataDescription:
    "One workload, priced three ways: Loonext next to Heymarket and Quo for a 3-person crew sending 500 texts a month. Every competitor price dated {month} and sourced from their own pricing page, and every place they fit better named outright.",
  home: "Home",
  breadcrumb: "Compare",
  heroDateline: "3 PEOPLE · 500 TEXTS · {month}",
  heroTitle: "The same crew, priced elsewhere.",
  heroLead:
    "One workload, priced three ways: a 3-person crew sending 500 texts a month, at Loonext and at the two tools you're most likely weighing it against. Every competitor number is dated, comes from their own public pricing page, and is sourced cell by cell on the matching head-to-head page, where we also say when the other tool fits you better.",
  ledgerTitle: "Three pricing pages, one table.",
  ledgerLead:
    "This is the same table our pricing page shows, rendered from the same data, so the two can never quietly disagree.",
  ledgerCaption:
    "Monthly cost for a 3-person crew sending 500 texts: Loonext next to Heymarket and Quo, at published prices {asOf}.",
  emailTitle: "Not the one who signs off?",
  emailLead:
    "We will email you this table so you can forward it. Every number in it is dated, so whoever reads it can see when we last checked.",
  pickTitle: "Pick the one you're deciding between.",
  pickLead:
    "Each page carries the full sourced ledger, the crew-size math, and a plain section on when that tool is the better buy.",
  heymarketFact: "$49/user/mo · their published Starter seat",
  heymarketCardTitle: "Loonext vs Heymarket",
  heymarketAngle:
    "An enterprise-grade shared inbox with SOC 2, a HIPAA BAA, and email, priced per user with a two-seat minimum and texts billed on top.",
  quoFact: "$19/user/mo + 1¢/text",
  quoCardTitle: "Loonext vs Quo",
  quoAngle:
    "A full business phone system (formerly OpenPhone) with calling included, billed per user, texting metered by the segment.",
  cardAction: "See the comparison",
  omissionsTitle: "What Loonext doesn't do, on purpose.",
  omissionsLead:
    "Loonext is one shared line at a flat price, and holding that line means leaving real capabilities to the bigger platforms. If one of these is the job, the head-to-head pages name the tool that does it.",
  blastsTitle: "No mass text blasts.",
  blastsBody:
    "Loonext is for conversations with your customers, not campaigns at them. If you need list broadcasts, Heymarket and the marketing-texting tools do that.",
  reviewsTitle: "No review management.",
  reviewsBody:
    "We don't chase Google reviews. That's Podium's home turf, and if reviews are load-bearing for you, it's the better buy.",
  dialerTitle: "No full dialer.",
  dialerBody:
    "Loonext answers calls as well as texts, on every plan: they ring your whole crew right in the app, unanswered ones take a voicemail we write down, you call customers back on your business number, and the ones you miss get an automatic text back. What it is not is a call center, so a business that lives on phone menus, queues and all-day inbound volume belongs on Quo.",
  switchTitle: "Whatever you run today, switching is small.",
  switchLead:
    "Loonext sits comfortably next to your current tool while you move: sign up, pick or transfer a number, invite the crew by link, and shift the texting at your own pace.",
  switchNumber:
    "Keep your number: transfers are free, self-serve at signup or later, and typically take 1 to 7 business days.",
  switchLive:
    "Your number keeps working on your current provider until the scheduled switch.",
  switchUsGuarantee:
    "Month to month, with a 30-day full money-back guarantee, registration fee included.",
  switchUsActivation:
    "Receiving texts work day one; texting US numbers turns on once the phone companies approve you, typically 3 to 7 business days.",
  switchCaGuarantee:
    "Month to month, with a 30-day full money-back guarantee.",
  switchCaActivation:
    "Texting Canadian customers works the day you sign up, with no registration to wait on. Receiving texts work day one too.",
  ctaTitle: "Skip the demo. See the price and start today.",
  ctaBody:
    "One business number for texts and calls, worked by the whole crew, $29 a month flat, month to month, with a full refund in your first 30 days if it's not for you.",
} as const;

export const compareIndexFr: Translated<typeof compareIndexEn> = {
  metadataTitle: "Comparer Loonext : la même équipe, tarifée ailleurs",
  metadataDescription:
    "Une même charge de travail, trois prix : Loonext, Heymarket et Quo pour une équipe de 3 personnes qui envoie 500 textos par mois. Chaque prix concurrent est daté {month}, tiré de sa propre page de tarifs, et chaque avantage réel est nommé clairement.",
  home: "Accueil",
  breadcrumb: "Comparer",
  heroDateline: "3 PERSONNES · 500 TEXTOS · {month}",
  heroTitle: "La même équipe, tarifée ailleurs.",
  heroLead:
    "Une même charge de travail, trois prix : une équipe de 3 personnes qui envoie 500 textos par mois, chez Loonext et chez les deux outils que vous comparez le plus probablement. Chaque chiffre concurrent est daté, vient de sa page publique de tarifs et est sourcé cellule par cellule sur la page correspondante, où nous expliquons aussi quand l'autre outil vous convient mieux.",
  ledgerTitle: "Trois pages de tarifs, un seul tableau.",
  ledgerLead:
    "C'est le même tableau que sur notre page de tarifs, rendu à partir des mêmes données pour que les deux ne puissent jamais se contredire en silence.",
  ledgerCaption:
    "Coût mensuel d'une équipe de 3 personnes qui envoie 500 textos : Loonext, Heymarket et Quo aux prix publiés {asOf}.",
  emailTitle: "Ce n'est pas vous qui donnez l'approbation finale?",
  emailLead:
    "Nous pouvons vous envoyer ce tableau par courriel pour que vous le transmettiez. Chaque chiffre est daté afin que la personne qui le lit sache quand nous l'avons vérifié.",
  pickTitle: "Choisissez l'outil que vous comparez.",
  pickLead:
    "Chaque page présente le tableau sourcé complet, le calcul selon la taille de l'équipe et une section claire sur les cas où l'autre outil est le meilleur achat.",
  heymarketFact: "49 $ US/personne/mois · place Starter publiée",
  heymarketCardTitle: "Loonext vs Heymarket",
  heymarketAngle:
    "Une boîte de réception partagée de calibre entreprise avec SOC 2, entente HIPAA BAA et courriel, facturée par personne avec un minimum de deux places et les textos en supplément.",
  quoFact: "19 $ US/personne/mois + 1 ¢ US/texto",
  quoCardTitle: "Loonext vs Quo",
  quoAngle:
    "Un système téléphonique d'entreprise complet (anciennement OpenPhone), appels inclus, facturé par personne et textos mesurés par segment.",
  cardAction: "Voir la comparaison",
  omissionsTitle: "Ce que Loonext ne fait pas, volontairement.",
  omissionsLead:
    "Loonext offre une ligne partagée à prix fixe. Garder cette ligne claire signifie laisser certaines fonctions réelles aux grandes plateformes. Si l'une d'elles est votre besoin principal, les pages de comparaison nomment l'outil qui y répond.",
  blastsTitle: "Aucun envoi massif de textos.",
  blastsBody:
    "Loonext sert à converser avec vos clients, pas à leur envoyer des campagnes. Si vous avez besoin de diffusions à une liste, Heymarket et les outils de marketing par texto le font.",
  reviewsTitle: "Aucune gestion des avis.",
  reviewsBody:
    "Nous ne sollicitons pas les avis Google. C'est le terrain de Podium; si les avis sont essentiels à votre entreprise, c'est le meilleur achat.",
  dialerTitle: "Aucun composeur téléphonique complet.",
  dialerBody:
    "Loonext répond aux appels comme aux textos sur chaque forfait : les appels sonnent chez toute l'équipe dans l'application, les appels sans réponse laissent un message vocal que nous transcrivons, vous rappelez au moyen du numéro d'entreprise et les appels manqués reçoivent un texto automatique. Ce n'est toutefois pas un centre d'appels; une entreprise qui vit de menus téléphoniques, de files et d'appels entrants toute la journée devrait choisir Quo.",
  switchTitle: "Quel que soit votre outil actuel, le passage est simple.",
  switchLead:
    "Loonext peut rester à côté de votre outil actuel pendant la transition : créez le compte, choisissez ou transférez un numéro, invitez l'équipe par lien et déplacez les textos à votre rythme.",
  switchNumber:
    "Gardez votre numéro : le transfert est gratuit, libre-service à l'inscription ou plus tard, et prend habituellement de 1 à 7 jours ouvrables.",
  switchLive:
    "Votre numéro continue de fonctionner chez votre fournisseur actuel jusqu'au transfert prévu.",
  switchUsGuarantee:
    "De mois en mois, avec remboursement complet sous 30 jours, frais d'inscription compris.",
  switchUsActivation:
    "La réception fonctionne dès le premier jour; l'envoi vers les États-Unis s'active après l'approbation des compagnies de téléphone, habituellement en 3 à 7 jours ouvrables.",
  switchCaGuarantee:
    "De mois en mois, avec remboursement complet sous 30 jours.",
  switchCaActivation:
    "Les textos aux clients canadiens fonctionnent le jour de l'inscription, sans attente d'enregistrement. La réception fonctionne aussi dès le premier jour.",
  ctaTitle: "Sautez la démo. Voyez le prix et commencez aujourd'hui.",
  ctaBody:
    "Un numéro d'entreprise pour les textos et les appels, géré par toute l'équipe, à 29 $ US par mois au prix fixe, de mois en mois, avec remboursement complet pendant les 30 premiers jours si le produit ne vous convient pas.",
};

const COPY = { en: compareIndexEn, "fr-CA": compareIndexFr } as const;

export function compareIndexCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? compareIndexEn;
}
