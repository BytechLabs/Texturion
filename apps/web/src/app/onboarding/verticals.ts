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

export const VERTICAL_LABELS: Record<TcrVertical, string> = {
  PROFESSIONAL: "Professional & home services",
  CONSTRUCTION: "Construction & trades",
  AGRICULTURE: "Agriculture & landscaping",
  RETAIL: "Retail",
  HOSPITALITY: "Hospitality, food & travel",
  REAL_ESTATE: "Real estate & property",
  HEALTHCARE: "Healthcare & wellness",
  TRANSPORTATION: "Transportation & moving",
  EDUCATION: "Education",
  FINANCIAL: "Financial services",
  INSURANCE: "Insurance",
  LEGAL: "Legal",
  TECHNOLOGY: "Technology",
  MANUFACTURING: "Manufacturing",
  ENERGY: "Energy & utilities",
  COMMUNICATION: "Communications & media",
  ENTERTAINMENT: "Entertainment & events",
  HUMAN_RESOURCES: "Staffing & HR",
  POSTAL: "Postal & delivery",
  NGO: "Nonprofit",
  GOVERNMENT: "Government",
  POLITICAL: "Political",
  GAMBLING: "Gambling",
};

/** ICP-first ordering: the trades the buyer actually is, then the long tail. */
export const VERTICAL_OPTIONS: { value: TcrVertical; label: string }[] = [
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
].map((value) => ({
  value: value as TcrVertical,
  label: VERTICAL_LABELS[value as TcrVertical],
}));
