package com.loonext.android.features.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #525 — buying US texting during a paused winter.
 *
 * THE FACT THIS FILE IS BUILT ON, established in the API before a line of it was
 * written: `POST /v1/registration/enable-us` never reads `paused_at`, and
 * nothing downstream of it does either. The brand goes out, the campaign is
 * built, the numbers are assigned, and the approval lands — all of it while the
 * workspace is paused. The purchase is real. So this file guards no gate, and a
 * future change that adds one is the defect, not the fix.
 *
 * WHAT WAS WRONG WAS THE SENTENCE, not the charge. The card told a paused owner
 * "We handle it and email you when it's live", and `runPreSendGates` refuses
 * every send with `workspace_paused` for as long as the pause holds. Approval
 * arrives; texting does not. Somebody paid for a capability and was given the
 * wrong date for it — on the one screen whose entire purpose is consent to that
 * charge.
 *
 * THREE THINGS CAN GO WRONG HERE, and they fail separately, so the file is in
 * three parts.
 *
 * The first is A PROMISE THAT DOES NOT HOLD — the shipped defect. The paused
 * branch has to say the review runs anyway AND that texting waits for the
 * resume, and dropping either clause leaves a different wrong impression: drop
 * the first and the sensible move is to wait until spring, which the facts do
 * not support; drop the second and it is the old promise again.
 *
 * The second is A GATE ARRIVING BY THE BACK DOOR. Nobody is going to add
 * `if (paused) return` — they are going to grey the button "until they can use
 * it", or withhold the card during the read, and every one of those is a refusal
 * of a purchase that works. So the control is asserted to be IDENTICAL across
 * the two branches, and the render site is read for anything that would remove
 * it.
 *
 * The third is A FIGURE WE MADE UP. Money on this card is [usRegistrationFee]'s,
 * resolved from the workspace's own billing currency (#522), and the approval
 * window is [US_APPROVAL_WINDOW]. The sweeps below are not "the copy mentions a
 * price" — they are "every money token in every sentence is the one the caller
 * resolved", which is the only shape that fails on a plausible number typed in.
 *
 * WHAT IS NOT HERE. Whether the workspace is really paused: that is
 * GET /v1/billing/pause's answer and [PauseRead]'s to model, both guarded in
 * `PauseOfferTest`. This file checks that the answer reaches these sentences and
 * that nothing else does.
 */
class EnableUsPausedTest {

    private val card = "features/settings/RegistrationCard.kt"
    private val numbers = "features/settings/NumbersSection.kt"

    /**
     * A fee no hardcode in this tree would produce.
     *
     * The shipped figures are `$29` and `$39` (`US_REGISTRATION_FEE_CENTS`), so
     * a sweep run at either of them is satisfied by the literal it exists to
     * catch — the mistake `PauseOfferTest` names at length after a price guard
     * passed on its own defect. `$12.75` is neither figure, is not a plan price,
     * and exercises the fractional shape a round number never reaches.
     */
    private val oddFee = "\$12.75"

    private fun paused(fee: String = oddFee) = enableUsCopy(fee, paused = true)
    private fun running(fee: String = oddFee) = enableUsCopy(fee, paused = false)

    /** Every sentence a person can read on this card, for one branch. */
    private fun everything(copy: EnableUsCopy): List<Pair<String, String>> = listOf(
        "the description" to copy.description,
        "the button" to copy.buttonLabel,
        "the read-only line" to copy.readOnlyLine,
        "the paused note" to (copy.pausedNote ?: ""),
        "the confirm title" to copy.confirmTitle,
        "the confirmation" to copy.confirmBody,
        "the confirm button" to copy.confirmLabel,
        "the message after it lands" to copy.startedMessage,
    )

    // -- the promise, which is what was broken --------------------------------

