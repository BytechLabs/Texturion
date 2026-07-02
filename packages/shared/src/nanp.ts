/**
 * NANP area-code table + destination helpers (SPEC §3, §5, §10; D4, D8).
 *
 * Compiled from NANPA's public NPA assignment report:
 *   https://reports.nanpa.com/public/npa_report.csv (file date 07/01/2026)
 * Inclusion rule: every NPA the report lists as IN_SERVICE = 'Y' with
 * COUNTRY = 'US' or 'CANADA' — geographic codes (USE = 'G') and the
 * US/Canada-assigned non-geographic codes (USE = 'N': 5XX personal
 * communications, 710 US Government, Canadian 600/622/633).
 *
 * Deliberately ABSENT from this table:
 * - Caribbean NANP codes (Bahamas 242, Jamaica 876, Dominican Republic 809,
 *   …): +1 numbers billed at international rates — the classic SMS-pumping
 *   destination (SPEC §10). Absence from this table IS the destination check.
 * - NANP-wide shared service codes that NANPA assigns to no single country
 *   (toll-free 800/833/844/855/866/877/888, premium 900, 500/533/544/…, 700):
 *   not a US/CA geographic destination, so they fail the check too.
 * - Unassigned / not-in-service codes.
 *
 * Region is the USPS state code (US, incl. DC + territories PR/VI/GU/MP/AS)
 * or the Canada Post province code (CA). Timezone is the primary IANA zone
 * for the area code; where an area code spans zones the dominant zone was
 * chosen and the entry carries a comment recording the choice (NANPA's own
 * TIME_ZONE column flags every spanning NPA). Quebec entries use
 * America/Toronto — the canonical IANA zone for Canadian Eastern Time
 * (America/Montreal is an alias of it). Overlay codes share their parent's
 * region/timezone.
 *
 * Non-geographic codes have no state/province or local clock, so their
 * `region`/`timezone` are null (`geographic` discriminates); they still
 * count as US/CA destinations for {@link isUsCaDestination}.
 */

export type NanpCountry = "US" | "CA";

export interface NanpGeographicEntry {
  readonly country: NanpCountry;
  readonly geographic: true;
  /** USPS state code (US) or Canada Post province code (CA). */
  readonly region: string;
  /** Primary IANA timezone for the area code. */
  readonly timezone: string;
}

export interface NanpNonGeographicEntry {
  readonly country: NanpCountry;
  readonly geographic: false;
  readonly region: null;
  readonly timezone: null;
}

export type NanpEntry = NanpGeographicEntry | NanpNonGeographicEntry;

