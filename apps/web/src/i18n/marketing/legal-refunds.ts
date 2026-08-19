import type { Translated } from "../translated";

import type { MarketingLocale } from "./footer";

/**
 * D138 — /legal/refunds, in both languages.
 *
 * ## Why this one IS translated when Terms is not
 *
 * The page says the guarantee "is also part of our terms of service", which
 * reads like a reason to hold it back with the Terms under Rule 8. Rule 8
 * answers that itself: *"This rule is a scope boundary, not a reason to stop:
 * it names four documents, and everything else proceeds."* Four documents wait
 * for a professional translator — Terms, the DPA, the AUP, the privacy policy.
 * This is not one of them, and Bill 96 exposure runs the other way for
 * everything that is not on that list.
 *
 * The cross-reference still points at the English Terms, which is the same
 * boundary seen from the other side and is correct until that document is
 * translated.
 *
 * ## The fee is a component
 *
 * `<RegistrationFee />` follows the site-wide country, so a workspace that paid
 * the CAD amount reads the CAD amount in the sentence promising it back (#328).
 * The sentence is split around it rather than carrying a hole.
 */
export const legalRefundsEn = {
  metaTitle: "30-day money-back guarantee",
  metaDescription:
    "The Loonext 30-day money-back guarantee: a full refund of your first invoice, subscription and the one-time registration fee included, no deductions for texts you sent, requested with a single email.",

  title: "30-day money-back guarantee",
  breadcrumbLabel: "30-day guarantee",
  summary:
    "Tell us within 30 days of signing up and we refund your first invoice in full, the subscription and the one-time registration fee included. One email is the whole process, no reason needed, no forms, no retention call. The refund goes back to your original payment method, usually issued within one business day.",

  sectionGuarantee: "The guarantee",
  sectionRequest: "How to request a refund",
  sectionAfter: "What happens next",
  sectionContact: "Contact",

  guaranteeBefore:
    "If Loonext isn't right for your crew, tell us within 30 days of signing up and we'll refund your first invoice in full, the subscription and, if you paid it, the one-time",
  guaranteeAfter:
    'registration fee. No "minus credits used": the texts you sent during those 30 days are on us. No forms, no retention call. The guarantee covers the first 30 days of your first Loonext subscription; it doesn\'t reset if you cancel and come back later. It is also part of our',
  guaranteeTermsLink: "terms of service",
  guaranteeEnd: ".",
  guaranteeYear:
    "If you paid for a year up front, the same 30 days cover the whole amount. A guarantee that gets smaller the more you commit is not a guarantee, so we refund the year in full on the same one email.",
  guaranteeAfterThirty:
    "After 30 days, a prepaid year is refundable for the months you haven't used, and we don't claw back the discount to do the arithmetic: the months you did use are charged at what you actually paid for them, not at the monthly rate. Months already used aren't refunded, because you used them.",

  requestBefore: "Email",
  requestAfter:
    "from the email address on your account within your first 30 days and say you'd like the refund. That's the whole process. You don't need to give a reason, though we appreciate hearing what didn't work. We reply.",

  afterRefund:
    "We cancel your subscription and refund your full first invoice to your original payment method through Stripe. We issue the refund promptly, typically within one business day of your email; depending on your bank or card issuer it can take 5 to 10 business days to appear on your statement.",
  afterNumberBefore:
    "Your number follows the same 30-day hold as any cancellation (see our",
  afterNumberLink: "terms",
  afterNumberAfter:
    "): if you resubscribe within 30 days you keep it; after that it is released and can't be recovered.",

  contactBefore: "Questions about the guarantee? Email",
  contactMiddle: "or use our",
  contactLink: "contact page",
  contactAfter: ".",
} as const;