    /**
     * THE DEFECT, AS A PROPERTY.
     *
     * Both clauses, always. "The review runs while you're paused" on its own
     * reads as "so you can text soon", which is the old promise with extra
     * words; "you can't text until you resume" on its own reads as "so don't
     * buy this yet", which is a refusal written in prose and is false — the
     * registration really does complete, and a crew that buys it in spring
     * waits out the carriers in their busiest week instead of their quietest.
     */
    @Test
    fun `a paused workspace is told the review runs and that texting waits`() {
        val copy = paused()
        val note = copy.pausedNote
        assertNotNull("a paused workspace must be told something at all", note)

        listOf(
            "the note above the button" to note!!.lowercase(),
            "the confirmation" to copy.confirmBody.lowercase(),
        ).forEach { (where, text) ->
            assertTrue(
                "$where does not say the plan is paused, so nothing that follows " +
                    "is anchored to anything: $text",
                text.contains("paused"),
            )
            assertTrue(
                "$where does not say texting waits for the resume. That is the " +
                    "sentence this whole issue is about — approval lands, " +
                    "runPreSendGates still answers 402, and the card used to call " +
                    "that live: $text",
                text.contains("resume"),
            )
        }

        assertTrue(
            "the confirmation must say the review runs during the pause, or the " +
                "reader concludes the fee buys a queue position that starts in " +
                "spring and the sensible move is to wait: ${copy.confirmBody}",
            copy.confirmBody.contains("runs while your plan is paused"),
        )
        assertTrue(
            "and it must say the fee cannot be saved by waiting — " +
                "`registration_fee_paid_at` is stamped once per workspace ever, so " +
                "the alternative the reader is weighing does not exist: " +
                "${copy.confirmBody}",
            copy.confirmBody.contains("once per workspace"),
        )
    }

    /**
     * AND THE CONFIRMATION AFTER THE PRESS DOES NOT UNDO IT.
     *
     * The dialog can be perfect and the toast can still say "we'll email you
     * when it's approved" — which is true, and which a paused reader will read
     * as the date they can text. It is the last sentence they see before the
     * card disappears.
     */
    @Test
    fun `the message after the charge lands keeps the same date`() {
        assertTrue(
            "the paused confirmation must still name the resume: " +
                "${paused().startedMessage}",
            paused().startedMessage.lowercase().contains("resume"),
        )
        assertFalse(
            "and an unpaused workspace must not be told to resume something it " +
                "never stopped: ${running().startedMessage}",
            running().startedMessage.lowercase().contains("resume"),
        )
    }

    /**
     * AN UNPAUSED WORKSPACE READS WHAT IT READ BEFORE THIS EXISTED.
     *
     * The pause vocabulary is swept out of every unpaused sentence rather than
     * the old strings being pinned word for word: a pin on the sentences would
     * fail the next time somebody improves them, and what actually matters is
     * that a running workspace is never told about a state it is not in. This is
     * also what makes an unanswered read safe — [PauseRead.isPaused] is false
     * for a read in flight and for one that failed, and false lands here.
     */
    @Test
    fun `nothing about a pause reaches a workspace that is not paused`() {
        val copy = running()
        assertNull("there is no note to draw when nothing is paused", copy.pausedNote)
        everything(copy).forEach { (where, text) ->
            listOf("pause", "resume", "quiet", "spring").forEach { word ->
                assertFalse(
                    "$where speaks to a paused reader on a running workspace " +
                        "(`$word`): $text",
                    text.lowercase().contains(word),
                )
            }
        }
    }

    // -- the gate that must never arrive --------------------------------------

