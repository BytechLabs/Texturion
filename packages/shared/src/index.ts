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
  handoverPromptCancelLabel,
  handoverPromptHeadline,
  handoverPromptIsUrgent,
  viewerHandoverPrompt,
  type HandoverPromptKind,
  type HandoverViewer,
} from "./handover";

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
  formatNanpNumber,
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
  hasServerOnlyTokens,
  mergeFieldsNeeded,
  SERVER_ONLY_TOKENS,
  SERVER_ONLY_TOKENS_NOTE,
  MERGE_FIELD_SAMPLES,
  MERGE_FIELD_TOKENS,
  MERGE_FIELD_VARIABLES,
  type MergeFieldToken,
  type MergeFieldVariable,
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
  SUPPORT_ERROR_LINES,
  SUPPORT_FIX_PROMISE,
  SUPPORT_RESPONSE_TIME,
  SUPPORT_TOPICS,
  feedbackMailto,
  supportBody,
  supportMailto,
  supportSituation,
  supportSubjectFor,
} from "./support";
export type { SupportContext, SupportTopic } from "./support";

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
  BATCH_WINDOW_CHOICES,
  CATEGORY_LABELS,
  DEFAULT_BATCH_WINDOW,
  DEFAULT_DELIVERY,
  DELIVERY_COPY,
  DELIVERY_MODES,
  NOTIFICATION_CATEGORIES,
  SUMMARY_TITLE,
  decideDelivery,
  digestLine,
  summaryLine,
} from "./notification-delivery";
export type {
  BatchWindowMinutes,
  DeliveryDecision,
  DeliveryMode,
  NotificationCategory,
} from "./notification-delivery";
export {
  QUIET_HOURS_COPY,
  QUIET_HOURS_DEFAULT,
  isMemberQuietNow,
  quietHoursLine,
} from "./member-quiet-hours";
export type { MemberQuietWindow } from "./member-quiet-hours";
export {
  ON_MY_WAY_COPY,
  ON_MY_WAY_PRESETS,
  onMyWayPresetLabel,
  onMyWayText,
} from "./on-my-way";
export type { OnMyWayPreset } from "./on-my-way";
export {
  CONTACT_FIELDS_CAP,
  CONTACT_FIELDS_COPY,
  CONTACT_FIELD_KINDS,
  CONTACT_FIELD_OPTIONS_CAP,
  CONTACT_FIELD_VALUE_MAX,
  contactFieldKey,
  contactFieldValueError,
} from "./contact-fields";
export type { ContactFieldDef, ContactFieldKind } from "./contact-fields";
export {
  ALERT_BANNER_COPY,
  alertTakenLine,
  ON_CALL_COPY,
  ON_CALL_EVENING_START_HOUR,
  ON_CALL_MORNING_END_HOUR,
  ON_CALL_PRESETS,
  onCallLine,
  onCallWindow,
} from "./on-call";
export type { OnCallPreset, OnCallWindow } from "./on-call";
export {
  SATISFACTION_ARC_MIN_DELTA,
  SATISFACTION_COPY,
  SATISFACTION_MIN_SAMPLE,
  SATISFACTION_POOR_AT_OR_BELOW,
  formatSatisfaction,
  poorRatingLine,
  satisfactionArcDirection,
} from "./satisfaction";
export {
  JOB_RATED_EVENT,
  RATING_ASK_BODY,
  RATING_ASK_DELAY_HOURS,
  RATING_ASK_HORIZON_HOURS,
  RATING_POOR_AT_OR_BELOW,
  isPoorRating,
  jobRatedLine,
  parseRatingReply,
} from "./job-ratings";
export {
  APPOINTMENT_CONFIRMED_EVENT,
  APPOINTMENT_CONFIRMED_LINE,
  APPOINTMENT_CONFIRM_KEYWORDS,
  CONFIRM_KEYWORDS_ALSO_CARRIER,
  DEFAULT_REMINDER_RULES,
  REMINDER_OFFSET_MAX_MINUTES,
  REMINDER_OFFSET_MIN_MINUTES,
  REMINDER_RULES_CAP,
  isAppointmentConfirmation,
  reminderOffsetLabel,
} from "./appointment-reminders";
export {
  SCHEDULED_BODY_MAX,
  SCHEDULED_HOLD_REASONS,
  SCHEDULED_HORIZON_DAYS,
  SCHEDULED_MESSAGE_STATUSES,
  SCHEDULED_PER_COMPANY_CAP,
  SCHEDULED_PER_THREAD_CAP,
  SCHEDULED_PRESET_HOUR,
  SCHEDULED_SEND_COPY,
  isScheduledMessageLive,
  schedulePresets,
  scheduledClockProvenance,
  scheduledReasonRecovers,
} from "./scheduled-send";
export type {
  ScheduledHoldReason,
  ScheduledMessageStatus,
  ScheduledSendCopyKey,
  SchedulePreset,
} from "./scheduled-send";
export {
  PIPELINE_SEED_NAMES,
  PIPELINE_STAGES,
  isPipelineStage,
  pipelineDeleteWarning,
  pipelineInsight,
  pipelineWinRate,
} from "./pipeline";
export type { PipelineReport, PipelineStage } from "./pipeline";
export {
  WHATS_NEW,
  hasUnseenWhatsNew,
  latestWhatsNewDate,
  unseenEntries,
} from "./whats-new";
export type { WhatsNewEntry } from "./whats-new";
export {
  TAG_SUGGEST_DISTANCE,
  TAGS_PER_WORKSPACE,
  editDistance,
  normalizeTagName,
  suggestExistingTag,
  tagNameDistance,
} from "./tag-similarity";
export type { TagLike, TagSuggestion } from "./tag-similarity";
export {
  CONTACT_RELATIONSHIP_CASES,
  CONTACT_REPEAT_BADGE_CASES,
  REPEAT_CUSTOMER_MINIMUM,
  contactRelationshipLine,
  contactRepeatBadge,
  monthYear,
} from "./contact-relationship";
export {
  ATTRIBUTION_PARAMS,
  ATTRIBUTION_PATH_MAX,
  ATTRIBUTION_VALUE_MAX,
  attributionParams,
  isMeaningfulTouch,
  referrerHost,
  sanitizeAttributionValue,
  sanitizeLandingPath,
} from "./attribution";
export type { AttributionParam, FirstTouch } from "./attribution";