/** Every currently-assigned, in-service US/Canada NANP area code. */
export const NANP_AREA_CODES: Readonly<Record<string, NanpEntry>> = {
  "201": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "202": { country: "US", geographic: true, region: "DC", timezone: "America/New_York" },
  "203": { country: "US", geographic: true, region: "CT", timezone: "America/New_York" },
  "204": { country: "CA", geographic: true, region: "MB", timezone: "America/Winnipeg" },
  "205": { country: "US", geographic: true, region: "AL", timezone: "America/Chicago" },
  "206": { country: "US", geographic: true, region: "WA", timezone: "America/Los_Angeles" },
  "207": { country: "US", geographic: true, region: "ME", timezone: "America/New_York" },
  "208": { country: "US", geographic: true, region: "ID", timezone: "America/Boise" }, // spans Mountain/Pacific (NANPA: MP); Mountain (Boise) dominant — northern panhandle is Pacific
  "209": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "210": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "212": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "213": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "214": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "215": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "216": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "217": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "218": { country: "US", geographic: true, region: "MN", timezone: "America/Chicago" },
  "219": { country: "US", geographic: true, region: "IN", timezone: "America/Chicago" }, // spans Central/Eastern (NANPA: EC); Central (NW Indiana, Chicago metro) dominant
  "220": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "223": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "224": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "225": { country: "US", geographic: true, region: "LA", timezone: "America/Chicago" },
  "226": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "227": { country: "US", geographic: true, region: "MD", timezone: "America/New_York" },
  "228": { country: "US", geographic: true, region: "MS", timezone: "America/Chicago" },
  "229": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "231": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "234": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "235": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "236": { country: "CA", geographic: true, region: "BC", timezone: "America/Vancouver" },
  "239": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "240": { country: "US", geographic: true, region: "MD", timezone: "America/New_York" },
  "248": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "249": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "250": { country: "CA", geographic: true, region: "BC", timezone: "America/Vancouver" },
  "251": { country: "US", geographic: true, region: "AL", timezone: "America/Chicago" },
  "252": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "253": { country: "US", geographic: true, region: "WA", timezone: "America/Los_Angeles" },
  "254": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "256": { country: "US", geographic: true, region: "AL", timezone: "America/Chicago" },
  "257": { country: "CA", geographic: true, region: "BC", timezone: "America/Vancouver" },
  "260": { country: "US", geographic: true, region: "IN", timezone: "America/Indiana/Indianapolis" },
  "262": { country: "US", geographic: true, region: "WI", timezone: "America/Chicago" },
  "263": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "267": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "269": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "270": { country: "US", geographic: true, region: "KY", timezone: "America/Chicago" }, // spans Central/Eastern (NANPA: EC); Central (Bowling Green, Owensboro, Paducah) dominant
  "272": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "274": { country: "US", geographic: true, region: "WI", timezone: "America/Chicago" },
  "276": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "279": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "281": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "283": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "289": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "301": { country: "US", geographic: true, region: "MD", timezone: "America/New_York" },
  "302": { country: "US", geographic: true, region: "DE", timezone: "America/New_York" },
  "303": { country: "US", geographic: true, region: "CO", timezone: "America/Denver" },
  "304": { country: "US", geographic: true, region: "WV", timezone: "America/New_York" },
  "305": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "306": { country: "CA", geographic: true, region: "SK", timezone: "America/Regina" },
  "307": { country: "US", geographic: true, region: "WY", timezone: "America/Denver" },
  "308": { country: "US", geographic: true, region: "NE", timezone: "America/Chicago" }, // spans Central/Mountain (NANPA: CM); Central dominant — western panhandle is Mountain
  "309": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "310": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "312": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "313": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "314": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "315": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "316": { country: "US", geographic: true, region: "KS", timezone: "America/Chicago" },
  "317": { country: "US", geographic: true, region: "IN", timezone: "America/Indiana/Indianapolis" },
  "318": { country: "US", geographic: true, region: "LA", timezone: "America/Chicago" },
  "319": { country: "US", geographic: true, region: "IA", timezone: "America/Chicago" },
  "320": { country: "US", geographic: true, region: "MN", timezone: "America/Chicago" },
  "321": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "323": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "324": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "325": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "326": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "327": { country: "US", geographic: true, region: "AR", timezone: "America/Chicago" },
  "329": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "330": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "331": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "332": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "334": { country: "US", geographic: true, region: "AL", timezone: "America/Chicago" },
  "336": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "337": { country: "US", geographic: true, region: "LA", timezone: "America/Chicago" },
  "339": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "340": { country: "US", geographic: true, region: "VI", timezone: "America/Puerto_Rico" },
  "341": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "343": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "346": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "347": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "350": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "351": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "352": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "353": { country: "US", geographic: true, region: "WI", timezone: "America/Chicago" },
  "354": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "357": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "360": { country: "US", geographic: true, region: "WA", timezone: "America/Los_Angeles" },
  "361": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "363": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "364": { country: "US", geographic: true, region: "KY", timezone: "America/Chicago" }, // overlay of 270 — shares its Central choice
  "365": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "367": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "368": { country: "CA", geographic: true, region: "AB", timezone: "America/Edmonton" },
  "369": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "380": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "382": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "385": { country: "US", geographic: true, region: "UT", timezone: "America/Denver" },
  "386": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "401": { country: "US", geographic: true, region: "RI", timezone: "America/New_York" },
  "402": { country: "US", geographic: true, region: "NE", timezone: "America/Chicago" },
  "403": { country: "CA", geographic: true, region: "AB", timezone: "America/Edmonton" },
  "404": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "405": { country: "US", geographic: true, region: "OK", timezone: "America/Chicago" },
  "406": { country: "US", geographic: true, region: "MT", timezone: "America/Denver" },
  "407": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "408": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "409": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "410": { country: "US", geographic: true, region: "MD", timezone: "America/New_York" },
  "412": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "413": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "414": { country: "US", geographic: true, region: "WI", timezone: "America/Chicago" },
  "415": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "416": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "417": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "418": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "419": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "423": { country: "US", geographic: true, region: "TN", timezone: "America/New_York" }, // spans Eastern/Central (NANPA: EC); Eastern (Chattanooga, Tri-Cities) dominant
  "424": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "425": { country: "US", geographic: true, region: "WA", timezone: "America/Los_Angeles" },
  "428": { country: "CA", geographic: true, region: "NB", timezone: "America/Moncton" },
  "430": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "431": { country: "CA", geographic: true, region: "MB", timezone: "America/Winnipeg" },
  "432": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "434": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "435": { country: "US", geographic: true, region: "UT", timezone: "America/Denver" },
  "436": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "437": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "438": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "440": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "442": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "443": { country: "US", geographic: true, region: "MD", timezone: "America/New_York" },
  "445": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "447": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "448": { country: "US", geographic: true, region: "FL", timezone: "America/Chicago" }, // overlay of 850 — shares its Central choice
  "450": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "457": { country: "US", geographic: true, region: "LA", timezone: "America/Chicago" },
  "458": { country: "US", geographic: true, region: "OR", timezone: "America/Los_Angeles" }, // overlay of 541 — shares its Pacific choice
  "463": { country: "US", geographic: true, region: "IN", timezone: "America/Indiana/Indianapolis" },
  "464": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "465": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "468": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "469": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "470": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "471": { country: "US", geographic: true, region: "MS", timezone: "America/Chicago" },
  "472": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "474": { country: "CA", geographic: true, region: "SK", timezone: "America/Regina" },
  "475": { country: "US", geographic: true, region: "CT", timezone: "America/New_York" },
  "478": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "479": { country: "US", geographic: true, region: "AR", timezone: "America/Chicago" },
  "480": { country: "US", geographic: true, region: "AZ", timezone: "America/Phoenix" },
  "483": { country: "US", geographic: true, region: "AL", timezone: "America/Chicago" },
  "484": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "501": { country: "US", geographic: true, region: "AR", timezone: "America/Chicago" },
  "502": { country: "US", geographic: true, region: "KY", timezone: "America/New_York" },
  "503": { country: "US", geographic: true, region: "OR", timezone: "America/Los_Angeles" },
  "504": { country: "US", geographic: true, region: "LA", timezone: "America/Chicago" },
  "505": { country: "US", geographic: true, region: "NM", timezone: "America/Denver" },
  "506": { country: "CA", geographic: true, region: "NB", timezone: "America/Moncton" },
  "507": { country: "US", geographic: true, region: "MN", timezone: "America/Chicago" },
  "508": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "509": { country: "US", geographic: true, region: "WA", timezone: "America/Los_Angeles" },
  "510": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "512": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "513": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "514": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "515": { country: "US", geographic: true, region: "IA", timezone: "America/Chicago" },
  "516": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "517": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "518": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "519": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "520": { country: "US", geographic: true, region: "AZ", timezone: "America/Phoenix" },
  "521": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "523": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "524": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "525": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "526": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "527": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "528": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "529": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "530": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "531": { country: "US", geographic: true, region: "NE", timezone: "America/Chicago" },
  "532": { country: "US", geographic: false, region: null, timezone: null }, // Non-Geographic Services (no geographic region)
  "534": { country: "US", geographic: true, region: "WI", timezone: "America/Chicago" },
  "539": { country: "US", geographic: true, region: "OK", timezone: "America/Chicago" },
  "540": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "541": { country: "US", geographic: true, region: "OR", timezone: "America/Los_Angeles" }, // spans Pacific/Mountain (NANPA: MP); Pacific dominant — Malheur County is Mountain
  "548": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "551": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "557": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "559": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "561": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "562": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "563": { country: "US", geographic: true, region: "IA", timezone: "America/Chicago" },
  "564": { country: "US", geographic: true, region: "WA", timezone: "America/Los_Angeles" },
  "567": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "570": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "571": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "572": { country: "US", geographic: true, region: "OK", timezone: "America/Chicago" },
  "573": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "574": { country: "US", geographic: true, region: "IN", timezone: "America/Indiana/Indianapolis" }, // spans Eastern/Central (NANPA: EC); Eastern (South Bend, Elkhart) dominant
  "575": { country: "US", geographic: true, region: "NM", timezone: "America/Denver" },
  "579": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "580": { country: "US", geographic: true, region: "OK", timezone: "America/Chicago" },
  "581": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "582": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "584": { country: "CA", geographic: true, region: "MB", timezone: "America/Winnipeg" },
  "585": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "586": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "587": { country: "CA", geographic: true, region: "AB", timezone: "America/Edmonton" },
  "600": { country: "CA", geographic: false, region: null, timezone: null }, // Canadian Non-Geographic Tariffed Services (no geographic region)
  "601": { country: "US", geographic: true, region: "MS", timezone: "America/Chicago" },
  "602": { country: "US", geographic: true, region: "AZ", timezone: "America/Phoenix" },
  "603": { country: "US", geographic: true, region: "NH", timezone: "America/New_York" },
  "604": { country: "CA", geographic: true, region: "BC", timezone: "America/Vancouver" },
  "605": { country: "US", geographic: true, region: "SD", timezone: "America/Chicago" }, // spans Central/Mountain (NANPA: CM); Central (Sioux Falls) dominant — Rapid City is Mountain
  "606": { country: "US", geographic: true, region: "KY", timezone: "America/New_York" }, // spans Eastern/Central (NANPA: EC); Eastern (eastern Kentucky) dominant
  "607": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "608": { country: "US", geographic: true, region: "WI", timezone: "America/Chicago" },
  "609": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "610": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "612": { country: "US", geographic: true, region: "MN", timezone: "America/Chicago" },
  "613": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "614": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "615": { country: "US", geographic: true, region: "TN", timezone: "America/Chicago" },
  "616": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "617": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "618": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "619": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "620": { country: "US", geographic: true, region: "KS", timezone: "America/Chicago" }, // spans Central/Mountain (NANPA: CM); Central dominant — small far-west Mountain sliver
  "621": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "622": { country: "CA", geographic: false, region: null, timezone: null }, // Canadian Non-Geographic Services (no geographic region)
  "623": { country: "US", geographic: true, region: "AZ", timezone: "America/Phoenix" },
  "624": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "626": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "628": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "629": { country: "US", geographic: true, region: "TN", timezone: "America/Chicago" },
  "630": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "631": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "633": { country: "CA", geographic: false, region: null, timezone: null }, // Non-geographic services (no geographic region)
  "636": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "639": { country: "CA", geographic: true, region: "SK", timezone: "America/Regina" },
  "640": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "641": { country: "US", geographic: true, region: "IA", timezone: "America/Chicago" },
  "645": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "646": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "647": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "650": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "651": { country: "US", geographic: true, region: "MN", timezone: "America/Chicago" },
  "656": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "657": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "659": { country: "US", geographic: true, region: "AL", timezone: "America/Chicago" },
  "660": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "661": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "662": { country: "US", geographic: true, region: "MS", timezone: "America/Chicago" },
  "667": { country: "US", geographic: true, region: "MD", timezone: "America/New_York" },
  "669": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "670": { country: "US", geographic: true, region: "MP", timezone: "Pacific/Saipan" },
  "671": { country: "US", geographic: true, region: "GU", timezone: "Pacific/Guam" },
  "672": { country: "CA", geographic: true, region: "BC", timezone: "America/Vancouver" },
  "678": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "679": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "680": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "681": { country: "US", geographic: true, region: "WV", timezone: "America/New_York" },
  "682": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "683": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "684": { country: "US", geographic: true, region: "AS", timezone: "Pacific/Pago_Pago" },
  "686": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "689": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "701": { country: "US", geographic: true, region: "ND", timezone: "America/Chicago" }, // spans Central/Mountain (NANPA: CM); Central (Fargo, Bismarck) dominant — southwest corner is Mountain
  "702": { country: "US", geographic: true, region: "NV", timezone: "America/Los_Angeles" },
  "703": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "704": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "705": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "706": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "707": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "708": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "709": { country: "CA", geographic: true, region: "NL", timezone: "America/St_Johns" }, // Newfoundland (St. John's) dominant — most of Labrador is Atlantic
  "710": { country: "US", geographic: false, region: null, timezone: null }, // US Government (no geographic region)
  "712": { country: "US", geographic: true, region: "IA", timezone: "America/Chicago" },
  "713": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "714": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "715": { country: "US", geographic: true, region: "WI", timezone: "America/Chicago" },
  "716": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "717": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "718": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "719": { country: "US", geographic: true, region: "CO", timezone: "America/Denver" },
  "720": { country: "US", geographic: true, region: "CO", timezone: "America/Denver" },
  "724": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "725": { country: "US", geographic: true, region: "NV", timezone: "America/Los_Angeles" },
  "726": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "727": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "728": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "729": { country: "US", geographic: true, region: "TN", timezone: "America/New_York" }, // overlay of 423 — shares its Eastern choice
  "730": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "731": { country: "US", geographic: true, region: "TN", timezone: "America/Chicago" },
  "732": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "734": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "737": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "738": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "740": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "742": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "743": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "747": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "748": { country: "US", geographic: true, region: "CO", timezone: "America/Denver" },
  "753": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "754": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "757": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "760": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "762": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "763": { country: "US", geographic: true, region: "MN", timezone: "America/Chicago" },
  "765": { country: "US", geographic: true, region: "IN", timezone: "America/Indiana/Indianapolis" },
  "769": { country: "US", geographic: true, region: "MS", timezone: "America/Chicago" },
  "770": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "771": { country: "US", geographic: true, region: "DC", timezone: "America/New_York" },
  "772": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "773": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "774": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "775": { country: "US", geographic: true, region: "NV", timezone: "America/Los_Angeles" }, // Pacific dominant — West Wendover observes Mountain time (NANPA note)
  "778": { country: "CA", geographic: true, region: "BC", timezone: "America/Vancouver" },
  "779": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "780": { country: "CA", geographic: true, region: "AB", timezone: "America/Edmonton" },
  "781": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "782": { country: "CA", geographic: true, region: "NS", timezone: "America/Halifax" }, // overlay of 902; serves both NS and PE (one Atlantic zone) — region NS dominant
  "785": { country: "US", geographic: true, region: "KS", timezone: "America/Chicago" }, // spans Central/Mountain (NANPA: CM); Central (Topeka) dominant — small far-west Mountain sliver
  "786": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "787": { country: "US", geographic: true, region: "PR", timezone: "America/Puerto_Rico" },
  "801": { country: "US", geographic: true, region: "UT", timezone: "America/Denver" },
  "802": { country: "US", geographic: true, region: "VT", timezone: "America/New_York" },
  "803": { country: "US", geographic: true, region: "SC", timezone: "America/New_York" },
  "804": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "805": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "806": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "807": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" }, // spans Eastern/Central (NANPA: EC); Eastern (Thunder Bay) dominant — far-west portion is Central
  "808": { country: "US", geographic: true, region: "HI", timezone: "Pacific/Honolulu" },
  "810": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "812": { country: "US", geographic: true, region: "IN", timezone: "America/Indiana/Indianapolis" }, // spans Eastern/Central (NANPA: EC); Eastern dominant — Evansville area is Central
  "813": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "814": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "815": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "816": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "817": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "818": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "819": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "820": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "821": { country: "US", geographic: true, region: "SC", timezone: "America/New_York" },
  "825": { country: "CA", geographic: true, region: "AB", timezone: "America/Edmonton" },
  "826": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "828": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "830": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "831": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "832": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "835": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "837": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "838": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "839": { country: "US", geographic: true, region: "SC", timezone: "America/New_York" },
  "840": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "843": { country: "US", geographic: true, region: "SC", timezone: "America/New_York" },
  "845": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "847": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "848": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "850": { country: "US", geographic: true, region: "FL", timezone: "America/Chicago" }, // spans Central/Eastern (NANPA: EC); Central (Pensacola, Panama City) dominant — Tallahassee is Eastern
  "854": { country: "US", geographic: true, region: "SC", timezone: "America/New_York" },
  "856": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "857": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "858": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "859": { country: "US", geographic: true, region: "KY", timezone: "America/New_York" },
  "860": { country: "US", geographic: true, region: "CT", timezone: "America/New_York" },
  "861": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "862": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "863": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "864": { country: "US", geographic: true, region: "SC", timezone: "America/New_York" },
  "865": { country: "US", geographic: true, region: "TN", timezone: "America/New_York" },
  "867": { country: "CA", geographic: true, region: "YT", timezone: "America/Whitehorse" }, // serves all of YT/NT/NU across several zones (NANPA: CMP); Yukon (Whitehorse, largest city served) chosen — year-round MST
  "870": { country: "US", geographic: true, region: "AR", timezone: "America/Chicago" },
  "872": { country: "US", geographic: true, region: "IL", timezone: "America/Chicago" },
  "873": { country: "CA", geographic: true, region: "QC", timezone: "America/Toronto" },
  "878": { country: "US", geographic: true, region: "PA", timezone: "America/New_York" },
  "879": { country: "CA", geographic: true, region: "NL", timezone: "America/St_Johns" }, // overlay of 709 — shares its Newfoundland choice
  "901": { country: "US", geographic: true, region: "TN", timezone: "America/Chicago" },
  "902": { country: "CA", geographic: true, region: "NS", timezone: "America/Halifax" }, // serves both NS and PE (one Atlantic zone) — region NS dominant
  "903": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "904": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "905": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "906": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" }, // spans Eastern/Central (NANPA: EC); Eastern dominant — four western UP counties are Central
  "907": { country: "US", geographic: true, region: "AK", timezone: "America/Anchorage" }, // nearly all of Alaska; Aleutians west of 169.5°W use America/Adak (minor)
  "908": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "909": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "910": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "912": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "913": { country: "US", geographic: true, region: "KS", timezone: "America/Chicago" },
  "914": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "915": { country: "US", geographic: true, region: "TX", timezone: "America/Denver" }, // spans Central/Mountain (NANPA: CM); Mountain (El Paso) dominant
  "916": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "917": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "918": { country: "US", geographic: true, region: "OK", timezone: "America/Chicago" },
  "919": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "920": { country: "US", geographic: true, region: "WI", timezone: "America/Chicago" },
  "924": { country: "US", geographic: true, region: "MN", timezone: "America/Chicago" },
  "925": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "928": { country: "US", geographic: true, region: "AZ", timezone: "America/Phoenix" }, // Arizona observes no DST; the Navajo Nation portion of 928 does (minor)
  "929": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "930": { country: "US", geographic: true, region: "IN", timezone: "America/Indiana/Indianapolis" }, // overlay of 812 — shares its Eastern choice
  "931": { country: "US", geographic: true, region: "TN", timezone: "America/Chicago" }, // spans Central/Eastern (NANPA: EC); Central (Clarksville, Cookeville) dominant
  "934": { country: "US", geographic: true, region: "NY", timezone: "America/New_York" },
  "936": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "937": { country: "US", geographic: true, region: "OH", timezone: "America/New_York" },
  "938": { country: "US", geographic: true, region: "AL", timezone: "America/Chicago" },
  "939": { country: "US", geographic: true, region: "PR", timezone: "America/Puerto_Rico" },
  "940": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "941": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "942": { country: "CA", geographic: true, region: "ON", timezone: "America/Toronto" },
  "943": { country: "US", geographic: true, region: "GA", timezone: "America/New_York" },
  "945": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "947": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
  "948": { country: "US", geographic: true, region: "VA", timezone: "America/New_York" },
  "949": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "951": { country: "US", geographic: true, region: "CA", timezone: "America/Los_Angeles" },
  "952": { country: "US", geographic: true, region: "MN", timezone: "America/Chicago" },
  "954": { country: "US", geographic: true, region: "FL", timezone: "America/New_York" },
  "956": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "959": { country: "US", geographic: true, region: "CT", timezone: "America/New_York" },
  "970": { country: "US", geographic: true, region: "CO", timezone: "America/Denver" },
  "971": { country: "US", geographic: true, region: "OR", timezone: "America/Los_Angeles" },
  "972": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "973": { country: "US", geographic: true, region: "NJ", timezone: "America/New_York" },
  "975": { country: "US", geographic: true, region: "MO", timezone: "America/Chicago" },
  "978": { country: "US", geographic: true, region: "MA", timezone: "America/New_York" },
  "979": { country: "US", geographic: true, region: "TX", timezone: "America/Chicago" },
  "980": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "983": { country: "US", geographic: true, region: "CO", timezone: "America/Denver" },
  "984": { country: "US", geographic: true, region: "NC", timezone: "America/New_York" },
  "985": { country: "US", geographic: true, region: "LA", timezone: "America/Chicago" },
  "986": { country: "US", geographic: true, region: "ID", timezone: "America/Boise" }, // overlay of 208 — shares its Mountain choice (NANPA lists P)
  "989": { country: "US", geographic: true, region: "MI", timezone: "America/Detroit" },
};

