import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const compareHeymarketEn = {
  metadataTitle: "Loonext vs Heymarket: flat $29 vs $49 a person",
  metadataDescription:
    "A dated, sourced comparison. Loonext is $29/mo flat with texting included under automated fair use; Heymarket is $49/user with a 2-user minimum, texts at 3¢/segment, and a $10/mo carrier fee. About $172 vs $29 for a 3-person crew, {month}.",
  home: "Home",
  compare: "Compare",
  breadcrumb: "Loonext vs Heymarket",
  dateline: "$49/USER/MO · THEIR PUBLISHED STARTER SEAT",
  title: "Loonext vs Heymarket: flat $29 vs $49 a person.",
  lead:
    "Heymarket is a polished, enterprise-grade shared inbox, and its price model is per user: $49 a seat with a two-seat minimum, texts billed on top at 3¢ a segment, plus a $10 monthly carrier fee. Loonext is $29 a month for the whole crew, texts included. Here is the arithmetic, dated and sourced, {month}.",
  ledgerTitle: "A 3-person crew, side by side.",
  ledgerLead:
    "Same crew, same workload of 500 texts a month, at published prices. Every Heymarket figure cites the exact line item from their public pricing page, including the rows that count in their favor. On Loonext, texting is included under an automated fair-use policy that covers this workload comfortably; the concrete numbers live in our",
  fairUseLink: "fair use policy",
  ledgerCaption:
    "Monthly cost for a 3-person crew sending 500 texts: Loonext Starter next to Heymarket Standard, at published prices {asOf}.",
  sliderTitle: "Per-user pricing climbs. Flat doesn't.",
  sliderLead:
    "Heymarket's two-seat minimum puts its floor at $98 a month before a single text is sent. Slide your crew size and watch a typical per-user bill pull away from the flat line.",
  fitTitle: "When Heymarket fits better.",
  fitIntro:
    "Heymarket is a serious product for a different buyer, and pretending otherwise would cost us your trust. Here's the straight read.",
  loonextTitle: "Reach for Loonext if",
  loonextBodyOne:
    "You're a small service crew that wants every customer text in one shared inbox at one flat price, with the texts included and the whole cost printed before you pay.",
  loonextBodyTwo:
    "You want to sign up and pay online today, month to month, without booking a demo to get started.",
  rivalTitle: "Reach for Heymarket if",
  rivalBodyOne:
    "You're a larger or regulated team that needs SOC 2, a HIPAA BAA, a unified text-and-email inbox, or deep Salesforce and HubSpot integrations, and per-user pricing is normal for how you buy software.",
  rivalBodyTwo:
    "A guided demo and an annual plan are how you prefer to roll a tool out across a bigger organization.",
  pointComplianceTitle: "Compliance you can hand to an auditor.",
  pointComplianceBody:
    "Heymarket publishes SOC 2 Type 2 and offers a HIPAA BAA. Loonext doesn't hold those certifications yet and won't claim them. For healthcare or security-reviewed procurement, that's a real gap on our side.",
  pointEmailTitle: "Text and email in one shared inbox.",
  pointEmailBody:
    "Heymarket handles both channels together. Loonext has no email channel at all: our shared line is texts and calls, and email is not part of it. If your team needs to work email and texts from a single place, Heymarket does something we simply don't.",
  pointCrmTitle: "Deep CRM integrations and automations.",
  pointCrmBody:
    "Heymarket integrates tightly with Salesforce and HubSpot and offers broadcasts, campaigns, and AI-assisted flows. Loonext keeps a deliberately small surface. If your workflow lives inside a CRM, Heymarket meets it where it is.",
  recommendation:
    "Straight up: if you need SOC 2, a HIPAA BAA, a text-and-email inbox, or CRM-deep automations, buy Heymarket. It's built for that and does it well. If you're a service crew that wants texting to land in one place at one flat price, that's the job Loonext was built for.",
  switchTitle: "Switching costs you nothing but the walk.",
  switchLead:
    "Start Loonext alongside Heymarket, move your texting over at your own pace, and cancel Heymarket when your conversations live here. There's no exit window on our side to plan around.",
  switchNumber:
    "Keep your number: transfers from your current provider are free, self-serve at signup or later, and typically take 1 to 7 business days.",
  switchLive:
    "Your number keeps working where it is today until the scheduled switch, so there's no dead air while it moves.",
  switchUsGuarantee:
    "Month to month, and a 30-day money-back guarantee covers your first invoice, registration fee included.",
  switchUsActivation:
    "US carrier registration applies at every provider, ours is a one-time $29 and we file it the minute you pay. Receiving texts work day one; US texting turns on in 3 to 7 business days.",
  switchCaGuarantee:
    "Month to month, and a 30-day money-back guarantee covers your first invoice.",
  switchCaActivation:
    "Texting Canadian customers works the day you sign up, with no registration to wait on. Receiving texts work day one too.",
  ctaTitle: "One flat price, texts included, no demo.",
  ctaBody:
    "$29 a month covers the whole crew and the texts. No per-seat bill, no per-segment meter on top, no monthly carrier line item, and a full refund in your first 30 days if it's not for you.",
  colLoonext: "Loonext Starter",
  colRival: "Heymarket Standard",
  seatsLabel: "Seats (3 people)",
  seatsOursValue: "$29 flat, covers 3",
  seatsOursNote: "One price for the whole crew, not per seat.",
  seatsRivalValue: "$49/user × 3 = $147",
  seatsRivalNote:
    "Standard is $49/user/mo on annual billing with a 2-user minimum, so the floor is $98/mo before a single text.",
  workloadLabel: "500 texts a month, the workload",
  workloadOursValue: "Included",
  workloadOursNote:
    "Starter's fair-use texting covers this workload comfortably, with room to spare; receiving texts is free and unlimited.",
  workloadRivalValue: "~$15",
  workloadRivalNote:
    "SMS/MMS billed separately at $0.03 per message segment; 500 single-segment texts assumed, longer texts cost more.",
  carrierLabel: "Carrier / 10DLC fee",
  carrierOursValue: "$0/mo",
  carrierOursNote:
    "One $29 registration fee, charged once ever; Canadian-only texting never pays it.",
  carrierRivalValue: "$10/mo per campaign",
  carrierRivalNote:
    "A recurring compliance line item on their pricing page, not one-time.",
  buyLabel: "How you buy",
  buyOursValue: "Self-serve, pay online",
  buyOursNote: "The price is on the page and the button starts your account.",
  buyRivalValue: "Book a free demo",
  buyRivalNote:
    "Prices are listed, but every paid tier CTA routes to a demo first.",
  contractLabel: "Contract",
  contractOursValue: "Month to month",
  contractOursNote: "Cancel anytime in billing settings.",
  contractRivalValue: "Annual headline",
  contractRivalNote: "Pricing leads with annual billing, save up to 18%.",
  canadaLabel: "Starting up in Canada",
  canadaOursValue: "Day one, no registration",
  canadaOursNote:
    "A Canadian business texting Canadian customers files no US registration and pays no registration fee, so the number is live and sending the same day. Turning on US texting later is where the $29 and the carrier wait apply.",
  canadaRivalValue: "$10/mo campaign, either way",
  canadaRivalNote:
    "Their pricing publishes one compliance path, a monthly per-campaign 10DLC charge, and does not mention Canada at all.",
  voicemailLabel: "Voicemail you can read",
  voicemailOursValue: "Every one, written down",
  voicemailOursNote:
    "A missed call takes a voicemail and we write it out into the thread, so you read it in the inbox instead of dialling in to listen. Included under fair use, not an add-on.",
  voicemailRivalValue: "Not a priced line",
  voicemailRivalNote:
    "Their published pricing covers seats, message segments and AI Agent messages. Voicemail transcription is not one of the things it prices.",
  aiLabel: "AI in the plan, not on the meter",
  aiOursValue: "Included, never per use",
  aiOursNote:
    "Lou drafts a reply for you to send or change, and writes your voicemails down, inside the plan price. We cap what our own AI costs us rather than billing you for each message it touches.",
  aiRivalValue: "3x the base rate",
  aiRivalNote:
    "Their pricing page prices each AI Agent message at three times the $0.03 base rate, charged on top of seats.",
  totalLabel: "Monthly total",
  footnote:
    "Loonext's numbers come straight from our published plans. Heymarket figures are from heymarket.com/pricing, re-verified {date}: Standard $49/user/mo (annual) with a 2-user minimum, SMS/MMS $0.03/segment, and a $10/mo-per-campaign 10DLC fee. The ~$172 total assumes 3 seats, 500 single-segment texts, and one campaign; texts over 160 characters count as multiple segments and cost more. Neither total includes any AI usage: theirs bills AI Agent messages at 3x the base rate, and ours is included. One-time registration fees are excluded from both totals (ours is $29). If any figure changes, tell us and we'll correct it.",
} as const;

