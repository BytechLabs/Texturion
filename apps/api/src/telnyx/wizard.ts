import { isUsCaDestination } from "@loonext/shared";
import { z } from "zod";

import type { Env } from "../env";

/**
 * The §4.4 wizard → Telnyx payload field mapping. The wizard stores brand and
 * campaign data in `messaging_registrations.data` under the CANONICAL Telnyx
 * payload keys (the billing track's checkout gate — billing/registration-draft
 * — checks completeness against these exact keys, so the two tracks must
 * agree byte-for-byte).
 *
 * PII policy (SPEC §10): the FULL EIN/BN is stored (business identifier,
 * required for brand submission at webhook time); SSN/SIN is last-4 only —
 * the sole-prop branch's `ein` field IS the last-4 identifier and is
 * validated to exactly 4 digits so a full SSN can never be persisted.
 */

/** TCR business verticals (SPEC §4.1 step 3: dropdown of TCR vertical values). */
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

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

/** Loose contact-phone shape (brand contact line, not an SMS destination). */
const contactPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9()\-. ]{10,20}$/, "must be a phone number");

/**
 * Optional website (G7: optional on every path). A blank string is treated as
 * absent (the web form omits it, but an empty string from any client coerces
 * to `undefined` rather than failing the URL check); when present it must be a
 * real URL ≤255 chars.
 */
const optionalWebsite = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.url().max(255).optional(),
);

const brandCommonShape = {
  /** Customer-facing brand display name (SPEC §4.4: `displayName`). */
  displayName: nonEmpty(255),
  /** Brand contact email + phone (required by the Telnyx brand payload). */
  email: z.email().max(320),
  phone: contactPhone,
  vertical: z.enum(TCR_VERTICALS).default("PROFESSIONAL"),
  street: nonEmpty(255),
  city: nonEmpty(100),
  state: nonEmpty(20),
  postalCode: nonEmpty(10),
  country: z.enum(["US", "CA"]),
};

/**
 * Standard path: legal business name + full EIN (US) / BN (CA). Website is
 * optional on every path (G7). `strictObject` makes the EIN-vs-sole-prop branch
 * a real XOR: sole-prop keys on a standard payload (or vice versa) are a
 * validation error, never silently dropped.
 */
export const standardBrandSchema = z.strictObject({
  ...brandCommonShape,
  companyName: nonEmpty(255),
  ein: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z][0-9A-Za-z-]{7,14}$/, "must be an EIN or BN"),
  website: optionalWebsite,
});

/**
 * Sole Proprietor path (SPEC §4.2, D2): first/last name, last-4 SSN (US) /
 * SIN (CA) — carried in `ein` per the §4.4 mapping — and the mobile number
 * that receives the OTP (must be a real US/CA destination).
 */
export const soleProprietorBrandSchema = z.strictObject({
  ...brandCommonShape,
  firstName: nonEmpty(100),
  lastName: nonEmpty(100),
  ein: z.string().trim().regex(/^\d{4}$/, "must be the last 4 digits"),
  mobilePhone: z
    .string()
    .trim()
    .refine(isUsCaDestination, "must be a US or Canadian mobile number (+1...)"),
  website: optionalWebsite,
});

export const brandDraftSchema = z.union([
  standardBrandSchema,
  soleProprietorBrandSchema,
]);

export type BrandDraft = z.infer<typeof brandDraftSchema>;

export function isSoleProprietorDraft(
  draft: BrandDraft,
): draft is z.infer<typeof soleProprietorBrandSchema> {
  return "firstName" in draft;
}

/**
 * Campaign wizard fields (SPEC §4.1 step 3, §4.4 mapping): the opt-in flow
 * description and two sample messages. Minimum lengths follow TCR's own
 * floors (messageFlow ≥ 40 chars, samples ≥ 20) so a draft that passes here
 * is submittable; the wizard pre-fills compliant defaults.
 */
export const campaignDraftSchema = z.strictObject({
  messageFlow: z.string().trim().min(40).max(2048),
  sample1: z.string().trim().min(20).max(1024),
  sample2: z.string().trim().min(20).max(1024),
});

