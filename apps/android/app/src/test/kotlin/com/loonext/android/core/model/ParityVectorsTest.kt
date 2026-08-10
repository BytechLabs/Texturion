package com.loonext.android.core.model

import com.loonext.android.features.compose.Nanp
import com.loonext.android.features.compose.SmsEncoding
import com.loonext.android.features.compose.estimateSegments
import com.loonext.android.features.settings.lastCompleteMonth
import com.loonext.android.features.settings.prepaidConversionCopy
import com.loonext.android.ui.common.initialsOf
import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #376 — the same inputs the TypeScript owns, asserted against the Kotlin port.
 *
 * `packages/shared` is shared by two of four clients, so every rule Android
 * needs exists a second time here and a third time in Swift. #376 names that as
 * the root cause behind #338's parity drift, and it is right: a rule change
 * needs three edits and nothing enforced the third.
 *
 * The cases are GENERATED from the TypeScript implementations by
 * `scripts/generate-parity-vectors.mjs` and committed to
 * `packages/shared/vectors/`. CI regenerates and fails if they are stale, so
 * the file cannot quietly describe last month's rule.
 *
 * This does not prevent divergence — three implementations remain, which #376's
 * own devil's advocate argues is reasonable for a hundred-line rule across
 * native clients. It CATCHES divergence, on the two rules where being wrong
 * costs money or wakes somebody up:
 *
 *   segments  what a customer is billed, and what the composer promises
 *   nanp      destination validity, and the quiet-hours clock (#292)
 *
 * Read from the repo rather than copied into test resources: a copy is a fourth
 * place the cases live, which is the problem this is meant to solve.
 */
class ParityVectorsTest {
    @Serializable
    private data class SegmentVector(
        val text: String,
        val encoding: String,
        val segments: Int,
        val unitsUsed: Int,
        val unitsPerSegment: Int,
    )

    @Serializable
    private data class NanpVector(
        val e164: String,
        val is_us_ca: Boolean,
        val timezone: String? = null,
        val country: String? = null,
    )

    @Serializable
    private data class RejectionVector(
        val domain: String,
        val reason: String,
        val recognised: Boolean,
        val field: String? = null,
    )

    @Serializable
    private data class AvatarInitialsVector(
        val name: String,
        val initials: String,
    )

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Walk UP to the repo root rather than counting `../` from the working
     * directory. Gradle runs unit tests from `apps/android/app`, but that is a
     * detail of the runner rather than a promise — the first attempt hard-coded
     * the depth and looked in `apps/packages`.
     */
    private fun vectors(name: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/vectors/$name")
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError(
            "parity vectors not found walking up from ${File("").absolutePath}. " +
                "Run: node scripts/generate-parity-vectors.mjs",
        )
    }

    @Test
    fun `segment counting agrees with the TypeScript`() {
        val cases = json.decodeFromString<List<SegmentVector>>(vectors("segments.json"))
        assertTrue("no segment vectors", cases.isNotEmpty())
        for (case in cases) {
            val actual = estimateSegments(case.text)
            // The label names the INPUT rather than an index, so a failure says
            // which message diverged instead of which line of a JSON file.
            val label = "segments for ${case.text.take(24)} (${case.text.length} chars)"
            assertEquals("$label: encoding", case.encoding, actual.encoding)
            assertEquals("$label: segments", case.segments, actual.segments)
            assertEquals("$label: unitsUsed", case.unitsUsed, actual.unitsUsed)
            assertEquals("$label: unitsPerSegment", case.unitsPerSegment, actual.unitsPerSegment)
        }
    }

    @Test
    fun `the encodings are spelled the same on both sides`() {
        // The two constants the vectors compare against by string. A rename on
        // either side would make every segment case fail with a confusing
        // message; this one fails with the reason.
        assertEquals("GSM-7", SmsEncoding.GSM7)
        assertEquals("UCS-2", SmsEncoding.UCS2)
    }

    @Test
    fun `rejection routing agrees with the TypeScript`() {
        // #352. Pins WHERE a rejection sends the customer and whether we claim
        // to understand it — never the wording, which each platform may phrase
        // its own way. A client that focuses the wrong field walks somebody
        // through re-entering the one thing that was already right, then bills
        // them another multi-day carrier review for it.
        //
        // This case earned its vectors before it shipped: the obvious matcher
        // is a word-boundary regex, and `\bein\b` does not match
        // `EIN_MISMATCH` because an underscore is a word character — so the
        // whole catalogue matched nothing while reading as correct. In Kotlin
        // that mistake is worse, since "\b" here is a backspace character
        // rather than a boundary. Hence no regex on either side.
        val cases = json.decodeFromString<List<RejectionVector>>(vectors("rejections.json"))
        assertTrue("no rejection vectors", cases.isNotEmpty())
        for (case in cases) {
            val domain = when (case.domain) {
                "registration" -> RejectionDomain.REGISTRATION
                "port" -> RejectionDomain.PORT
                else -> throw AssertionError("unknown domain ${case.domain}")
            }
            val guidance = explainRejection(domain, case.reason)
            val label = "${case.domain}/${case.reason.take(40)}"
            assertEquals("$label: recognised", case.recognised, guidance != null)
            assertEquals("$label: field", case.field, guidance?.field)
            if (guidance != null) {
                // Wording is free, but empty wording is not: a recognised
                // reason that renders nothing is worse than an unrecognised one,
                // because the raw fall-through never runs.
                assertTrue("$label: what", guidance.what.isNotBlank())
                assertTrue("$label: fix", guidance.fix.isNotBlank())
            }
        }
    }

    @Test
    fun `area-code lookup agrees with the TypeScript`() {
        val cases = json.decodeFromString<List<NanpVector>>(vectors("nanp.json"))
        assertTrue("no nanp vectors", cases.isNotEmpty())
        for (case in cases) {
            val entry = Nanp.lookupAreaCode(case.e164)
            assertEquals(
                "is_us_ca for ${case.e164}",
                case.is_us_ca,
                Nanp.isUsCaDestination(case.e164),
            )
            // The quiet-hours clock reads this. A client that invented a
            // timezone here would text somebody at 3am.
            assertEquals("timezone for ${case.e164}", case.timezone, entry?.timezone)
            assertEquals("country for ${case.e164}", case.country, entry?.country)
        }
    }

    @Test
    fun `avatar initials agree with the TypeScript`() {
        // #582: this rule existed FIVE times and the five disagreed. Two of them
        // disagreed on one screen, so a contact was two people at a glance, and this
        // phone showed `(5` for every unnamed contact — the badge is handed a
        // formatted number and the old code took its first character.
        //
        // There is one implementation now. This is what keeps the hand-port on it.
        val cases =
            json.decodeFromString<List<AvatarInitialsVector>>(vectors("avatar-initials.json"))
        assertTrue("no avatar-initials vectors", cases.isNotEmpty())
        for (case in cases) {
            // The label names the INPUT, so a failure says which name diverged rather
            // than which line of a JSON file.
            assertEquals("initials for '${case.name}'", case.initials, initialsOf(case.name))
        }
    }

    @Serializable
    private data class LastCompleteMonthVector(
        val year: Int,
        val month: Int,
        val from: String,
        val to: String,
    )

    @Test
    fun `the default export period agrees with the TypeScript`() {
        // #595. The period three clients OPEN ON. Drift here is not cosmetic: a
        // bookkeeper reconciling a month gets a different file depending on
        // which client they asked from, and the difference is a whole day at
        // each end — exactly the kind that reconciles to nothing and gets
        // blamed on the meter.
        //
        // The vectors carry the cases the rule is actually wrong in if ported
        // carelessly: January rolling back a year, a 30-day month, February
        // common and leap, and BOTH century rules — 2100 is not a leap year and
        // 2000 is. A `% 4` shortcut passes every case a human would think to
        // write by hand and fails the 2100 one here.
        val cases =
            json.decodeFromString<List<LastCompleteMonthVector>>(
                vectors("last-complete-month.json"),
            )
        assertTrue("no last-complete-month vectors", cases.isNotEmpty())
        for (case in cases) {
            val actual = lastCompleteMonth(case.year, case.month)
            // The label names the INPUT, so a failure says which month diverged
            // rather than which line of a JSON file.
            val label = "lastCompleteMonth(${case.year}, ${case.month})"
            assertEquals("$label: from", case.from, actual.from)
            assertEquals("$label: to", case.to, actual.to)
        }
    }

    @Serializable
    private data class PrepaidCopyVector(
        val from_plan: String,
        val to_plan: String,
        val credit: String? = null,
        val heading: String,
        val explanation: String,
        val acknowledgement: String,
    )

    @Test
    fun `the prepaid-year promise agrees with the TypeScript`() {
        // #583/D131: these sentences tell a customer their money is coming back, and
        // they are asked to tick a box agreeing to the amount in them. Three clients
        // say it. A word of drift here is a different promise on a different phone.
        //
        // The one that would matter most is the LAST case pair: no figure from the
        // server means promise no number. A client that interpolated a null anyway
        // would say "puts  back on your account", which is both broken and a
        // promise about an amount nobody named.
        val cases =
            json.decodeFromString<List<PrepaidCopyVector>>(
                vectors("prepaid-conversion-copy.json"),
            )
        assertTrue("no prepaid-conversion-copy vectors", cases.isNotEmpty())
        for (case in cases) {
            val actual = prepaidConversionCopy(case.from_plan, case.to_plan, case.credit)
            val label = "${case.from_plan}->${case.to_plan} credit=${case.credit}"
            assertEquals("heading for $label", case.heading, actual.heading)
            assertEquals("explanation for $label", case.explanation, actual.explanation)
            assertEquals(
                "acknowledgement for $label",
                case.acknowledgement,
                actual.acknowledgement,
            )
        }
    }
}