    /**
     * THE PURCHASE IS NOT REFUSED, AND THE CONTROL IS NOT EVEN DIFFERENT.
     *
     * Everything a thumb lands on is byte-identical across the two branches, so
     * there is no room for "Enable US texting (available when you resume)", no
     * room for a second label, and no room for a null. The pause adds a
     * paragraph and changes two sentences; it takes nothing away.
     *
     * The description and the read-only line are in here for the same reason:
     * the read-only line is what a member reads, and quietly rewording it into
     * "your owner can turn this on when you resume" is the refusal again, said
     * to the person who cannot argue with it.
     */
    @Test
    fun `the pause changes no control and withdraws nothing`() {
        val on = paused()
        val off = running()
        listOf(
            "the button" to (on.buttonLabel to off.buttonLabel),
            "the confirm button" to (on.confirmLabel to off.confirmLabel),
            "the confirm title" to (on.confirmTitle to off.confirmTitle),
            "the description" to (on.description to off.description),
            "the read-only line" to (on.readOnlyLine to off.readOnlyLine),
        ).forEach { (where, pair) ->
            assertEquals(
                "$where differs while paused. A pause is not a reason to refuse a " +
                    "purchase that completes — the carriers register a paused " +
                    "workspace exactly as they register a running one, and a " +
                    "reworded control is how a refusal gets in without anybody " +
                    "calling it one",
                pair.second,
                pair.first,
            )
        }
    }

    /**
     * ...AND NEITHER DOES THE RENDER SITE.
     *
     * The property above is about the copy; this is about the card. A verifier
     * who leaves [enableUsCopy] alone can still grey the button, withhold it for
     * the length of the read, return early above the card, or hand it
     * `Modifier.height(0.dp)` — none of which any assertion on the strings can
     * see, and the first three are shapes this repository has already shipped
     * onto the cancel screen and had to write [ExitPath] to catch.
     *
     * SO THE PROPERTY IS CHECKED, NOT THE MECHANISM, which is that file's whole
     * lesson: every one of those escapes has to CONSULT the pause in order to
     * know when to fire. On this card exactly three lines are allowed to mention
     * it — the parameter it arrives on, the one line that turns it into words,
     * and reads of the resulting copy. Anything else, of any shape, is a fourth
     * line and fails here without this guard needing to have heard of it.
     */
    @Test
    fun `nothing on the card is gated on the pause`() {
        val consulted = withoutComments(composable("EnableUsCard"))
            .lines()
            .map { it.trim() }
            .filter { it.contains("pause", ignoreCase = true) }
            // The fact arriving, and the copy it was already turned into. A
            // `copy.` read is words on a screen; it cannot withhold anything.
            .filterNot { it == "pause: PauseRead," || it.startsWith("copy.") }

        val complaint =
            "something on the enable-US card consults the pause besides the one " +
                "line that words it. Greying the button, withdrawing it during the " +
                "read, returning early, sizing it to nothing — they are one defect " +
                "with many shapes, and what they share is this: a refusal has to " +
                "ask whether the workspace is paused. Turning the fact into " +
                "sentences is the only thing on this card that may"

        // The COUNT is the guarantee, and it is unchanged: exactly one line in
        // this composable may mention the pause at all. Any second line, of any
        // shape, still fails here without this guard having heard of it.
        assertEquals(complaint, 1, consulted.size)
        // Only the tail of that one line is now open, because #228 appended the
        // reader's language to the call. A trailing argument cannot smuggle in a
        // second consultation — that is what the count above is for — and
        // pinning the whole line made a translation look like the defect this
        // test was written to catch.
        assertTrue(
            "$complaint (found: ${consulted.firstOrNull()})",
            consulted.firstOrNull()?.startsWith("val copy = enableUsCopy(fee, pause.isPaused") == true,
        )

        // ...and the block above it still hands the card the fact rather than
        // deciding for itself whether to draw it at all.
        val block = withoutComments(composable("RegistrationBlock"))
        assertTrue(
            "the enable-US card must still be reached for a CA workspace without " +
                "US texting, on the same condition as before",
            block.contains("company.country == \"CA\" && !company.us_texting_enabled"),
        )
        assertFalse(
            "and reaching it may not depend on the pause",
            block.substringBefore("EnableUsCard(").contains("pause."),
        )
    }

