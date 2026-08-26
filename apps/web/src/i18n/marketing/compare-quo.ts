import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const compareQuoEn = {
  metadataTitle: "Loonext vs Quo: flat beats per-user",
  metadataDescription:
    "A dated, sourced comparison. Loonext is $29/mo flat with texting included under automated fair use; Quo (formerly OpenPhone) is $19/user/mo on monthly billing with texting metered at 1¢/segment and extra numbers at $5/mo. Where Quo's calling genuinely wins, we say so.",
  home: "Home",
  compare: "Compare",
  breadcrumb: "Loonext vs Quo",
  dateline: "$19/USER/MO + 1¢/TEXT",
  title: "Loonext vs Quo: flat beats per-user.",
  lead:
    "Quo (formerly OpenPhone) is a full business phone system: calling included, priced per user at $19 a month on monthly billing, with texting metered at 1¢ a segment and extra numbers at $5 each. Loonext is one line for texts and calls, $29 a month flat for the whole crew, both included. Here is the arithmetic, dated and sourced, {month}.",
  ledgerTitle: "A 3-person crew, side by side.",
  ledgerLead:
    "Same crew, same workload of 500 texts a month, at published prices. Quo's texting cell states its real metered terms, we won't print a bundled allowance it doesn't sell, and the row where Quo flatly beats us is in the table too. On Loonext, texting is included under an automated fair-use policy that covers this workload comfortably; the concrete numbers live in our",
  fairUseLink: "fair use policy",
  ledgerCaption:
    "Monthly cost for a 3-person crew sending 500 texts: Loonext Starter next to Quo Starter, at published prices {asOf}.",
  sliderTitle: "This chart's $19 line is Quo's own seat price.",
  sliderLead:
    "The per-user line in this chart is Quo Starter's published $19/user monthly price, and it doesn't include their metered texting. Slide your crew size and watch the gap.",
  fitTitle: "When Quo fits better.",
  fitIntro:
    "Quo is a mature product with a real edge over us, and the biggest one is the obvious one: it's a phone system.",
  loonextTitle: "Reach for Loonext if",
  loonextBody:
    "Texting is the job: customers text photos of the problem, the crew answers from the truck, and you want all of it in one shared inbox at one flat price with the texts included.",
  loonextUs:
    "You'd rather one flat bill than per-user math: $29 covers the whole crew and the texts, with no per-seat fee and no per-segment meter on top.",
  loonextCa:
    "You're texting Canadian customers, or splitting work across US and Canadian customers: Canadian texting works the day you sign up, with no registration wait.",
  rivalTitle: "Reach for Quo if",
  rivalBody:
    "Your business lives on phone calls. Quo makes and receives them, with unlimited US and Canada calling on every tier, voicemail, and an AI agent. Loonext answers calls too, on every plan: they ring your whole crew in the app, unanswered ones take a voicemail we write down, you call customers back on your business number, and the ones you miss get a text back. What it is not is a call center: no phone menus, no queues, no desk phones.",
  rivalBodyTwo:
    "You want desktop and mobile apps for a distributed team that treats the phone line, not the text thread, as home base.",
  pointCallingTitle: "Calling is the honest headline.",
  pointCallingBody:
    "Unlimited US/Canada calling ships on every Quo tier. If your customers expect to reach you by voice all day, Quo is genuinely the better tool and a shared line does not replace a phone system.",
  pointFeesTitle: "Their fee disclosure sets a high bar.",
  pointFeesBody:
    "Quo prints its $19.50 one-time registration and its $1.50 to $3 monthly carrier maintenance right on the pricing page, and even reminds you before a trial ends. Credit where due; we aim to beat it, not match it, with one $29 fee, once, and no recurring carrier line at all.",
  pointAppsTitle: "A bigger app surface.",
  pointAppsBody:
    "Quo ships iOS, Android, macOS, Windows, and web apps plus integrations and an API. Loonext is a fast web app you add to your home screen, deliberately smaller.",
  recommendation:
    "Plainly: if the phone ringing is your front door, buy Quo. If the text thread is your front door and you're tired of it living on one person's cell, Loonext gives the whole crew one inbox for $29 flat, and the texts are already in the price.",
  switchTitle: "Switching from a per-user bill is quick math.",
  switchLead:
    "Count your seats, add the metered texting, and put the total next to $29 or $79 flat. If the flat line wins, moving is painless.",
  switchNumber:
    "Keep your number: transfers from Quo or any carrier are free, self-serve at signup or later, and typically take 1 to 7 business days.",
  switchLive:
    "Your number keeps working on your current provider until the scheduled switch, so you can run both while you move.",
  switchUsGuarantee:
    "Month to month, with a 30-day full money-back guarantee, registration fee included.",
  switchCaGuarantee:
    "Month to month, with a 30-day full money-back guarantee.",
  switchCalling:
    "If your team makes calls from the app all day, read the calling section above before you switch; Loonext won't do that job.",
  ctaTitle: "Flat for the crew, texts included.",
  ctaBody:
    "$29 a month covers up to three people with texting included; $79 covers up to fifteen, with a second number in the price. No seat math, no per-segment meter, and a full refund in your first 30 days if it's not for you.",
  colLoonext: "Loonext Starter",
  colRival: "Quo Starter",
  seatsLabel: "Seats (3 people)",
  seatsOursValue: "$29 flat, covers 3",
  seatsOursNote: "One price for the whole crew, not per seat.",
  seatsRivalValue: "$19/user × 3 = $57",
  seatsRivalNote:
    "Their Starter is $19/user on monthly billing, $15/user if you commit to annual.",
  workloadLabel: "500 texts a month, the workload",
  workloadOursValue: "Included",
  workloadOursNote:
    "Starter's fair-use texting covers this workload comfortably, with room to spare; receiving texts is free and unlimited.",
  workloadRivalValue: "~$5, metered",
  workloadRivalNote:
    "No bundled allowance: automated SMS is billed at 1¢ per segment; 500 single-segment texts assumed.",
  numberLabel: "A second number",
  numberOursValue: "Included on Pro ($79)",
  numberOursNote: "Pro carries two numbers: two locations, or office and field.",
  numberRivalValue: "$5/mo each",
  numberRivalNote:
    "Their pricing page lists additional phone numbers at $5 a month.",
  carrierLabel: "Monthly carrier maintenance",
  carrierOursValue: "$0",
  carrierOursNote:
    "Loonext has no recurring carrier line item; registration is $29 once, ever.",
  carrierRivalValue: "$1.50 to $3/mo",
  carrierRivalNote:
    "Their published monthly SMS maintenance fee, disclosed plainly on their pricing page.",
  callsLabel: "Phone calls",
  callsOursValue: "Included on every plan",
  callsOursNote:
    "Incoming calls ring the crew inside the app and whoever is free answers, missed ones leave a voicemail and get a text-back, and you call customers back from the business number. Generous minutes under fair use; still not a call center.",
  callsRivalValue: "Included, US and Canada",
  callsRivalNote:
    "Quo is a full phone system; unlimited US/Canada calling ships on every tier. A real advantage if voice is your front door.",
  canadaLabel: "Starting up in Canada",
  canadaOursValue: "Day one, no registration",
  canadaOursNote:
    "A Canadian business texting Canadian customers files no US registration and pays no registration fee, so the number is live and sending the same day. Turning on US texting later is where the $29 and the carrier wait apply.",
  canadaRivalValue: "$19.50 review, either way",
  canadaRivalNote:
    "Their pricing publishes one registration path, the US Campaign Registry review, and states no separate route for a Canadian business texting Canadian customers.",
  voicemailLabel: "Voicemail you can read",
  voicemailOursValue: "Every one, written down",
  voicemailOursNote:
    "A missed call takes a voicemail and we write it out into the thread, so you read it in the inbox instead of dialling in to listen. Included under fair use, not an add-on.",
  voicemailRivalValue: "Not a priced line",
  voicemailRivalNote:
    "Their published pricing covers seats, automated SMS, extra numbers and Sona automation credits. Voicemail transcription is not one of the things it prices.",
  aiLabel: "AI in the plan, not on the meter",
  aiOursValue: "Included, never per use",
  aiOursNote:
    "Lou drafts a reply for you to send or change, and writes your voicemails down, inside the plan price. We cap what our own AI costs us rather than billing you for each message it touches.",
  aiRivalValue: "1,000 credits, then per call",
  aiRivalNote:
    "Sona ships on every plan with 1,000 automation credits included. A call costs 100 credits, so past about ten calls it bills from $1.00 down to $0.45 each depending on the credit tier you buy.",
  totalLabel: "Monthly total",
  totalRivalNote:
    "$57 seats + ~$5 texting + their $1.50 to $3 maintenance; extra numbers $5 each on top.",
  footnote:
    "Loonext's numbers come straight from our published plans. Quo figures are from quo.com/pricing, re-verified {date}: Starter $15/user/mo on annual billing or $19/user/mo monthly, automated SMS at $0.01/segment, extra numbers $5/mo each, and a $1.50 to $3 monthly carrier maintenance fee. Neither total includes AI usage beyond Quo's 1,000 included automation credits, which is about ten calls at 100 credits each. One-time registration fees are excluded from both totals: ours is $29, and Quo discloses a $19.50 one-time Campaign Registry review right on its pricing page, disclosure done right. If any figure changes, tell us and we'll fix it.",
} as const;