/**
 * Strict E.164 US/CA parse: exactly `+1NXXNXXXXXX` (N = 2–9). Returns the
 * 3-digit area code, or null for anything else — no trimming, no formatting
 * tolerance. Callers normalize before calling.
 */
const E164_US_CA = /^\+1([2-9]\d{2})[2-9]\d{2}\d{4}$/;

/**
 * Look up the NANP entry for a strictly-parsed +1 E.164 number. Returns null
 * for malformed input and for area codes not assigned to the US or Canada
 * (Caribbean NANP, NANP-wide service codes, unassigned codes).
 */
export function lookupAreaCode(e164: string): NanpEntry | null {
  const match = E164_US_CA.exec(e164);
  if (!match) return null;
  return NANP_AREA_CODES[match[1]] ?? null;
}

/**
 * The SMS-pumping destination check (SPEC §10 layer 2): true only when the
 * number strictly parses as +1 E.164 AND its area code is assigned to the US
 * or Canada. `+1` alone is never enough — NANP includes ~20 Caribbean
 * countries billed at international rates.
 */
export function isUsCaDestination(e164: string): boolean {
  return lookupAreaCode(e164) !== null;
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function hourFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = hourFormatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    });
    hourFormatters.set(timezone, fmt);
  }
  return fmt;
}

/**
 * Local hour (0–23) at the destination's primary timezone at the instant
 * `atUtc`, for the SPEC §5 quiet-hours check (8pm–8am destination local
 * time → confirm dialog). Offset math — including DST transitions — is done
 * by the runtime's IANA tzdata via Intl.DateTimeFormat; no external deps.
 *
 * Returns null when the destination is not a geographic US/CA area code
 * (unknown/Caribbean code, non-geographic code) or `atUtc` is invalid —
 * "unknown local time" callers treat as "no quiet-hours dialog".
 */
export function destinationLocalHour(e164: string, atUtc: Date): number | null {
  const entry = lookupAreaCode(e164);
  if (!entry || !entry.geographic) return null;
  if (Number.isNaN(atUtc.getTime())) return null;
  const hourPart = hourFormatter(entry.timezone)
    .formatToParts(atUtc)
    .find((part) => part.type === "hour");
  if (!hourPart) return null;
  return Number(hourPart.value);
}
