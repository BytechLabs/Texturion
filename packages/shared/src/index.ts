export {
  registrationStage,
  registrationProgress,
  isWaitingOnRegistration,
  type RegistrationStage,
  type RegistrationProgress,
  type RegistrationSnapshot,
  type RegistrationSnapshotRow,
} from "./registration-progress";

export {
  classifySendFailure,
  failureReasonOf,
  isCarrierFailureReason,
  isRetryableFailure,
  type CarrierFailureReason,
} from "./carrier-failure";

export {
  versionKey,
  isOlderThan,
  updateRequirement,
  type AppReleasePolicy,
  type UpdateRequirement,
} from "./app-version";

export {
  ERROR_CODES,
  ERROR_CODE_STATUS,
  INTERNAL_ERROR_CODE,
  INTERNAL_ERROR_STATUS,
  type ApiErrorCode,
  type ErrorCode,
  type ErrorEnvelope,
} from "./error-codes";

export {
  NANP_AREA_CODES,
  lookupAreaCode,
  isUsCaDestination,
  destinationLocalHour,
  localHourInZone,
  NANP_TIMEZONES,
  type NanpCountry,
  type NanpEntry,
  type NanpGeographicEntry,
  type NanpNonGeographicEntry,
} from "./nanp";

export {
  estimateSegments,
  GSM7_SINGLE_SEGMENT_UNITS,
  GSM7_CONCAT_SEGMENT_UNITS,
  UCS2_SINGLE_SEGMENT_UNITS,
  UCS2_CONCAT_SEGMENT_UNITS,
  type SegmentEstimate,
  type SmsEncoding,
} from "./segments";

export {
  applyMergeFields,
  hasMergeFields,
  MERGE_FIELD_TOKENS,
  type MergeFieldToken,
  type MergeFieldValues,
} from "./merge-fields";

export {
  DEFAULT_MCTB_MESSAGE,
  effectiveMctbMessage,
  type EffectiveMctbMessage,
} from "./mctb";

export {
  ALLOWED_IMAGE_TYPES,
  attachmentAcceptList,
  isAllowedImageType,
} from "./attachment-types";

export {
  IDENTIFICATION_SUFFIX_TEMPLATE,
  appendIdentification,
  appendIdentificationSuffix,
  identificationSuffix,
  pendingIdentificationSuffix,
  shouldIdentify,
} from "./first-message-identification";

export {
  MMS_OUTBOUND_MEDIA_TYPES,
  MMS_MAX_MEDIA_BYTES,
  MMS_MAX_MEDIA_ITEMS,
  MMS_TYPE_ALIASES,
  canonicalMmsType,
  isMmsMediaType,
  mmsMediaTypeForFile,
  mmsMediaKind,
  type MmsMediaType,
  type MmsMediaKind,
} from "./mms";

export {
  WEEKDAYS,
  parseHhmm,
  isValidBusinessHours,
  companyLocalMoment,
  formatZonedStamp,
  isAfterHours,
  type Weekday,
  type DayHours,
  type BusinessHours,
  // #402: date exceptions over the weekly loop — Christmas is not a working
  // Thursday, and only the owner can say which dates are which.
  closureReason,
  companyLocalDate,
  exceptionFor,
  isValidHoursExceptions,
  type HoursException,
} from "./business-hours";

export {
  TEN_DLC_CEILINGS,
  TEN_DLC_CEILINGS_VERIFIED_ON,
  TEN_DLC_CEILINGS_RECHECK_AFTER,
  CARRIER_CEILING_WARN_FRACTION,
  dailyCeiling,
  approachingCarrierCeiling,
  type TenDlcUseCase,
  type TierCeiling,
  type CarrierCeiling,
} from "./carrier-throughput";

// #408: the check that stops two techs answering the same customer thirty
// seconds apart. Pure, so web and the API agree, and hand-ported to Kotlin and
// Swift — a warning that exists only on web protects nobody in a truck.
export {
  duplicateReplyPrompt,
  duplicateReplyWarning,
  type DuplicateReplyInput,
  type DuplicateReplyWarning,
} from "./duplicate-reply";

