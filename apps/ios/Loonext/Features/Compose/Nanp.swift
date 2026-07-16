import Foundation

/// NANP destination helpers — a Swift port of the essentials of
/// packages/shared/src/nanp.ts (via the Android Nanp.kt twin; compiled from
/// NANPA's NPA report, file date 07/01/2026).
///
/// The table keeps exactly what mobile needs per area code: the country and
/// the primary IANA timezone (empty for non-geographic codes). Absence from
/// the table IS the US/CA destination check — Caribbean NANP codes, NANP-wide
/// service codes (toll-free, premium), and unassigned codes are deliberately
/// missing, mirroring the server's SMS-pumping gate (SPEC §10).
struct NanpEntry: Equatable, Sendable {
    let country: String
    let timezone: String?
}

enum Nanp {
    /// `code,country,timezone-or-empty` rows — generated from nanp.ts.
    /// Newlines are cosmetic; the parser splits on `;` and trims.
    private static let table = """
201,US,America/New_York;202,US,America/New_York;203,US,America/New_York;204,CA,America/Winnipeg;
205,US,America/Chicago;206,US,America/Los_Angeles;207,US,America/New_York;208,US,America/Boise;
209,US,America/Los_Angeles;210,US,America/Chicago;212,US,America/New_York;213,US,America/Los_Angeles;
214,US,America/Chicago;215,US,America/New_York;216,US,America/New_York;217,US,America/Chicago;
218,US,America/Chicago;219,US,America/Chicago;220,US,America/New_York;223,US,America/New_York;
224,US,America/Chicago;225,US,America/Chicago;226,CA,America/Toronto;227,US,America/New_York;
228,US,America/Chicago;229,US,America/New_York;231,US,America/Detroit;234,US,America/New_York;
235,US,America/Chicago;236,CA,America/Vancouver;239,US,America/New_York;240,US,America/New_York;
248,US,America/Detroit;249,CA,America/Toronto;250,CA,America/Vancouver;251,US,America/Chicago;
252,US,America/New_York;253,US,America/Los_Angeles;254,US,America/Chicago;256,US,America/Chicago;
257,CA,America/Vancouver;260,US,America/Indiana/Indianapolis;262,US,America/Chicago;263,CA,America/Toronto;
267,US,America/New_York;269,US,America/Detroit;270,US,America/Chicago;272,US,America/New_York;
274,US,America/Chicago;276,US,America/New_York;279,US,America/Los_Angeles;281,US,America/Chicago;
283,US,America/New_York;289,CA,America/Toronto;301,US,America/New_York;302,US,America/New_York;
303,US,America/Denver;304,US,America/New_York;305,US,America/New_York;306,CA,America/Regina;
307,US,America/Denver;308,US,America/Chicago;309,US,America/Chicago;310,US,America/Los_Angeles;
312,US,America/Chicago;313,US,America/Detroit;314,US,America/Chicago;315,US,America/New_York;
316,US,America/Chicago;317,US,America/Indiana/Indianapolis;318,US,America/Chicago;319,US,America/Chicago;
320,US,America/Chicago;321,US,America/New_York;323,US,America/Los_Angeles;324,US,America/New_York;
325,US,America/Chicago;326,US,America/New_York;327,US,America/Chicago;329,US,America/New_York;
330,US,America/New_York;331,US,America/Chicago;332,US,America/New_York;334,US,America/Chicago;
336,US,America/New_York;337,US,America/Chicago;339,US,America/New_York;340,US,America/Puerto_Rico;
341,US,America/Los_Angeles;343,CA,America/Toronto;346,US,America/Chicago;347,US,America/New_York;
350,US,America/Los_Angeles;351,US,America/New_York;352,US,America/New_York;353,US,America/Chicago;
354,CA,America/Toronto;357,US,America/Los_Angeles;360,US,America/Los_Angeles;361,US,America/Chicago;
363,US,America/New_York;364,US,America/Chicago;365,CA,America/Toronto;367,CA,America/Toronto;
368,CA,America/Edmonton;369,US,America/Los_Angeles;380,US,America/New_York;382,CA,America/Toronto;
385,US,America/Denver;386,US,America/New_York;401,US,America/New_York;402,US,America/Chicago;
403,CA,America/Edmonton;404,US,America/New_York;405,US,America/Chicago;406,US,America/Denver;
407,US,America/New_York;408,US,America/Los_Angeles;409,US,America/Chicago;410,US,America/New_York;
412,US,America/New_York;413,US,America/New_York;414,US,America/Chicago;415,US,America/Los_Angeles;
416,CA,America/Toronto;417,US,America/Chicago;418,CA,America/Toronto;419,US,America/New_York;
423,US,America/New_York;424,US,America/Los_Angeles;425,US,America/Los_Angeles;428,CA,America/Moncton;
430,US,America/Chicago;431,CA,America/Winnipeg;432,US,America/Chicago;434,US,America/New_York;
435,US,America/Denver;436,US,America/New_York;437,CA,America/Toronto;438,CA,America/Toronto;
440,US,America/New_York;442,US,America/Los_Angeles;443,US,America/New_York;445,US,America/New_York;
447,US,America/Chicago;448,US,America/Chicago;450,CA,America/Toronto;457,US,America/Chicago;
458,US,America/Los_Angeles;463,US,America/Indiana/Indianapolis;464,US,America/Chicago;465,US,America/New_York;
468,CA,America/Toronto;469,US,America/Chicago;470,US,America/New_York;471,US,America/Chicago;
472,US,America/New_York;474,CA,America/Regina;475,US,America/New_York;478,US,America/New_York;
479,US,America/Chicago;480,US,America/Phoenix;483,US,America/Chicago;484,US,America/New_York;
501,US,America/Chicago;502,US,America/New_York;503,US,America/Los_Angeles;504,US,America/Chicago;
505,US,America/Denver;506,CA,America/Moncton;507,US,America/Chicago;508,US,America/New_York;
509,US,America/Los_Angeles;510,US,America/Los_Angeles;512,US,America/Chicago;513,US,America/New_York;
514,CA,America/Toronto;515,US,America/Chicago;516,US,America/New_York;517,US,America/Detroit;
518,US,America/New_York;519,CA,America/Toronto;520,US,America/Phoenix;521,US,;
523,US,;524,US,;525,US,;526,US,;
527,US,;528,US,;529,US,;530,US,America/Los_Angeles;
531,US,America/Chicago;532,US,;534,US,America/Chicago;539,US,America/Chicago;
540,US,America/New_York;541,US,America/Los_Angeles;548,CA,America/Toronto;551,US,America/New_York;
557,US,America/Chicago;559,US,America/Los_Angeles;561,US,America/New_York;562,US,America/Los_Angeles;
563,US,America/Chicago;564,US,America/Los_Angeles;567,US,America/New_York;570,US,America/New_York;
571,US,America/New_York;572,US,America/Chicago;573,US,America/Chicago;574,US,America/Indiana/Indianapolis;
575,US,America/Denver;579,CA,America/Toronto;580,US,America/Chicago;581,CA,America/Toronto;
582,US,America/New_York;584,CA,America/Winnipeg;585,US,America/New_York;586,US,America/Detroit;
587,CA,America/Edmonton;600,CA,;601,US,America/Chicago;602,US,America/Phoenix;
603,US,America/New_York;604,CA,America/Vancouver;605,US,America/Chicago;606,US,America/New_York;
607,US,America/New_York;608,US,America/Chicago;609,US,America/New_York;610,US,America/New_York;
612,US,America/Chicago;613,CA,America/Toronto;614,US,America/New_York;615,US,America/Chicago;
616,US,America/Detroit;617,US,America/New_York;618,US,America/Chicago;619,US,America/Los_Angeles;
620,US,America/Chicago;621,US,America/Chicago;622,CA,;623,US,America/Phoenix;
624,US,America/New_York;626,US,America/Los_Angeles;628,US,America/Los_Angeles;629,US,America/Chicago;
630,US,America/Chicago;631,US,America/New_York;633,CA,;636,US,America/Chicago;
639,CA,America/Regina;640,US,America/New_York;641,US,America/Chicago;645,US,America/New_York;
646,US,America/New_York;647,CA,America/Toronto;650,US,America/Los_Angeles;651,US,America/Chicago;
656,US,America/New_York;657,US,America/Los_Angeles;659,US,America/Chicago;660,US,America/Chicago;
661,US,America/Los_Angeles;662,US,America/Chicago;667,US,America/New_York;669,US,America/Los_Angeles;
670,US,Pacific/Saipan;671,US,Pacific/Guam;672,CA,America/Vancouver;678,US,America/New_York;
679,US,America/Detroit;680,US,America/New_York;681,US,America/New_York;682,US,America/Chicago;
683,CA,America/Toronto;684,US,Pacific/Pago_Pago;686,US,America/New_York;689,US,America/New_York;
701,US,America/Chicago;702,US,America/Los_Angeles;703,US,America/New_York;704,US,America/New_York;
705,CA,America/Toronto;706,US,America/New_York;707,US,America/Los_Angeles;708,US,America/Chicago;
709,CA,America/St_Johns;710,US,;712,US,America/Chicago;713,US,America/Chicago;
714,US,America/Los_Angeles;715,US,America/Chicago;716,US,America/New_York;717,US,America/New_York;
718,US,America/New_York;719,US,America/Denver;720,US,America/Denver;724,US,America/New_York;
725,US,America/Los_Angeles;726,US,America/Chicago;727,US,America/New_York;728,US,America/New_York;
729,US,America/New_York;730,US,America/Chicago;731,US,America/Chicago;732,US,America/New_York;
734,US,America/Detroit;737,US,America/Chicago;738,US,America/Los_Angeles;740,US,America/New_York;
742,CA,America/Toronto;743,US,America/New_York;747,US,America/Los_Angeles;748,US,America/Denver;
753,CA,America/Toronto;754,US,America/New_York;757,US,America/New_York;760,US,America/Los_Angeles;
762,US,America/New_York;763,US,America/Chicago;765,US,America/Indiana/Indianapolis;769,US,America/Chicago;
770,US,America/New_York;771,US,America/New_York;772,US,America/New_York;773,US,America/Chicago;
774,US,America/New_York;775,US,America/Los_Angeles;778,CA,America/Vancouver;779,US,America/Chicago;
780,CA,America/Edmonton;781,US,America/New_York;782,CA,America/Halifax;785,US,America/Chicago;
786,US,America/New_York;787,US,America/Puerto_Rico;801,US,America/Denver;802,US,America/New_York;
803,US,America/New_York;804,US,America/New_York;805,US,America/Los_Angeles;806,US,America/Chicago;
807,CA,America/Toronto;808,US,Pacific/Honolulu;810,US,America/Detroit;812,US,America/Indiana/Indianapolis;
813,US,America/New_York;814,US,America/New_York;815,US,America/Chicago;816,US,America/Chicago;
817,US,America/Chicago;818,US,America/Los_Angeles;819,CA,America/Toronto;820,US,America/Los_Angeles;
821,US,America/New_York;825,CA,America/Edmonton;826,US,America/New_York;828,US,America/New_York;
830,US,America/Chicago;831,US,America/Los_Angeles;832,US,America/Chicago;835,US,America/New_York;
837,US,America/Los_Angeles;838,US,America/New_York;839,US,America/New_York;840,US,America/Los_Angeles;
843,US,America/New_York;845,US,America/New_York;847,US,America/Chicago;848,US,America/New_York;
850,US,America/Chicago;854,US,America/New_York;856,US,America/New_York;857,US,America/New_York;
858,US,America/Los_Angeles;859,US,America/New_York;860,US,America/New_York;861,US,America/Chicago;
862,US,America/New_York;863,US,America/New_York;864,US,America/New_York;865,US,America/New_York;
867,CA,America/Whitehorse;870,US,America/Chicago;872,US,America/Chicago;873,CA,America/Toronto;
878,US,America/New_York;879,CA,America/St_Johns;901,US,America/Chicago;902,CA,America/Halifax;
903,US,America/Chicago;904,US,America/New_York;905,CA,America/Toronto;906,US,America/Detroit;
907,US,America/Anchorage;908,US,America/New_York;909,US,America/Los_Angeles;910,US,America/New_York;
912,US,America/New_York;913,US,America/Chicago;914,US,America/New_York;915,US,America/Denver;
916,US,America/Los_Angeles;917,US,America/New_York;918,US,America/Chicago;919,US,America/New_York;
920,US,America/Chicago;924,US,America/Chicago;925,US,America/Los_Angeles;928,US,America/Phoenix;
929,US,America/New_York;930,US,America/Indiana/Indianapolis;931,US,America/Chicago;934,US,America/New_York;
936,US,America/Chicago;937,US,America/New_York;938,US,America/Chicago;939,US,America/Puerto_Rico;
940,US,America/Chicago;941,US,America/New_York;942,CA,America/Toronto;943,US,America/New_York;
945,US,America/Chicago;947,US,America/Detroit;948,US,America/New_York;949,US,America/Los_Angeles;
951,US,America/Los_Angeles;952,US,America/Chicago;954,US,America/New_York;956,US,America/Chicago;
959,US,America/New_York;970,US,America/Denver;971,US,America/Los_Angeles;972,US,America/Chicago;
973,US,America/New_York;975,US,America/Chicago;978,US,America/New_York;979,US,America/Chicago;
980,US,America/New_York;983,US,America/Denver;984,US,America/New_York;985,US,America/Chicago;
986,US,America/Boise;989,US,America/Detroit
"""