export const legalRefundsFr: Translated<typeof legalRefundsEn> = {
  metaTitle: "Garantie de remboursement de 30 jours",
  metaDescription:
    "La garantie de remboursement de 30 jours de Loonext : un remboursement complet de votre première facture, abonnement et frais uniques d'enregistrement compris, sans déduction pour les textos envoyés, demandé par un seul courriel.",

  title: "Garantie de remboursement de 30 jours",
  breadcrumbLabel: "Garantie de 30 jours",
  summary:
    "Dites-le-nous dans les 30 jours suivant votre inscription et nous remboursons votre première facture au complet, l'abonnement et les frais uniques d'enregistrement compris. Un seul courriel, c'est tout le processus : aucune raison à donner, aucun formulaire, aucun appel de rétention. Le remboursement retourne à votre mode de paiement d'origine, habituellement émis dans un jour ouvrable.",

  sectionGuarantee: "La garantie",
  sectionRequest: "Comment demander un remboursement",
  sectionAfter: "Ce qui se passe ensuite",
  sectionContact: "Nous joindre",

  guaranteeBefore:
    "Si Loonext ne convient pas à votre équipe, dites-le-nous dans les 30 jours suivant votre inscription et nous rembourserons votre première facture au complet : l'abonnement et, si vous les avez payés, les frais uniques de",
  guaranteeAfter:
    "pour l'enregistrement. Aucun « moins les crédits utilisés » : les textos que vous avez envoyés pendant ces 30 jours sont à nos frais. Aucun formulaire, aucun appel de rétention. La garantie couvre les 30 premiers jours de votre premier abonnement Loonext ; elle ne recommence pas si vous annulez et revenez plus tard. Elle fait aussi partie de nos",
  guaranteeTermsLink: "conditions d'utilisation",
  guaranteeEnd: ".",
  guaranteeYear:
    "Si vous avez payé une année d'avance, les mêmes 30 jours couvrent le montant complet. Une garantie qui rapetisse à mesure que vous vous engagez n'est pas une garantie, alors nous remboursons l'année au complet sur le même courriel.",
  guaranteeAfterThirty:
    "Après 30 jours, une année payée d'avance est remboursable pour les mois que vous n'avez pas utilisés, et nous ne reprenons pas le rabais pour faire le calcul : les mois que vous avez utilisés sont facturés à ce que vous avez réellement payé pour eux, pas au tarif mensuel. Les mois déjà utilisés ne sont pas remboursés, parce que vous les avez utilisés.",

  requestBefore: "Écrivez à",
  requestAfter:
    "depuis l'adresse courriel de votre compte dans vos 30 premiers jours et dites que vous voulez le remboursement. C'est tout le processus. Vous n'avez pas à donner de raison, même si nous apprécions savoir ce qui n'a pas fonctionné. Nous répondons.",

  afterRefund:
    "Nous annulons votre abonnement et remboursons votre première facture au complet à votre mode de paiement d'origine par Stripe. Nous émettons le remboursement rapidement, généralement dans un jour ouvrable suivant votre courriel ; selon votre banque ou l'émetteur de votre carte, ça peut prendre de 5 à 10 jours ouvrables avant d'apparaître sur votre relevé.",
  afterNumberBefore:
    "Votre numéro suit la même retenue de 30 jours que toute annulation (voyez nos",
  afterNumberLink: "conditions",
  afterNumberAfter:
    ") : si vous vous réabonnez dans les 30 jours, vous le gardez ; après ça, il est libéré et ne peut pas être récupéré.",

  contactBefore: "Des questions sur la garantie ? Écrivez à",
  contactMiddle: "ou utilisez notre",
  contactLink: "page de contact",
  contactAfter: ".",
};

const LEGAL_REFUNDS_COPY = {
  en: legalRefundsEn,
  "fr-CA": legalRefundsFr,
} as const;

export type LegalRefundsCopy =
  | typeof legalRefundsEn
  | typeof legalRefundsFr;

export function legalRefundsCopy(
  locale: MarketingLocale = "en",
): LegalRefundsCopy {
  return LEGAL_REFUNDS_COPY[locale] ?? legalRefundsEn;
}