export {
  PLAN_SEATS,
  seatLimit,
  canUpgradeSeats,
  seatUsage,
  type SeatPlan,
  type SeatUsage,
} from "./seats";

export {
  AI_DISCLOSURES,
  AI_INFERENCE_LOCATION_RECHECK_AFTER,
  AI_INFERENCE_LOCATION_SOURCE,
  AI_INFERENCE_LOCATION_STATEMENT,
  AI_INFERENCE_LOCATION_VERIFIED_ON,
  AI_INFERENCE_RETENTION_STATEMENT,
  AI_TRAINING_STATEMENT,
  AI_VENDOR_NAMES,
  aiModelsByVendor,
  type AiDisclosure,
} from "./ai-disclosure";

export {
  DELETION_GAPS,
  DELETION_GRACE_DAYS,
} from "./deletion-promises";

export {
  numberAccessIsRestricted,
  numberAccessLevelLabel,
  numberAccessReason,
  sortNumberAccessExplanations,
  type NumberAccessDecidedBy,
  type NumberAccessExplanation,
  type NumberAccessLevel,
} from "./number-access-explained";

export {
  hasVoicemailIntake,
  voicemailIntakeLines,
  VOICEMAIL_INTAKE_SOURCE_LABEL,
  type VoicemailIntake,
  type VoicemailIntakeLine,
} from "./voicemail-intake";

/**
 * #312: the legal entity and mailing address, read by BOTH the marketing site's
 * identity surfaces and the Worker that has to print an address in a commercial
 * email footer. One fact, one place, so the two cannot disagree.
 */
export {
  LEGAL_ENTITY_NAME,
  MAILING_ADDRESS,
  hasBusinessIdentity,
} from "./business-identity";

export {
  LEAD_CHASE_WIDEN_MINUTES,
  LEAD_CHASE_RUNGS,
  leadChaseNotification,
  type LeadChaseRung,
} from "./lead-chase";

export {
  detectContactColumns,
  normalizeContactHeader,
  type ContactImportField,
  type ContactImportMapping,
} from "./contact-import-headers";

export {
  CARRIER_OPT_OUT_ERROR_CODE,
  GENERIC_SEND_FAILURE,
  sendFailureMessage,
} from "./send-failures";

export {
  CARRIER_REPLY_KEYWORDS,
  DEFAULT_EMERGENCY_MESSAGE,
  EMERGENCY_KEYWORDS,
  EMERGENCY_SAFETY_LINE,
  awayEmergencyNotice,
  effectiveEmergencyKeywords,
  effectiveEmergencyMessage,
  emergencyKeywordError,
  emergencyReplyBody,
  emergencyWordList,
  isEmergencyKeyword,
  isValidEmergencyKeyword,
  mentionsEmergencyKeyword,
  unrecognizedReplyKeyword,
} from "./emergency";
export type {
  AwayEmergencyNotice,
  EffectiveEmergencyMessage,
} from "./emergency";

export {
  DEFAULT_AWAY_MESSAGE,
  effectiveAwayMessage,
} from "./away";
export type { EffectiveAwayMessage } from "./away";

export {
  SUPPORT_EMAIL,
  supportBody,
  supportMailto,
} from "./support";
export type { SupportContext } from "./support";

export { looksLikeOptOut } from "./opt-out-language";

// #239 — how a response time reads. One phrasing for four surfaces.
export {
  formatResponseTime,
  responseArcDirection,
  RESPONSE_ARC_MIN_SECONDS,
} from "./response-time";

// #352 — a carrier rejection, in words the customer can act on. One catalogue
// for registration and porting, because #352 asked for exactly that rather
// than two inventions of the same idea.
export {
  explainRejection,
  needsHumanHelp,
  REJECTIONS_BEFORE_HELP,
  RESUBMISSION_WAIT,
} from "./rejection-guidance";
export type { RejectionDomain, RejectionGuidance } from "./rejection-guidance";