    static let areaCodes: [String: NanpEntry] = {
        var map: [String: NanpEntry] = [:]
        for row in table.split(separator: ";") {
            let parts = row.trimmingCharacters(in: .whitespacesAndNewlines)
                .split(separator: ",", omittingEmptySubsequences: false)
            guard parts.count >= 2 else { continue }
            let timezone = parts.count > 2 && !parts[2].isEmpty ? String(parts[2]) : nil
            map[String(parts[0])] = NanpEntry(country: String(parts[1]), timezone: timezone)
        }
        return map
    }()

    /// Strict E.164 US/CA shape: `+1NXXNXXXXXX` (N = 2-9), no tolerance.
    static func lookupAreaCode(_ e164: String) -> NanpEntry? {
        guard e164.count == 12, e164.hasPrefix("+1") else { return nil }
        let digits = Array(e164.dropFirst(2))
        guard digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        guard let npaFirst = digits[0].wholeNumberValue, (2 ... 9).contains(npaFirst) else { return nil }
        guard let nxxFirst = digits[3].wholeNumberValue, (2 ... 9).contains(nxxFirst) else { return nil }
        return areaCodes[String(digits[0 ... 2])]
    }

    /// True only for a strictly-parsed +1 number whose NPA is US/CA-assigned.
    static func isUsCaDestination(_ e164: String) -> Bool {
        lookupAreaCode(e164) != nil
    }

