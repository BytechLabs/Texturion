export {
  CAPABILITIES,
  MEMBER_ROLES,
  capabilitiesOf,
  roleHasCapability,
  roleSatisfiesRank,
  type Capability,
  type MemberRole,
} from "./capabilities";

export {
  canSeeSettingsSection,
  settingsSectionCapability,
  visibleSettingsSections,
  type SettingsSectionId,
} from "./settings-visibility";

export {
  extraNumberBlockedReason,
  canBuyExtraNumber,
  STARTER_MAX_TOTAL_NUMBERS,
  type ExtraNumberEligibility,
  type ExtraNumberPlan,
  type NumberCountry,
} from "./extra-numbers";

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
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TTL_MS,
  TYPING_THROTTLE_MS,
  TYPING_TTL_MS,
  presenceFor,
  presenceLabel,
  type PresenceEntry,
  type Viewer,
} from "./presence";

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

// #293 — when "later" is. One ladder of presets, resolved in the device's own
// clock (#292), so a snooze set on a phone means the same instant as the same
// tap on a laptop.
export {
  daysUntilNextMonday,
  FOLLOW_UP_PRESET_LABELS,
  followUpPresets,
  isSnoozeTargetValid,
  SNOOZE_AFTERNOON_HOUR,
  SNOOZE_EVENING_HOUR,
  SNOOZE_MAX_DAYS,
  SNOOZE_MIN_LEAD_MS,
  SNOOZE_NOTE_MAX,
  SNOOZE_MORNING_HOUR,
  SNOOZE_PRESET_LABELS,
  snoozePresets,
  snoozeReturnShape,
} from "./snooze";
export type {
  DeferralKind,
  FollowUpPreset,
  FollowUpPresetId,
  SnoozePreset,
  SnoozePresetId,
  SnoozeReturnShape,
} from "./snooze";

export {
  MAX_DIALER_MATCHES,
  MIN_NAME_DIGITS,
  MIN_NUMBER_DIGITS,
  bestDialerMatch,
  nationalDigits,
  rankDialerCandidates,
  scoreDialerCandidate,
  t9Words,
} from "./dialer";
export type { DialerCandidate, DialerMatch, DialerSource } from "./dialer";

export {
  MAX_DEVICE_CONTACT_ROWS,
  MIN_DEVICE_QUERY,
  deviceContactMatches,
  filterDeviceContacts,
} from "./device-contacts";
export type { DeviceContactPage, DeviceContactListRow } from "./device-contacts";

export {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REWARDS_PER_YEAR,
  decideReferral,
  isReferralCode,
  mintReferralCode,
  normalizeReferralCode,
  referralStage,
} from "./referrals";
export type {
  ReferralClaim,
  ReferralDecision,
  ReferralRefusal,
  ReferralStage,
} from "./referrals";

export {
  CREW_SIZE_BUCKETS,
  CREW_SIZE_LABELS,
  isBeyondSupportedCrew,
  isCrewSizeBucket,
  planFitForCrew,
} from "./crew-size";
export type { CrewSizeBucket } from "./crew-size";
export {
  SAVED_VIEW_COUNT_CEILING,
  SAVED_VIEW_COUNT_MAX_VIEWS,
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEW_SURFACES,
  SAVED_VIEWS_PER_SURFACE,
  filtersToQuery,
  formatViewCount,
  isEmptyView,
  isSavedViewSurface,
  isValidViewName,
  resolveAssignee,
  sanitizeFilters,
  savedViewFilterKeys,
  viewNamesCollide,
} from "./saved-views";
export type { SavedViewFilters, SavedViewSurface } from "./saved-views";
export {
  PIPELINE_SEED_NAMES,
  PIPELINE_STAGES,
  isPipelineStage,
  pipelineDeleteWarning,
  pipelineInsight,
  pipelineWinRate,
} from "./pipeline";
export type { PipelineReport, PipelineStage } from "./pipeline";
