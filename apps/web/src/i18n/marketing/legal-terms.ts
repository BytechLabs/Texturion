import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

export const legalTermsEn = {
  metaTitle: "Terms of service",
  metaDescription:
    "The Loonext terms of service: a month-to-month subscription, no annual contract, plain-language cancellation with a 30-day number hold, and the money-back guarantee.",
  title: "Terms of service",
  breadcrumbLabel: "Terms of service",
  lastUpdated: "November 10, 2026",
  summary:
    "Loonext is a month-to-month subscription with no annual contract: cancel anytime from your billing settings, and we hold your number for 30 days in case you come back. Your first 30 days carry a full money-back guarantee, registration fee included. Text only people who have agreed to hear from you. That is most of what follows.",

  sectionAgreement: "The agreement",
  sectionEligibility: "Who can sign up",
  sectionSubscription: "Subscription and billing",
  sectionNumbers: "Your phone number",
  sectionAcceptableUse: "Acceptable use",
  sectionCancellation: "Cancellation and number hold",
  sectionGuarantee: "30-day money-back guarantee",
  sectionAvailability: "Availability and changes",
  sectionLiability: "Liability",
  sectionLanguage: "Language",
  sectionContact: "Contact",

  aupLink: "acceptable use policy",
  refundsLink: "guarantee page",
  statusLink: "status page",
  contactLink: "contact page",

  currencyUs: "US dollars",
  currencyCa: "Canadian dollars",

  agreement:
    "By creating a Loonext account or using the service, you agree to these terms on behalf of your business. If you don't agree, don't use Loonext. \"Loonext,\" \"we,\" and \"us\" mean the company that operates Loonext; \"you\" means the business that holds the account and the people it authorizes to use it.",
  eligibility:
    "Loonext is built for businesses in the United States and Canada that text their own customers. You must be able to enter into a contract, run a real business, and give accurate business information when you register your number with the phone companies. You must have the consent of the people you text, see our {aup}.",
  subscriptionOne:
    "Loonext is a paid, month-to-month subscription. There is no annual contract and nothing auto-converts from a trial, there is no trial that provisions a number. You pick Starter ({starter}/mo) or Pro ({pro}/mo), pay through Stripe, and your number is created only after your payment succeeds.",
  subscriptionTwo:
    "US businesses (and Canadian businesses that turn on US texting) also pay a one-time {fee} fee to register with the phone companies. It is charged once, ever, cancel and come back later and you won't pay it again.",
  subscriptionThree:
    "Prices are in {currency}, plus sales tax where it applies, calculated at checkout by Stripe Tax. Your currency follows the country of your business: it is set when your workspace is created and fixed once you subscribe, because Stripe pins the currency to the subscription. Changing it later means cancelling and signing up again, so email us and we will walk you through it. If you send more than your plan's included texts, extra texts are billed at your plan's overage rate up to a spending cap you control. We email you at 80% and 100% of your included texts. Your subscription renews automatically each month until you cancel.",
  numbersOne:
    "The local number Loonext provisions belongs to your business account while your subscription is active. You can send to Canadian numbers as soon as the number is live; sending to US numbers turns on after the phone companies approve your registration (typically 3 to 7 business days). Receiving texts works right away.",
  numbersTwo:
    "You can bring your existing US or Canadian number to Loonext instead of getting a new one, the transfer is free. Your number keeps working on your current carrier the whole time and switches to Loonext on the transfer date, which typically takes about 1 to 7 business days. Texting through Loonext turns on once the transfer completes. We show you where the transfer is at every step.",
  acceptableUse:
    "Your use of Loonext is subject to our {aup}. In short: text only people who have agreed to hear from you, no purchased or harvested lists, no SHAFT content (sex, hate, alcohol, firearms, tobacco), and honor every opt-out immediately. We may suspend or terminate accounts that break these rules or put message delivery at risk for everyone on the network.",
  cancellationOne:
    "You can cancel anytime from your billing settings, no phone call, no retention chat. Cancellation stops the next renewal; you keep access through the period you've already paid for. We do not add cancellation friction and there are no early-termination fees.",
  cancellationTwo:
    "After you cancel, we hold your number for 30 days. If you resubscribe within that window, you keep the same number. After 30 days the number is released back to the phone company and can be reassigned to another business, so anyone who still has it saved will eventually reach someone else. We cannot get it back for you. If you want to keep the number, port it out to another carrier before the 30 days are up.",
  guarantee:
    "If Loonext isn't right for your crew, email us within 30 days of signing up and we'll refund your first invoice in full, the subscription and the one-time registration fee included. No \"minus credits used,\" no forms, no retention call. The full policy is on our {refunds}.",
  availability:
    "We work to keep Loonext available, but we don't guarantee uninterrupted service, text delivery depends on the phone companies and carriers, which we don't control. Current service status is on our {status}. We may update the product and these terms; when we make a material change to these terms, we'll update the date above and, where appropriate, let account owners know.",
  liability:
    "Loonext is provided \"as is.\" To the extent the law allows, we're not liable for indirect or consequential losses, and our total liability for any claim is limited to the amount you paid us in the three months before the claim. Nothing here limits liability that can't be limited by law.",
  languageOne:
    "These terms, and the acceptable use policy, privacy policy and data processing agreement published with them, are available in English and in French. If you are in Quebec, the French version is presented to you first and it governs your agreement with us.",
  languageTwo:
    "You are bound by the English version instead only if that is your express wish, made after you have seen the French version. Everywhere else, the English version governs and the French version is a translation provided for your convenience.",
  contact:
    "Questions about these terms? Email {supportEmail} or use our {contactPage}. A real person answers.",
} as const;