export type CampaignDraft = z.infer<typeof campaignDraftSchema>;

/** The single Telnyx webhook URL (SPEC §4.3 S1, §4.4 contract table). */
export function telnyxWebhookUrl(env: Env): string {
  return `${env.API_ORIGIN.replace(/\/+$/, "")}/webhooks/telnyx`;
}

/**
 * Build the `POST /v2/10dlc/brand` payload from a validated draft (§4.4
 * field-mapping table). Standard path → `entityType='PRIVATE_PROFIT'`,
 * sole-prop → `entityType='SOLE_PROPRIETOR'` with `mobilePhone` as the OTP
 * target. Both carry webhookURL/webhookFailoverURL = the single Telnyx route.
 */
export function buildBrandPayload(
  env: Env,
  draft: BrandDraft,
): Record<string, unknown> {
  const webhook = telnyxWebhookUrl(env);
  const common = {
    displayName: draft.displayName,
    ein: draft.ein,
    phone: draft.phone,
    street: draft.street,
    city: draft.city,
    state: draft.state,
    postalCode: draft.postalCode,
    country: draft.country,
    email: draft.email,
    vertical: draft.vertical,
    ...(draft.website ? { website: draft.website } : {}),
    webhookURL: webhook,
    webhookFailoverURL: webhook,
  };
  if (isSoleProprietorDraft(draft)) {
    return {
      entityType: "SOLE_PROPRIETOR",
      firstName: draft.firstName,
      lastName: draft.lastName,
      mobilePhone: draft.mobilePhone,
      ...common,
    };
  }
  return {
    entityType: "PRIVATE_PROFIT",
    companyName: draft.companyName,
    ...common,
  };
}

/**
 * Representative Google review deep link declared in the campaign's sample
 * content (FEATURE-GAPS Step 0c). Legacy declared 10DLC content: the Reviews
 * feature is gone (DECISIONS D32) — nothing in the product merges a review
 * link into messages anymore. Deliberately kept so already-approved campaigns
 * never need re-vetting; owners who still send review asks paste their link
 * by hand, and this keeps that traffic declared.
 */
export const REVIEW_SAMPLE_LINK =
  "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";

/**
 * Hard cap on every `sampleN` in Telnyx's campaign UPDATE schema:
 * `UpdateCampaignRequest.sample1..sample5` are `maxLength: 255` — stricter
 * than the create path, whose samples the wizard allows up to 1024 chars.
 * Anything longer 422s the `PUT /v2/10dlc/campaign/{campaignId}` forever.
 */
export const TCR_UPDATE_SAMPLE_MAX_LENGTH = 255;

/**
 * The registered review-ask sample message (sample3, Step 0c): brand name in
 * the body + the review deep-link domain visible. Legacy declared 10DLC
 * campaign content (the Reviews feature was removed — DECISIONS D32),
 * deliberately kept so approved campaigns don't go back through vetting:
 * over-declaring content is harmless, and owners who ask for reviews now
 * paste their link into an ordinary message, so the number can still emit
 * review-URL traffic this sample keeps declared.
 *
 * Guaranteed ≤ {@link TCR_UPDATE_SAMPLE_MAX_LENGTH} (255) chars total — the
 * business name is truncated so the fixed copy + link always fit — because
 * this sample rides both the create payload AND the 255-capped campaign
 * UPDATE schema (see {@link buildCampaignContentUpdate}).
 */
export function buildReviewSample(businessName: string): string {
  const prefix = "Thanks for choosing ";
  const suffix = `! A quick Google review means a lot: ${REVIEW_SAMPLE_LINK}`;
  const budget = TCR_UPDATE_SAMPLE_MAX_LENGTH - prefix.length - suffix.length;
  const name =
    businessName.length > budget
      ? businessName.slice(0, budget).trimEnd()
      : businessName;
  return `${prefix}${name}${suffix}`;
}