    /**
     * THE WORDS COME FROM THE READ'S OWN ANSWER, IN ONE PLACE.
     *
     * [PauseRead.isPaused] is true only on an ANSWERED read, which is the whole
     * reason an unanswered one is safe here. `pause.answer?.paused_at != null`
     * re-derives what the type already decided and is the expression that put a
     * green Active pill over a paused plan on the billing screen; a second call
     * site is where a fallback goes.
     */
    @Test
    fun `the branch is decided once, from the answer rather than a guess`() {
        val src = withoutComments(readMainSource(card))
        // The lookbehind drops the declaration itself, whose parameter list
        // would otherwise read as a second call site and make the count
        // meaningless.
        val callArgs = Regex("(?<!fun )enableUsCopy\\(([^)]*)\\)").findAll(src)
            .map { it.groupValues[1].trim() }
            .toList()
        assertEquals(
            "the copy is decided once, from the read's own answer",
            1,
            callArgs.size,
        )
        // `startsWith`, not equality. This pinned the whole argument list and
        // #228 broke it by appending `LocalAppLocale.current` — a reader's
        // language, which is not one of the things this guard cares about. What
        // it cares about is that the pause answer arrives HERE, from the read,
        // and nowhere else on the card; a trailing argument cannot smuggle in a
        // second consultation, and `assertFalse(paused_at)` below still refuses
        // the re-derivation that shipped as the original defect.
        assertTrue(
            "the fee and the read's own pause answer must be what words this card, " +
                "but the call reads `enableUsCopy(${callArgs.firstOrNull()})`",
            callArgs.firstOrNull()?.startsWith("fee, pause.isPaused") == true,
        )
        assertFalse(
            "`paused_at != null` re-derives what [PauseRead] already decided, and " +
                "the version of that expression this product shipped treated an " +
                "unanswered read as `not paused`",
            src.contains("paused_at"),
        )
        assertFalse(
            "`isRunning` is the wrong axis for a sentence: it is false for a read " +
                "that has not landed, so an unanswered read would draw the paused " +
                "paragraph at a workspace that is not paused",
            src.contains("isRunning"),
        )
    }

    /**
     * THE FACT IS READ, AND ONLY WHERE IT COULD CHANGE A SENTENCE.
     *
     * A card wired to a fact nobody fetches is the whole feature failing
     * silently — every assertion above passes on `paused = false` forever. So
     * the numbers screen is read for the round trip itself.
     *
     * The gate is asserted too, and not for tidiness: GET /v1/billing/pause is a
     * Stripe call behind `billing.manage`, and asking it for every member on
     * every numbers screen would be a 403 for most of them and a bill for the
     * rest. It is asked when the enable-US card is drawable and the reader can
     * press it, which is the same "only where the answer could be anything but
     * empty" rule the held-numbers read above it follows.
     */
    @Test
    fun `the numbers screen reads the pause, and hands it to the card`() {
        val src = withoutComments(readMainSource(numbers))
        assertTrue(
            "nothing fetches the pause, so the card's paused branch is dead code",
            src.contains("scope.repo.pauseState(scope.companyId)"),
        )
        assertTrue(
            "the read must be gated on the card being drawable at all — a CA " +
                "workspace without US texting",
            src.contains("company.country == \"CA\" && !company.us_texting_enabled"),
        )
        assertTrue(
            "and on the reader being able to press the button, which is the same " +
                "role that holds `billing.manage`",
            src.contains("SettingsRoleGate.canEnableUsTexting(scope.role)"),
        )
        assertTrue(
            "a failed read must land as Failed rather than as an answer — " +
                "[PauseRead.isPaused] is false either way, which leaves the card " +
                "saying what it said before this feature existed",
            src.contains("getOrElse { PauseRead.Failed }"),
        )
        assertTrue(
            "the read has to reach the card",
            Regex("RegistrationBlock\\([^)]*\\bpause\\b").containsMatchIn(src),
        )
    }

    // -- the figures ----------------------------------------------------------