    /// "US" | "CA" | nil — drives the registration-pending banner.
    static func destinationCountry(_ e164: String) -> String? {
        lookupAreaCode(e164)?.country
    }

    /// Local wall-clock time (hour/minute) at the destination's primary
    /// timezone, or nil for non-geographic/unknown codes — "unknown local
    /// time" shows no hint.
    static func destinationLocalTime(_ e164: String, at date: Date = Date()) -> DateComponents? {
        guard let zoneId = lookupAreaCode(e164)?.timezone,
              let zone = TimeZone(identifier: zoneId)
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.dateComponents([.hour, .minute], from: date)
    }

    /// "5:04 PM" at the destination, or nil when there is no zone to know.
    static func destinationLocalTimeLabel(_ e164: String, at date: Date = Date()) -> String? {
        guard let zoneId = lookupAreaCode(e164)?.timezone,
              let zone = TimeZone(identifier: zoneId)
        else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }

    /// The digits a user typed, normalized for NANP entry: strip everything
    /// non-numeric, drop one leading 1 (country code), cap at 10.
    static func nationalDigits(_ input: String) -> String {
        let digits = input.filter { $0.isASCII && $0.isNumber }
        let national = digits.hasPrefix("1") ? String(digits.dropFirst()) : digits
        return String(national.prefix(10))
    }

    /// '(415) 555-0134' progressive as-you-type formatting of national digits.
    static func formatAsYouType(_ digits: String) -> String {
        if digits.isEmpty { return "" }
        if digits.count <= 3 { return "(\(digits)" }
        if digits.count <= 6 {
            return "(\(digits.prefix(3))) \(digits.dropFirst(3))"
        }
        return "(\(digits.prefix(3))) \(digits.dropFirst(3).prefix(3))-\(digits.dropFirst(6))"
    }

    /// `+1XXXXXXXXXX` for a complete 10-digit national number, else nil.
    static func toE164(_ input: String) -> String? {
        let digits = nationalDigits(input)
        return digits.count == 10 ? "+1\(digits)" : nil
    }
}
