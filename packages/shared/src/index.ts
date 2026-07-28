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
} from "./business-hours";

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
  EMERGENCY_KEYWORDS,
  awayEmergencyNotice,
  isEmergencyKeyword,
  mentionsEmergencyKeyword,
  unrecognizedReplyKeyword,
} from "./emergency";
export type { AwayEmergencyNotice } from "./emergency";

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