export const compareHeymarketFr: Translated<typeof compareHeymarketEn> = {
  metadataTitle: "Loonext vs Heymarket : 29 $ US fixe contre 49 $ US par personne",
  metadataDescription:
    "Comparaison datée et sourcée. Loonext coûte 29 $ US/mois au prix fixe, textos inclus selon l'utilisation équitable; Heymarket coûte 49 $ US/personne avec deux places minimum, 3 ¢ US/segment et 10 $ US/mois de frais. Environ 172 $ US contre 29 $ US pour trois personnes, {month}.",
  home: "Accueil",
  compare: "Comparer",
  breadcrumb: "Loonext vs Heymarket",
  dateline: "49 $ US/PERSONNE/MOIS · PLACE STARTER PUBLIÉE",
  title: "Loonext vs Heymarket : 29 $ US fixe contre 49 $ US par personne.",
  lead:
    "Heymarket est une boîte de réception partagée soignée, de calibre entreprise, facturée par personne : 49 $ US la place avec un minimum de deux places, les textos à 3 ¢ US le segment et 10 $ US de frais mensuels de fournisseur. Loonext coûte 29 $ US par mois pour toute l'équipe, textos inclus. Voici le calcul daté et sourcé, {month}.",
  ledgerTitle: "Une équipe de 3 personnes, côte à côte.",
  ledgerLead:
    "Même équipe, même charge de 500 textos par mois, aux prix publiés. Chaque chiffre Heymarket cite le poste exact de sa page publique, y compris ceux qui jouent en sa faveur. Chez Loonext, les textos sont inclus selon une politique automatisée d'utilisation équitable qui couvre aisément cette charge; les chiffres précis se trouvent dans notre",
  fairUseLink: "politique d'utilisation équitable",
  ledgerCaption:
    "Coût mensuel d'une équipe de 3 personnes qui envoie 500 textos : Loonext Starter et Heymarket Standard aux prix publiés {asOf}.",
  sliderTitle: "Le prix par personne monte. Le prix fixe reste.",
  sliderLead:
    "Le minimum de deux places chez Heymarket établit un plancher de 98 $ US par mois avant le premier texto. Faites varier la taille de l'équipe et regardez une facture typique par personne s'éloigner du prix fixe.",
  fitTitle: "Quand Heymarket convient mieux.",
  fitIntro:
    "Heymarket est un produit sérieux pour un autre type d'acheteur. Faire semblant du contraire minerait votre confiance. Voici la lecture directe.",
  loonextTitle: "Choisissez Loonext si",
  loonextBodyOne:
    "Vous êtes une petite équipe de services qui veut tous les textos des clients dans une boîte partagée à un prix fixe, textos compris, avec le coût complet affiché avant de payer.",
  loonextBodyTwo:
    "Vous voulez vous inscrire et payer en ligne aujourd'hui, de mois en mois, sans réserver de démo.",
  rivalTitle: "Choisissez Heymarket si",
  rivalBodyOne:
    "Vous êtes une grande équipe ou une équipe réglementée qui a besoin de SOC 2, d'une entente HIPAA BAA, d'une boîte unifiée pour textos et courriels ou d'intégrations poussées à Salesforce et HubSpot, et la facturation par personne est normale pour vous.",
  rivalBodyTwo:
    "Vous préférez une démo guidée et un forfait annuel pour déployer un outil dans une grande organisation.",
  pointComplianceTitle: "Une conformité à remettre à un auditeur.",
  pointComplianceBody:
    "Heymarket publie SOC 2 Type 2 et offre une entente HIPAA BAA. Loonext ne détient pas encore ces certifications et ne prétend pas les avoir. Pour la santé ou un achat soumis à une révision de sécurité, c'est un vrai manque de notre côté.",
  pointEmailTitle: "Textos et courriels dans une même boîte.",
  pointEmailBody:
    "Heymarket réunit les deux canaux. Loonext n'offre aucun canal courriel : notre ligne partagée couvre les textos et appels, pas le courriel. Si votre équipe doit traiter courriels et textos au même endroit, Heymarket fait quelque chose que nous ne faisons tout simplement pas.",
  pointCrmTitle: "Intégrations CRM et automatisations poussées.",
  pointCrmBody:
    "Heymarket s'intègre étroitement à Salesforce et HubSpot et offre des diffusions, campagnes et flux assistés par IA. Loonext garde volontairement une petite surface. Si votre processus vit dans un CRM, Heymarket l'y rejoint.",
  recommendation:
    "Soyons directs : si vous avez besoin de SOC 2, d'une entente HIPAA BAA, d'une boîte textos-courriels ou d'automatisations profondes dans un CRM, achetez Heymarket. Il est conçu pour cela et le fait bien. Si vous êtes une équipe de services qui veut réunir les textos à un prix fixe, c'est le travail pour lequel Loonext a été conçu.",
  switchTitle: "Changer ne vous coûte que le déplacement.",
  switchLead:
    "Démarrez Loonext à côté de Heymarket, déplacez vos textos à votre rythme et annulez Heymarket lorsque vos conversations sont ici. Aucun délai de sortie n'est à prévoir chez nous.",
  switchNumber:
    "Gardez votre numéro : les transferts sont gratuits, libre-service à l'inscription ou plus tard, et prennent habituellement de 1 à 7 jours ouvrables.",
  switchLive:
    "Votre numéro continue de fonctionner chez son fournisseur actuel jusqu'au transfert prévu; aucune période morte pendant le déplacement.",
  switchUsGuarantee:
    "De mois en mois, et la garantie de remboursement de 30 jours couvre votre première facture, frais d'inscription compris.",
  switchUsActivation:
    "L'inscription américaine s'applique chez tous les fournisseurs. La nôtre coûte 29 $ US une seule fois et nous la déposons dès le paiement. La réception fonctionne au premier jour; l'envoi américain s'active en 3 à 7 jours ouvrables.",
  switchCaGuarantee:
    "De mois en mois, et la garantie de remboursement de 30 jours couvre votre première facture.",
  switchCaActivation:
    "Les textos aux clients canadiens fonctionnent dès l'inscription, sans enregistrement à attendre. La réception fonctionne aussi dès le premier jour.",
  ctaTitle: "Un prix fixe, textos inclus, sans démo.",
  ctaBody:
    "29 $ US par mois couvrent toute l'équipe et les textos. Aucun prix par place, aucun compteur par segment, aucuns frais mensuels de fournisseur, et remboursement complet pendant les 30 premiers jours si le produit ne vous convient pas.",
  colLoonext: "Loonext Starter",
  colRival: "Heymarket Standard",
  seatsLabel: "Places (3 personnes)",
  seatsOursValue: "29 $ US fixe, couvre 3",
  seatsOursNote: "Un prix pour toute l'équipe, pas par place.",
  seatsRivalValue: "49 $ US/personne × 3 = 147 $ US",
  seatsRivalNote:
    "Standard coûte 49 $ US/personne/mois avec facturation annuelle et un minimum de 2 places; le plancher est donc 98 $ US/mois avant le premier texto.",
  workloadLabel: "500 textos par mois, la charge de travail",
  workloadOursValue: "Inclus",
  workloadOursNote:
    "Les textos d'utilisation équitable de Starter couvrent aisément cette charge, avec de la marge; la réception est gratuite et illimitée.",
  workloadRivalValue: "~15 $ US",
  workloadRivalNote:
    "SMS/MMS facturés séparément à 0,03 $ US par segment; hypothèse de 500 textos d'un segment, les textos plus longs coûtent davantage.",
  carrierLabel: "Frais de fournisseur / 10DLC",
  carrierOursValue: "0 $ US/mois",
  carrierOursNote:
    "Des frais d'inscription de 29 $ US, payés une seule fois; les textos uniquement canadiens ne les paient jamais.",
  carrierRivalValue: "10 $ US/mois par campagne",
  carrierRivalNote:
    "Un poste de conformité récurrent sur leur page de tarifs, pas des frais uniques.",
  buyLabel: "Façon d'acheter",
  buyOursValue: "Libre-service, paiement en ligne",
  buyOursNote: "Le prix est sur la page et le bouton ouvre votre compte.",
  buyRivalValue: "Réserver une démo gratuite",
  buyRivalNote:
    "Les prix sont affichés, mais le bouton de chaque forfait payant mène d'abord à une démo.",
  contractLabel: "Contrat",
  contractOursValue: "De mois en mois",
  contractOursNote: "Annulez en tout temps dans les réglages de facturation.",
  contractRivalValue: "Prix annuel en vedette",
  contractRivalNote:
    "La page met la facturation annuelle de l'avant, avec jusqu'à 18 % d'économie.",
  canadaLabel: "Démarrage au Canada",
  canadaOursValue: "Premier jour, sans inscription",
  canadaOursNote:
    "Une entreprise canadienne qui texte des clients canadiens ne dépose aucune inscription américaine et ne paie aucuns frais d'inscription; le numéro envoie donc le jour même. Les 29 $ US et l'attente du fournisseur s'appliquent seulement si l'envoi américain est activé plus tard.",
  canadaRivalValue: "10 $ US/mois par campagne, dans tous les cas",
  canadaRivalNote:
    "Leurs tarifs publient un seul chemin de conformité, des frais 10DLC mensuels par campagne, et ne mentionnent pas le Canada.",
  voicemailLabel: "Messages vocaux à lire",
  voicemailOursValue: "Tous, transcrits",
  voicemailOursNote:
    "Un appel manqué prend un message vocal que nous transcrivons dans le fil, pour le lire dans la boîte au lieu de composer pour l'écouter. Inclus selon l'utilisation équitable, pas en supplément.",
  voicemailRivalValue: "Aucun poste tarifé",
  voicemailRivalNote:
    "Leurs tarifs publiés couvrent les places, segments de messages et messages AI Agent. La transcription vocale n'est pas un poste tarifé.",
  aiLabel: "L'IA dans le forfait, pas au compteur",
  aiOursValue: "Incluse, jamais par utilisation",
  aiOursNote:
    "Lou prépare une réponse que vous pouvez envoyer ou modifier et transcrit les messages vocaux dans le prix du forfait. Nous plafonnons nos propres coûts d'IA plutôt que de vous facturer chaque message touché.",
  aiRivalValue: "3 fois le tarif de base",
  aiRivalNote:
    "Leur page facture chaque message AI Agent à trois fois le tarif de base de 0,03 $ US, en plus des places.",
  totalLabel: "Total mensuel",
  footnote:
    "Les chiffres Loonext viennent de nos forfaits publiés. Les chiffres Heymarket viennent de heymarket.com/pricing, revérifiés le {date} : Standard à 49 $ US/personne/mois (annuel), minimum de 2 places, SMS/MMS à 0,03 $ US/segment et frais 10DLC de 10 $ US/mois par campagne. Le total d'environ 172 $ US suppose 3 places, 500 textos d'un segment et une campagne; les textos de plus de 160 caractères comptent plusieurs segments et coûtent davantage. Aucun total ne comprend l'utilisation de l'IA : Heymarket facture les messages AI Agent à trois fois le tarif de base et la nôtre est incluse. Les frais uniques d'inscription sont exclus des deux totaux (les nôtres sont de 29 $ US). Si un chiffre change, dites-le-nous et nous le corrigerons.",
};

const COPY = { en: compareHeymarketEn, "fr-CA": compareHeymarketFr } as const;

export function compareHeymarketCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? compareHeymarketEn;
}