export const legalTermsFr: Translated<typeof legalTermsEn> = {
  metaTitle: "Conditions d'utilisation",
  metaDescription:
    "Les conditions d'utilisation de Loonext : un abonnement mensuel sans engagement annuel, une annulation en langage clair avec une retenue du numéro de 30 jours, et la garantie de remboursement.",
  title: "Conditions d'utilisation",
  breadcrumbLabel: "Conditions d'utilisation",
  lastUpdated: "10 novembre 2026",
  summary:
    "Loonext est un abonnement mensuel sans engagement annuel : annulez en tout temps dans les paramètres de facturation, et nous gardons votre numéro pendant 30 jours au cas où vous reviendriez. Vos 30 premiers jours sont couverts par une garantie de remboursement complète, frais d'enregistrement compris. N'envoyez des textos qu'aux personnes qui ont accepté d'en recevoir. C'est l'essentiel de ce qui suit.",

  sectionAgreement: "L'entente",
  sectionEligibility: "Qui peut s'inscrire",
  sectionSubscription: "Abonnement et facturation",
  sectionNumbers: "Votre numéro de téléphone",
  sectionAcceptableUse: "Utilisation acceptable",
  sectionCancellation: "Annulation et retenue du numéro",
  sectionGuarantee: "Garantie de remboursement de 30 jours",
  sectionAvailability: "Disponibilité et modifications",
  sectionLiability: "Responsabilité",
  sectionLanguage: "Langue",
  sectionContact: "Nous joindre",

  aupLink: "politique d'utilisation acceptable",
  refundsLink: "page sur la garantie",
  statusLink: "page sur l'état du service",
  contactLink: "page de contact",

  currencyUs: "dollars américains",
  currencyCa: "dollars canadiens",

  agreement:
    "En créant un compte Loonext ou en utilisant le service, vous acceptez les présentes conditions au nom de votre entreprise. Si vous êtes en désaccord, n'utilisez pas Loonext. « Loonext », « nous » et « notre » désignent l'entreprise qui exploite Loonext; « vous » désigne l'entreprise titulaire du compte et les personnes qu'elle autorise à l'utiliser.",
  eligibility:
    "Loonext est conçu pour les entreprises des États-Unis et du Canada qui envoient des textos à leurs propres clients. Vous devez avoir la capacité de conclure un contrat, exploiter une véritable entreprise et fournir des renseignements exacts sur votre entreprise lorsque vous enregistrez votre numéro auprès des compagnies de téléphone. Vous devez avoir le consentement des personnes à qui vous envoyez des textos; consultez notre {aup}.",
  subscriptionOne:
    "Loonext est un abonnement payant, mois par mois. Il n'y a aucun engagement annuel et rien ne se convertit automatiquement à partir d'un essai : il n'existe aucun essai qui attribue un numéro. Vous choisissez Starter ({starter}/mois) ou Pro ({pro}/mois), vous payez par Stripe, et votre numéro n'est créé qu'une fois votre paiement réussi.",
  subscriptionTwo:
    "Les entreprises américaines (et les entreprises canadiennes qui activent les textos vers les États-Unis) paient aussi des frais uniques de {fee} pour l'enregistrement auprès des compagnies de téléphone. Ils sont facturés une seule fois, pour toujours : si vous annulez et revenez plus tard, vous ne les payez pas de nouveau.",
  subscriptionThree:
    "Les prix sont en {currency}, taxes de vente en sus lorsqu'elles s'appliquent, calculées au moment du paiement par Stripe Tax. Votre devise suit le pays de votre entreprise : elle est établie à la création de votre espace de travail et fixée dès que vous vous abonnez, parce que Stripe associe la devise à l'abonnement. La changer plus tard exige d'annuler puis de vous inscrire de nouveau; écrivez-nous et nous vous guiderons. Si vous envoyez plus de textos que ceux inclus dans votre forfait, les textos supplémentaires sont facturés au tarif de dépassement de votre forfait, jusqu'à un plafond de dépenses que vous contrôlez. Nous vous écrivons par courriel lorsque vous atteignez 80 % et 100 % des textos inclus. Votre abonnement se renouvelle automatiquement chaque mois jusqu'à ce que vous l'annuliez.",
  numbersOne:
    "Le numéro local que Loonext attribue appartient au compte de votre entreprise tant que votre abonnement est actif. Vous pouvez envoyer des textos à des numéros canadiens dès que le numéro est en service; l'envoi vers des numéros américains est activé après l'approbation de votre enregistrement par les compagnies de téléphone (habituellement de 3 à 7 jours ouvrables). La réception de textos fonctionne tout de suite.",
  numbersTwo:
    "Vous pouvez apporter votre numéro américain ou canadien existant chez Loonext au lieu d'en obtenir un nouveau; le transfert est gratuit. Votre numéro continue de fonctionner chez votre fournisseur actuel pendant tout ce temps et passe à Loonext à la date du transfert, ce qui prend habituellement de 1 à 7 jours ouvrables. L'envoi de textos par Loonext est activé une fois le transfert terminé. Nous vous indiquons où en est le transfert à chaque étape.",
  acceptableUse:
    "Votre utilisation de Loonext est assujettie à notre {aup}. En bref : n'envoyez des textos qu'aux personnes qui ont accepté d'en recevoir, aucune liste achetée ou récoltée, aucun contenu SHAFT (sexe, haine, alcool, armes à feu, tabac), et respectez immédiatement chaque retrait. Nous pouvons suspendre ou résilier les comptes qui enfreignent ces règles ou qui compromettent la livraison des messages pour tous les utilisateurs du réseau.",
  cancellationOne:
    "Vous pouvez annuler en tout temps dans vos paramètres de facturation, sans appel téléphonique ni conversation de rétention. L'annulation met fin au prochain renouvellement; vous conservez l'accès pour la période que vous avez déjà payée. Nous n'ajoutons aucun obstacle à l'annulation et il n'y a aucuns frais de résiliation anticipée.",
  cancellationTwo:
    "Après votre annulation, nous gardons votre numéro pendant 30 jours. Si vous vous réabonnez dans ce délai, vous conservez le même numéro. Après 30 jours, le numéro est remis à la compagnie de téléphone et peut être attribué à une autre entreprise; quiconque l'a encore enregistré finira donc par joindre quelqu'un d'autre. Nous ne pouvons pas le récupérer pour vous. Si vous voulez garder le numéro, transférez-le chez un autre fournisseur avant la fin des 30 jours.",
  guarantee:
    "Si Loonext ne convient pas à votre équipe, écrivez-nous dans les 30 jours suivant votre inscription et nous rembourserons votre première facture au complet, abonnement et frais uniques d'enregistrement compris. Aucun « moins les crédits utilisés », aucun formulaire, aucun appel de rétention. La politique complète figure sur notre {refunds}.",
  availability:
    "Nous nous efforçons de garder Loonext disponible, mais nous ne garantissons pas un service ininterrompu : la livraison des textos dépend des compagnies de téléphone et des fournisseurs, que nous ne contrôlons pas. L'état actuel du service se trouve sur notre {status}. Nous pouvons modifier le produit et les présentes conditions; lorsque nous y apportons un changement important, nous mettons à jour la date ci-dessus et, s'il y a lieu, nous en informons les propriétaires de comptes.",
  liability:
    "Loonext est fourni « tel quel ». Dans la mesure où la loi le permet, nous ne sommes pas responsables des pertes indirectes ou consécutives, et notre responsabilité totale à l'égard de toute réclamation est limitée au montant que vous nous avez payé au cours des trois mois précédant la réclamation. Rien dans les présentes ne limite une responsabilité qui ne peut pas être limitée par la loi.",
  languageOne:
    "Les présentes conditions, ainsi que la politique d'utilisation acceptable, la politique de confidentialité et l'entente de traitement des données publiées avec elles, sont offertes en anglais et en français. Si vous êtes au Québec, la version française vous est présentée en premier et elle régit votre entente avec nous.",
  languageTwo:
    "Vous n'êtes lié par la version anglaise que si tel est votre souhait exprès, formulé après avoir pris connaissance de la version française. Partout ailleurs, la version anglaise prévaut et la version française est une traduction fournie pour votre commodité.",
  contact:
    "Des questions sur ces conditions? Écrivez à {supportEmail} ou utilisez notre {contactPage}. Une vraie personne vous répond.",
};

const COPY = { en: legalTermsEn, "fr-CA": legalTermsFr } as const;

export function legalTermsCopy(locale: MarketingLocale = "en") {
  return COPY[locale] ?? legalTermsEn;
}
