import type { MarketingLocale } from "./footer";

export const priceCopy = {
  en: {
    guaranteeUs: "30-day money-back guarantee. Full refund, including the registration fee. No fine print.",
    guaranteeCa: "30-day money-back guarantee. Full refund, no fine print.",
    headlineSuffix: "/mo · the whole crew, up to {seats}",
  },
  "fr-CA": {
    guaranteeUs: "Garantie de remboursement de 30 jours. Remboursement complet, frais d'enregistrement compris. Aucune clause en petits caractères.",
    guaranteeCa: "Garantie de remboursement de 30 jours. Remboursement complet, aucune clause en petits caractères.",
    headlineSuffix: "/mois · toute l’équipe, jusqu’à {seats} personnes",
  },
} as const satisfies Record<MarketingLocale, {
  guaranteeUs: string;
  guaranteeCa: string;
  headlineSuffix: string;
}>;