    /**
     * Every money token in a string, as the reader sees it.
     *
     * Lifted from `PauseOfferTest` for the reason given there: a leading `$` is
     * not what makes a number a price, and this tree already carries CAD, so
     * `CA$41.50` and `41,50 EUR` are the ordinary shape of the next currency
     * somebody adds rather than an exotic one.
     */
    private fun moneyIn(text: String): List<String> =
        Regex("""[A-Z]{0,2}\$\s?[0-9][0-9.,]*|\b[0-9]+[.,][0-9]{2}\b""")
            .findAll(text).map { it.value.trim() }.toList()

    /**
     * THE FEE IS THE CALLER'S, TO THE CENT, IN BOTH BRANCHES.
     *
     * Run over several fees so copy that happens to agree with one fixture
     * cannot pass by coincidence — at `$7` a hardcoded `$12.75` is not the
     * expected token and this fails naming both. The paused branch is the one
     * that matters most: it is the newest prose on the card, and the sentence
     * about what waiting until spring would cost is exactly where somebody would
     * type a second figure in.
     */
    @Test
    fun `the card names no amount the workspace is not charged`() {
        listOf(oddFee, "\$7", "CA\$41.50", "\$29").forEach { fee ->
            listOf(true, false).forEach { isPaused ->
                val copy = enableUsCopy(fee, isPaused)
                var named = false
                everything(copy).forEach { (where, text) ->
                    moneyIn(text).forEach { token ->
                        named = true
                        assertEquals(
                            "$where quotes $token while the workspace is charged $fee " +
                                "(paused=$isPaused). Every figure on this card is " +
                                "[usRegistrationFee]'s, resolved from the workspace's " +
                                "own billing currency — a second one is money somebody " +
                                "agreed to without being shown the amount",
                            fee,
                            token,
                        )
                    }
                }
                assertTrue(
                    "the card must state the fee at all — an unpriced consent " +
                        "button is the failure the ban above is one half of",
                    named,
                )
            }
        }
    }

    /**
     * ...AND IT IS ON THE CONTROL, not only in the paragraph above it.
     *
     * A price shown only in the body is a price somebody presses past. The
     * button carries it whether or not the plan is paused, which is also the
     * strongest single statement that the pause withholds nothing.
     */
    @Test
    fun `the fee is on the button in both branches`() {
        listOf(true, false).forEach { isPaused ->
            assertTrue(
                "the button must carry the fee (paused=$isPaused)",
                enableUsCopy(oddFee, isPaused).buttonLabel.contains(oddFee),
            )
            assertTrue(
                "and so must the sentence somebody agrees to the charge on",
                enableUsCopy(oddFee, isPaused).confirmBody.contains(oddFee),
            )
        }
    }

    /**
     * HOW LONG THE CARRIERS TAKE IS WRITTEN ONCE.
     *
     * A paused owner deciding whether the wait fits inside their winter is doing
     * arithmetic on this number. Two spellings of it — one in the dialog, one in
     * the note directly above the button — is the reader working out which of us
     * to believe, and the drift would be invisible: both sentences would read
     * perfectly well on their own.
     *
     * Asserted as a count over the shipped literals rather than as "the constant
     * is used", because using the constant in one sentence and typing the range
     * into the other passes that weaker check.
     */
    @Test
    fun `the approval window is one figure, and every sentence quotes it`() {
        listOf(
            "the paused note" to paused().pausedNote!!,
            "the paused confirmation" to paused().confirmBody,
            "the running confirmation" to running().confirmBody,
        ).forEach { (where, text) ->
            assertTrue(
                "$where does not quote [US_APPROVAL_WINDOW]: $text",
                text.contains(US_APPROVAL_WINDOW),
            )
        }
        val literals = stringLiterals(readMainSource(card))
        assertEquals(
            "`business days` is written more than once in $card. It may exist in " +
                "exactly one literal — [US_APPROVAL_WINDOW]'s own — or the two " +
                "sentences that quote it can drift apart without either looking " +
                "wrong: ${literals.filter { it.contains("business days") }}",
            1,
            literals.count { it.contains("business days") },
        )
    }

