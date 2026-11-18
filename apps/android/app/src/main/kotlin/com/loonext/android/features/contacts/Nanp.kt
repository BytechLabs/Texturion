package com.loonext.android.features.contacts

/**
 * Kotlin port of packages/shared/src/nanp.ts (SPEC §3, §5, §10; D4, D8) —
 * the strict US/CA destination check the create-contact sheet validates with
 * before the server's authoritative pass.
 *
 * The table is the KEY SET of the shared NANP_AREA_CODES map (446 in-service
 * US/CA area codes per NANPA's 07/01/2026 report). Region/timezone metadata is
 * deliberately not ported — the app only needs the destination check. As in
 * the shared module, Caribbean NANP codes (Bahamas 242, Jamaica 876, …),
 * NANP-wide service codes (toll-free 800/833/…, premium 900, 500-family, 700)
 * and unassigned codes are ABSENT: absence IS the destination check.
 */
object Nanp {
    private val phoneInput = Regex("""\+?[0-9\s().-]*""")
    private val tollFree = Regex("""\+1(?:800|833|844|855|866|877|888)[2-9][0-9]{6}""")
    private val serviceCode = Regex("(?:[2-9]11|112|988)")
    private val nonGeographic5xx = setOf("521", "523", "524", "525", "526", "527", "528", "529", "532")


    /** Every currently-assigned, in-service US/Canada NANP area code. */
    val AREA_CODES: Set<String> = setOf(
        "201", "202", "203", "204", "205", "206", "207", "208", "209", "210", "212", "213",
        "214", "215", "216", "217", "218", "219", "220", "223", "224", "225", "226", "227",
        "228", "229", "231", "234", "235", "236", "239", "240", "248", "249", "250", "251",
        "252", "253", "254", "256", "257", "260", "262", "263", "267", "269", "270", "272",
        "274", "276", "279", "281", "283", "289", "301", "302", "303", "304", "305", "306",
        "307", "308", "309", "310", "312", "313", "314", "315", "316", "317", "318", "319",
        "320", "321", "323", "324", "325", "326", "327", "329", "330", "331", "332", "334",
        "336", "337", "339", "340", "341", "343", "346", "347", "350", "351", "352", "353",
        "354", "357", "360", "361", "363", "364", "365", "367", "368", "369", "380", "382",
        "385", "386", "401", "402", "403", "404", "405", "406", "407", "408", "409", "410",
        "412", "413", "414", "415", "416", "417", "418", "419", "423", "424", "425", "428",
        "430", "431", "432", "434", "435", "436", "437", "438", "440", "442", "443", "445",
        "447", "448", "450", "457", "458", "463", "464", "465", "468", "469", "470", "471",
        "472", "474", "475", "478", "479", "480", "483", "484", "501", "502", "503", "504",
        "505", "506", "507", "508", "509", "510", "512", "513", "514", "515", "516", "517",
        "518", "519", "520", "521", "523", "524", "525", "526", "527", "528", "529", "530",
        "531", "532", "534", "539", "540", "541", "548", "551", "557", "559", "561", "562",
        "563", "564", "567", "570", "571", "572", "573", "574", "575", "579", "580", "581",
        "582", "584", "585", "586", "587", "600", "601", "602", "603", "604", "605", "606",
        "607", "608", "609", "610", "612", "613", "614", "615", "616", "617", "618", "619",
        "620", "621", "622", "623", "624", "626", "628", "629", "630", "631", "633", "636",
        "639", "640", "641", "645", "646", "647", "650", "651", "656", "657", "659", "660",
        "661", "662", "667", "669", "670", "671", "672", "678", "679", "680", "681", "682",
        "683", "684", "686", "689", "701", "702", "703", "704", "705", "706", "707", "708",
        "709", "710", "712", "713", "714", "715", "716", "717", "718", "719", "720", "724",
        "725", "726", "727", "728", "729", "730", "731", "732", "734", "737", "738", "740",
        "742", "743", "747", "748", "753", "754", "757", "760", "762", "763", "765", "769",
        "770", "771", "772", "773", "774", "775", "778", "779", "780", "781", "782", "785",
        "786", "787", "801", "802", "803", "804", "805", "806", "807", "808", "810", "812",
        "813", "814", "815", "816", "817", "818", "819", "820", "821", "825", "826", "828",
        "830", "831", "832", "835", "837", "838", "839", "840", "843", "845", "847", "848",
        "850", "854", "856", "857", "858", "859", "860", "861", "862", "863", "864", "865",
        "867", "870", "872", "873", "878", "879", "901", "902", "903", "904", "905", "906",
        "907", "908", "909", "910", "912", "913", "914", "915", "916", "917", "918", "919",
        "920", "924", "925", "928", "929", "930", "931", "934", "936", "937", "938", "939",
        "940", "941", "942", "943", "945", "947", "948", "949", "951", "952", "954", "956",
        "959", "970", "971", "972", "973", "975", "978", "979", "980", "983", "984", "985",
        "986", "989",
    )

    /**
     * Strict E.164 US/CA parse: exactly `+1NXXNXXXXXX` (N = 2–9). No trimming,
     * no formatting tolerance — callers normalize first (same contract as the
     * shared module's E164_US_CA).
     */
    private val E164_US_CA = Regex("^\\+1([2-9]\\d{2})[2-9]\\d{2}\\d{4}$")

    /**
     * The area code of a strictly-parsed +1 E.164 number, or null for
     * malformed input and for area codes not assigned to the US or Canada.
     */
    fun lookupAreaCode(e164: String): String? {
        val match = E164_US_CA.find(e164) ?: return null
        val npa = match.groupValues[1]
        return if (npa in AREA_CODES) npa else null
    }

    /**
     * The SMS-pumping destination check (SPEC §10 layer 2): true only when the
     * number has a supported US or Canadian area code and exchange.
     */
    fun isUsCaDestination(e164: String): Boolean {
        val npa = lookupAreaCode(e164) ?: return false
        return npa !in nonGeographic5xx && e164.substring(5, 8) != "976"
    }

    fun isReachableDestination(e164: String): Boolean =
        isUsCaDestination(e164) || tollFree.matches(e164)

    fun emergencyOrServiceCode(raw: String): String? =
        raw.trim().takeIf(serviceCode::matches)

    /** A complete US/CA or toll-free number entered as national or +1 format. */
    fun normalize(raw: String): String? {
        val input = raw.trim()
        if (!phoneInput.matches(input)) return null
        if (input.startsWith("+") && !input.startsWith("+1")) return null
        val digits = input.filter { it in '0'..'9' }
        val candidate = when {
            digits.length == 11 && digits.startsWith("1") -> "+$digits"
            digits.length == 10 && !input.startsWith("+") -> "+1$digits"
            else -> return null
        }
        return candidate.takeIf(::isReachableDestination)
    }

    /** Format a partial number while preserving input that needs correction. */
    fun formatAsYouType(raw: String): String {
        val input = raw.trim()
        if (!phoneInput.matches(input) || (input.startsWith("+") && !input.startsWith("+1"))) return raw
        var digits = input.filter { it in '0'..'9' }
        if (input.startsWith("+1") || (digits.length == 11 && digits.startsWith("1"))) {
            digits = digits.drop(1)
        }
        if (digits.length > 10 || (digits.isEmpty() && input.startsWith("+"))) return raw
        return when {
            digits.isEmpty() -> ""
            digits.length <= 3 -> "(${digits}"
            digits.length <= 6 -> "(${digits.substring(0, 3)}) ${digits.substring(3)}"
            else ->
                "(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}"
        }
    }
}