/**
 * The CREATE-time content block for `POST /v2/10dlc/campaignBuilder`
 * ({@link buildCampaignPayload}). `description` — like `embeddedLink` — is
 * CREATE-ONLY: Telnyx's campaign UPDATE schema (`UpdateCampaignRequest`)
 * does not accept it, so it can never be migrated onto an already-registered
 * campaign ({@link buildCampaignContentUpdate} is the update-safe subset).
 * The `description` is the fixed ICP boilerplate restating the AUP
 * commitments (§5) plus the Step 0c declaration of post-service review asks;
 * `sample3` is the generated review-ask sample.
 */
export function buildCampaignContent(options: {
  campaign: CampaignDraft;
  /** Business display name (brand `displayName`) for the review sample. */
  businessName: string;
}): Record<string, unknown> {
  return {
    description:
      "Conversational two-way customer service SMS for a home-service business. " +
      "Customers text the business's number first, or ask the business in person " +
      "or by phone to text them. Includes one-time post-service review requests " +
      "with an embedded Google review link (search.google.com). No marketing " +
      "blasts, no purchased lists, no SHAFT content.",
    messageFlow: options.campaign.messageFlow,
    sample1: options.campaign.sample1,
    sample2: options.campaign.sample2,
    sample3: buildReviewSample(options.businessName),
  };
}

/**
 * The UPDATE-safe content block for `PUT /v2/10dlc/campaign/{campaignId}`
 * (the Step 0c migration of already-registered campaigns). Telnyx's
 * `UpdateCampaignRequest` schema accepts only resellerId / sample1..sample5
 * (maxLength 255 each) / messageFlow / helpMessage / autoRenewal / webhook
 * URLs — and Telnyx documents that only the sample messages are actually
 * editable after registration — so this sends ONLY the samples.
 * `description` and `embeddedLink` are create-only and cannot be migrated:
 * a legacy campaign's sole enforceable declaration of the review ask is the
 * sample3 review sample. Wizard samples may be up to 1024 chars (the create
 * limit), so sample1/sample2 are truncated to the update schema's 255-char
 * cap; sample3 is ≤255 by construction ({@link buildReviewSample}).
 */
export function buildCampaignContentUpdate(options: {
  campaign: CampaignDraft;
  /** Business display name (brand `displayName`) for the review sample. */
  businessName: string;
}): Record<string, unknown> {
  const clamp = (sample: string) =>
    sample.slice(0, TCR_UPDATE_SAMPLE_MAX_LENGTH);
  return {
    sample1: clamp(options.campaign.sample1),
    sample2: clamp(options.campaign.sample2),
    sample3: buildReviewSample(options.businessName),
  };
}

/**
 * Build the `POST /v2/10dlc/campaignBuilder` payload (§4.4 mapping):
 * LOW_VOLUME (SOLE_PROPRIETOR on the sole-prop path), the wizard's opt-in
 * flow description and samples, and the fixed §5-matching keyword/boolean
 * block. The content fields come from {@link buildCampaignContent};
 * `helpMessage` is the exact §4.4 template. `embeddedLink` is TRUE
 * (FEATURE-GAPS Step 0c): the review ask emits a Google review URL, and an
 * embedded link the campaign never declared is a carrier-filtering trigger.
 */
export function buildCampaignPayload(
  env: Env,
  options: {
    brandId: string;
    soleProprietor: boolean;
    campaign: CampaignDraft;
    /** Business display name + brand contact phone (for helpMessage). */
    businessName: string;
    brandContactPhone: string;
  },
): Record<string, unknown> {
  const webhook = telnyxWebhookUrl(env);
  return {
    brandId: options.brandId,
    usecase: options.soleProprietor ? "SOLE_PROPRIETOR" : "LOW_VOLUME",
    autoRenewal: true,
    ...buildCampaignContent({
      campaign: options.campaign,
      businessName: options.businessName,
    }),
    optinKeywords: "START",
    optoutKeywords: "STOP",
    helpKeywords: "HELP",
    helpMessage: `${options.businessName}: reply STOP to opt out. Contact us at ${options.brandContactPhone}.`,
    embeddedLink: true,
    numberPool: false,
    ageGated: false,
    webhookURL: webhook,
    webhookFailoverURL: webhook,
  };
}
