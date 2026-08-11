import { DEFAULT_LOCALE } from "@loonext/shared";

import {
  makeTranslate,
  type MessageKey,
  type Translate,
} from "@/i18n/provider";

/** English, for a caller with no provider around it. */
const EN = makeTranslate(DEFAULT_LOCALE);

/**
 * TCR business verticals (SPEC §4.1 step 3) — the enum values MUST match
 * apps/api/src/telnyx/wizard.ts `TCR_VERTICALS` byte-for-byte (the API
 * validates the brand draft against that list). Labels are ours (G10: plain
 * language; the ICP-fitting default 'PROFESSIONAL' sorts naturally).
 */
export const TCR_VERTICALS = [
  "AGRICULTURE",
  "COMMUNICATION",
  "CONSTRUCTION",
  "EDUCATION",
  "ENERGY",
  "ENTERTAINMENT",
  "FINANCIAL",
  "GAMBLING",
  "GOVERNMENT",
  "HEALTHCARE",
  "HOSPITALITY",
  "HUMAN_RESOURCES",
  "INSURANCE",
  "LEGAL",
  "MANUFACTURING",
  "NGO",
  "POLITICAL",
  "POSTAL",
  "PROFESSIONAL",
  "REAL_ESTATE",
  "RETAIL",
  "TECHNOLOGY",
  "TRANSPORTATION",
] as const;

export type TcrVertical = (typeof TCR_VERTICALS)[number];

/**
 * A key per vertical, not a sentence.
 *
 * A title-cased enum token is English — "REAL_ESTATE" reads as "Real estate"
 * and as nothing at all in French — and the person reading this list is picking
 * their own trade out of it, which is the one thing on this form nobody can be
 * asked to guess at.
 */
const VERTICAL_LABEL_KEYS: Record<TcrVertical, MessageKey> = {
  PROFESSIONAL: "onboarding.verticalProfessional",
  CONSTRUCTION: "onboarding.verticalConstruction",
  AGRICULTURE: "onboarding.verticalAgriculture",
  RETAIL: "onboarding.verticalRetail",
  HOSPITALITY: "onboarding.verticalHospitality",
  REAL_ESTATE: "onboarding.verticalRealEstate",
  HEALTHCARE: "onboarding.verticalHealthcare",
  TRANSPORTATION: "onboarding.verticalTransportation",
  EDUCATION: "onboarding.verticalEducation",
  FINANCIAL: "onboarding.verticalFinancial",
  INSURANCE: "onboarding.verticalInsurance",
  LEGAL: "onboarding.verticalLegal",
  TECHNOLOGY: "onboarding.verticalTechnology",
  MANUFACTURING: "onboarding.verticalManufacturing",
  ENERGY: "onboarding.verticalEnergy",
  COMMUNICATION: "onboarding.verticalCommunication",
  ENTERTAINMENT: "onboarding.verticalEntertainment",
  HUMAN_RESOURCES: "onboarding.verticalHumanResources",
  POSTAL: "onboarding.verticalPostal",
  NGO: "onboarding.verticalNgo",
  GOVERNMENT: "onboarding.verticalGovernment",
  POLITICAL: "onboarding.verticalPolitical",
  GAMBLING: "onboarding.verticalGambling",
};

export function verticalLabel(
  vertical: TcrVertical,
  t: Translate = EN,
): string {
  return t(VERTICAL_LABEL_KEYS[vertical]);
}

/** ICP-first ordering: the trades the buyer actually is, then the long tail. */
const VERTICAL_ORDER: readonly TcrVertical[] = [
  "PROFESSIONAL",
  "CONSTRUCTION",
  "AGRICULTURE",
  "RETAIL",
  "HOSPITALITY",
  "REAL_ESTATE",
  "HEALTHCARE",
  "TRANSPORTATION",
  "EDUCATION",
  "FINANCIAL",
  "INSURANCE",
  "LEGAL",
  "TECHNOLOGY",
  "MANUFACTURING",
  "ENERGY",
  "COMMUNICATION",
  "ENTERTAINMENT",
  "HUMAN_RESOURCES",
  "POSTAL",
  "NGO",
  "GOVERNMENT",
  "POLITICAL",
  "GAMBLING",
];

/**
 * The picker's options, in the reader's language.
 *
 * A function rather than the module-level constant this replaces: a constant
 * is built once, before any locale is known, so it would have pinned whichever
 * language happened to load the module first for everybody after.
 */
export function verticalOptions(
  t: Translate = EN,
): { value: TcrVertical; label: string }[] {
  return VERTICAL_ORDER.map((value) => ({
    value,
    label: verticalLabel(value, t),
  }));
}