export const compareQuoFr: Translated<typeof compareQuoEn> = {
  metadataTitle: "Loonext vs Quo : le prix fixe bat le prix par personne",
  metadataDescription:
    "Comparaison datée et sourcée. Loonext coûte 29 $ US/mois au prix fixe, textos inclus selon l'utilisation équitable; Quo (anciennement OpenPhone) coûte 19 $ US/personne/mois, avec textos à 1 ¢ US/segment et numéros supplémentaires à 5 $ US/mois. Nous nommons clairement l'avantage réel de Quo pour les appels.",
  home: "Accueil",
  compare: "Comparer",
  breadcrumb: "Loonext vs Quo",
  dateline: "19 $ US/PERSONNE/MOIS + 1 ¢ US/TEXTO",
  title: "Loonext vs Quo : le prix fixe bat le prix par personne.",
  lead:
    "Quo (anciennement OpenPhone) est un système téléphonique d'entreprise complet : appels inclus, 19 $ US par personne par mois avec facturation mensuelle, textos mesurés à 1 ¢ US le segment et numéros supplémentaires à 5 $ US chacun. Loonext réunit textos et appels sur une ligne, 29 $ US par mois au prix fixe pour toute l'équipe, les deux inclus. Voici le calcul daté et sourcé, {month}.",
  ledgerTitle: "Une équipe de 3 personnes, côte à côte.",
  ledgerLead:
    "Même équipe, même charge de 500 textos par mois, aux prix publiés. La cellule Quo donne les vraies modalités au compteur; nous n'inventons pas un volume inclus qu'il ne vend pas, et le tableau contient aussi la ligne où Quo nous bat franchement. Chez Loonext, les textos sont inclus selon une politique automatisée d'utilisation équitable qui couvre aisément cette charge; les chiffres précis se trouvent dans notre",
  fairUseLink: "politique d'utilisation équitable",
  ledgerCaption:
    "Coût mensuel d'une équipe de 3 personnes qui envoie 500 textos : Loonext Starter et Quo Starter aux prix publiés {asOf}.",
  sliderTitle: "La ligne de 19 $ US est le propre prix par place de Quo.",
  sliderLead:
    "La ligne par personne reprend le prix mensuel publié de 19 $ US/personne de Quo Starter et n'inclut pas ses textos au compteur. Faites varier la taille de l'équipe et regardez l'écart.",
  fitTitle: "Quand Quo convient mieux.",
  fitIntro:
    "Quo est un produit mûr qui possède un vrai avantage sur nous, et le plus important est évident : c'est un système téléphonique.",
  loonextTitle: "Choisissez Loonext si",
  loonextBody:
    "Le texto est le travail : les clients envoient des photos du problème, l'équipe répond du camion, et vous voulez tout réunir dans une boîte partagée à prix fixe, textos compris.",
  loonextUs:
    "Vous préférez une facture fixe au calcul par personne : 29 $ US couvrent toute l'équipe et les textos, sans frais par place ni compteur par segment.",
  loonextCa:
    "Vous textez des clients canadiens ou partagez le travail entre clients américains et canadiens : les textos canadiens fonctionnent le jour de l'inscription, sans attente d'enregistrement.",
  rivalTitle: "Choisissez Quo si",
  rivalBody:
    "Votre entreprise vit au téléphone. Quo fait et reçoit les appels, avec appels illimités aux États-Unis et au Canada sur chaque forfait, messagerie vocale et agent IA. Loonext répond aussi aux appels sur chaque forfait : ils sonnent chez toute l'équipe dans l'application, les appels sans réponse prennent un message vocal que nous transcrivons, vous rappelez au moyen du numéro d'entreprise et les appels manqués reçoivent un texto. Ce n'est toutefois pas un centre d'appels : aucun menu, aucune file, aucun téléphone de bureau.",
  rivalBodyTwo:
    "Vous voulez des applications de bureau et mobiles pour une équipe distribuée qui considère la ligne téléphonique, plutôt que le fil de textos, comme point de départ.",
  pointCallingTitle: "Les appels sont le titre honnête.",
  pointCallingBody:
    "Les appels illimités aux États-Unis et au Canada sont inclus dans chaque forfait Quo. Si vos clients doivent vous joindre par la voix toute la journée, Quo est réellement le meilleur outil et une ligne partagée ne remplace pas un système téléphonique.",
  pointFeesTitle: "Leur divulgation des frais place la barre haut.",
  pointFeesBody:
    "Quo affiche ses frais uniques d'inscription de 19,50 $ US et ses frais mensuels de fournisseur de 1,50 à 3 $ US sur la page des tarifs, et rappelle même la fin de l'essai. Le mérite leur revient; nous cherchons à faire mieux avec 29 $ US une seule fois et aucuns frais récurrents de fournisseur.",
  pointAppsTitle: "Une plus grande surface d'applications.",
  pointAppsBody:
    "Quo offre des applications iOS, Android, macOS, Windows et Web, ainsi que des intégrations et une API. Loonext est une application Web rapide à ajouter à l'écran d'accueil, volontairement plus petite.",
  recommendation:
    "En clair : si le téléphone qui sonne est votre porte d'entrée, achetez Quo. Si le fil de textos est votre porte d'entrée et que vous ne voulez plus qu'il vive sur le cellulaire d'une seule personne, Loonext donne une boîte à toute l'équipe pour 29 $ US au prix fixe, textos compris.",
  switchTitle: "Quitter une facture par personne est un calcul rapide.",
  switchLead:
    "Comptez les places, ajoutez les textos au compteur et comparez le total aux prix fixes de 29 $ US ou 79 $ US. Si la ligne fixe gagne, le déplacement est simple.",
  switchNumber:
    "Gardez votre numéro : les transferts depuis Quo ou tout fournisseur sont gratuits, libre-service à l'inscription ou plus tard, et prennent habituellement de 1 à 7 jours ouvrables.",
  switchLive:
    "Votre numéro continue de fonctionner chez son fournisseur actuel jusqu'au transfert prévu, pour exploiter les deux pendant le déplacement.",
  switchUsGuarantee:
    "De mois en mois, avec remboursement complet sous 30 jours, frais d'inscription compris.",
  switchCaGuarantee:
    "De mois en mois, avec remboursement complet sous 30 jours.",
  switchCalling:
    "Si votre équipe appelle toute la journée depuis l'application, lisez la section sur les appels avant de changer; Loonext ne remplit pas ce rôle.",
  ctaTitle: "Prix fixe pour l'équipe, textos inclus.",
  ctaBody:
    "29 $ US par mois couvrent jusqu'à trois personnes, textos compris; 79 $ US couvrent jusqu'à quinze personnes avec un deuxième numéro. Aucun calcul de places, aucun compteur par segment et remboursement complet pendant les 30 premiers jours si le produit ne vous convient pas.",
  colLoonext: "Loonext Starter",
  colRival: "Quo Starter",
  seatsLabel: "Places (3 personnes)",
  seatsOursValue: "29 $ US fixe, couvre 3",
  seatsOursNote: "Un prix pour toute l'équipe, pas par place.",
  seatsRivalValue: "19 $ US/personne × 3 = 57 $ US",
  seatsRivalNote:
    "Starter coûte 19 $ US/personne avec facturation mensuelle, ou 15 $ US/personne avec engagement annuel.",
  workloadLabel: "500 textos par mois, la charge de travail",
  workloadOursValue: "Inclus",
  workloadOursNote:
    "Les textos d'utilisation équitable de Starter couvrent aisément cette charge, avec de la marge; la réception est gratuite et illimitée.",
  workloadRivalValue: "~5 $ US, au compteur",
  workloadRivalNote:
    "Aucun volume inclus : les SMS automatisés coûtent 1 ¢ US par segment; hypothèse de 500 textos d'un segment.",
  numberLabel: "Un deuxième numéro",
  numberOursValue: "Inclus avec Pro (79 $ US)",
  numberOursNote: "Pro comprend deux numéros : deux lieux, ou bureau et terrain.",
  numberRivalValue: "5 $ US/mois chacun",
  numberRivalNote:
    "Leur page de tarifs affiche les numéros supplémentaires à 5 $ US par mois.",
  carrierLabel: "Entretien mensuel du fournisseur",
  carrierOursValue: "0 $ US",
  carrierOursNote:
    "Loonext n'a aucuns frais récurrents de fournisseur; l'inscription coûte 29 $ US une seule fois.",
  carrierRivalValue: "1,50 à 3 $ US/mois",
  carrierRivalNote:
    "Leurs frais mensuels publiés d'entretien SMS, clairement divulgués sur la page des tarifs.",
  callsLabel: "Appels téléphoniques",
  callsOursValue: "Inclus dans chaque forfait",
  callsOursNote:
    "Les appels entrants sonnent chez l'équipe dans l'application, une personne libre répond, les appels manqués laissent un message vocal et reçoivent un texto, et vous rappelez avec le numéro d'entreprise. Minutes généreuses selon l'utilisation équitable; ce n'est toujours pas un centre d'appels.",
  callsRivalValue: "Inclus, États-Unis et Canada",
  callsRivalNote:
    "Quo est un système téléphonique complet; les appels illimités aux États-Unis et au Canada sont inclus dans chaque forfait. Un vrai avantage si la voix est votre porte d'entrée.",
  canadaLabel: "Démarrage au Canada",
  canadaOursValue: "Premier jour, sans inscription",
  canadaOursNote:
    "Une entreprise canadienne qui texte des clients canadiens ne dépose aucune inscription américaine et ne paie aucuns frais; le numéro envoie le jour même. Les 29 $ US et l'attente s'appliquent seulement si l'envoi américain est activé plus tard.",
  canadaRivalValue: "Révision de 19,50 $ US, dans tous les cas",
  canadaRivalNote:
    "Leurs tarifs publient un seul chemin d'inscription, la révision américaine Campaign Registry, sans chemin distinct pour une entreprise canadienne qui texte des clients canadiens.",
  voicemailLabel: "Messages vocaux à lire",
  voicemailOursValue: "Tous, transcrits",
  voicemailOursNote:
    "Un appel manqué prend un message vocal que nous transcrivons dans le fil, pour le lire plutôt que composer pour l'écouter. Inclus selon l'utilisation équitable, pas en supplément.",
  voicemailRivalValue: "Aucun poste tarifé",
  voicemailRivalNote:
    "Leurs tarifs couvrent les places, SMS automatisés, numéros supplémentaires et crédits d'automatisation Sona. La transcription vocale n'est pas un poste tarifé.",
  aiLabel: "L'IA dans le forfait, pas au compteur",
  aiOursValue: "Incluse, jamais par utilisation",
  aiOursNote:
    "Lou prépare une réponse que vous pouvez envoyer ou modifier et transcrit les messages vocaux dans le prix du forfait. Nous plafonnons nos propres coûts d'IA plutôt que de vous facturer chaque message touché.",
  aiRivalValue: "1 000 crédits, puis par appel",
  aiRivalNote:
    "Sona est offert dans chaque forfait avec 1 000 crédits d'automatisation. Un appel coûte 100 crédits; après environ dix appels, le prix va de 1,00 $ US à 0,45 $ US chacun selon le bloc acheté.",
  totalLabel: "Total mensuel",
  totalRivalNote:
    "57 $ US de places + ~5 $ US de textos + 1,50 à 3 $ US d'entretien; chaque numéro supplémentaire ajoute 5 $ US.",
  footnote:
    "Les chiffres Loonext viennent de nos forfaits publiés. Les chiffres Quo viennent de quo.com/pricing, revérifiés le {date} : Starter à 15 $ US/personne/mois avec facturation annuelle ou 19 $ US avec facturation mensuelle, SMS automatisés à 0,01 $ US/segment, numéros supplémentaires à 5 $ US/mois et entretien mensuel de 1,50 à 3 $ US. Aucun total ne comprend l'IA au-delà des 1 000 crédits Sona inclus, soit environ dix appels à 100 crédits chacun. Les frais uniques d'inscription sont exclus : les nôtres sont de 29 $ US et Quo affiche clairement une révision Campaign Registry unique de 19,50 $ US. Si un chiffre change, dites-le-nous et nous le corrigerons.",
};

const COPY = { en: compareQuoEn, "fr-CA": compareQuoFr } as const;

export function compareQuoCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? compareQuoEn;
}