// #328 — the currency a workspace is billed in, and the price book behind it.
export {
  ASSUMED_USD_PER_CAD,
  BILLING_CURRENCIES,
  billingCurrencyOf,
  currencyForCountry,
  DEFAULT_BILLING_CURRENCY,
  formatMoney,
  isBillingCurrency,
  MAX_FX_ABSORPTION,
  OVERAGE_CENTS_PER_SEGMENT,
  PLAN_PRICE_CENTS,
  planRevenueUsdCents,
  US_REGISTRATION_FEE_CENTS,
  VOICE_OVERAGE_CENTS_PER_MINUTE,
  type BillingCurrency,
} from "./billing-currency";

/**
 * #303 — signup screening for the categories `/legal/aup` §4 prohibits.
 * Returns suspicion, never a verdict: a business name is weak evidence and a
 * person decides.
 */
export {
  screenBusinessName,
  screeningSummary,
  type CategoryMatch,
  type ProhibitedCategory,
} from "./prohibited-categories";

/**
 * #286 — the sentence a member sees where a number they cannot access would
 * have been. One place, so all three clients say the same thing.
 */
export { hiddenNumbersNotice } from "./hidden-numbers-notice";

/**
 * #307 — per-number identity. One implementation of "the number's value if it
 * has one, else the workspace's", because a rule this small written five
 * times is how a caller meets two different names in one interaction.
 */
export {
  inheritedFields,
  resolveNumberIdentity,
  type CompanyIdentity,
  type NumberIdentity,
  type NumberOverrides,
  type Resolved,
} from "./number-identity";