    // -- helpers --------------------------------------------------------------

    /**
     * A function's source, from its signature to its closing brace at column 0.
     *
     * Matches `fun NAME(` rather than `private fun NAME(` so the public block and
     * the private card inside it can be read the same way.
     */
    private fun composable(name: String): String {
        val src = readMainSource(card)
        val start = src.indexOf("fun $name(")
        if (start < 0) fail("$name not found in $card")
        val end = src.indexOf("\n}\n", start)
        if (end < 0) fail("$name has no closing brace at column 0")
        return src.substring(start, end)
    }

    /**
     * Every double-quoted literal, escapes INTACT.
     *
     * The escape rule matters for the same reason `RegistrationFeeTest` gives:
     * Kotlin writes a literal dollar as `\$`, and a walker that steps over the
     * backslash hands a money scan `29` and finds nothing wrong with it.
     * Comments are stepped over, because the docblocks in the card quote the
     * copy they explain and a guard that read its own footnotes would fail on
     * correct code.
     */
    private fun stringLiterals(source: String): List<String> {
        val out = mutableListOf<String>()
        val current = StringBuilder()
        var inString = false
        var inLineComment = false
        var inBlockComment = false
        var i = 0
        while (i < source.length) {
            val ch = source[i]
            when {
                inLineComment -> if (ch == '\n') inLineComment = false
                inBlockComment ->
                    if (ch == '*' && i + 1 < source.length && source[i + 1] == '/') {
                        inBlockComment = false
                        i++
                    }

                inString -> when {
                    ch == '\\' -> {
                        current.append(ch)
                        if (i + 1 < source.length) current.append(source[i + 1])
                        i++
                    }

                    ch == '"' -> {
                        inString = false
                        out += current.toString()
                        current.clear()
                    }

                    else -> current.append(ch)
                }

                ch == '/' && i + 1 < source.length && source[i + 1] == '/' -> inLineComment = true
                ch == '/' && i + 1 < source.length && source[i + 1] == '*' -> inBlockComment = true
                ch == '"' -> inString = true
            }
            i++
        }
        return out
    }

    /**
     * Source with comments stripped and everything else left where it was.
     *
     * Comments have to go for the usual reason: they write out the shape they
     * warn against in order to explain it, so a wiring scan that read them would
     * fail on its own footnotes.
     */
    private fun withoutComments(source: String): String {
        val out = StringBuilder(source.length)
        var inString = false
        var inLineComment = false
        var inBlockComment = false
        var i = 0
        while (i < source.length) {
            val ch = source[i]
            when {
                inLineComment -> if (ch == '\n') {
                    inLineComment = false
                    out.append(ch)
                }

                inBlockComment ->
                    if (ch == '*' && i + 1 < source.length && source[i + 1] == '/') {
                        inBlockComment = false
                        i++
                    }

                inString -> {
                    out.append(ch)
                    if (ch == '\\' && i + 1 < source.length) {
                        out.append(source[i + 1])
                        i++
                    } else if (ch == '"') {
                        inString = false
                    }
                }

                ch == '/' && i + 1 < source.length && source[i + 1] == '/' -> inLineComment = true
                ch == '/' && i + 1 < source.length && source[i + 1] == '*' -> inBlockComment = true
                else -> {
                    out.append(ch)
                    if (ch == '"') inString = true
                }
            }
            i++
        }
        return out.toString()
    }

    private fun mainRoot(): File {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val dir = File(base)
            if (dir.exists()) return dir
        }
        fail("main source root not found (cwd=${File(".").absolutePath})")
        error("unreachable")
    }

    private fun readMainSource(relative: String): String {
        val f = File(mainRoot(), relative)
        if (!f.exists()) fail("source not found: $relative")
        return f.readText()
    }
}
