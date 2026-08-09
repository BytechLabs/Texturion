package com.loonext.android.features.settings

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #581/#7 — where the six digits in front of a handover are CHECKED, pinned as a
 * source lint.
 *
 * There are three confirmation kinds and two of them say word for word the same
 * sentence. What differs is the mechanism: the authenticator wall's digits travel with
 * the retry and our server checks them, while `mfa_reprove_required` is not asking for
 * digits at all — it is asking how long ago this session proved a factor. Those digits
 * are proved against Supabase HERE, whose fresh session stamps a new proof time, and
 * the action is then retried carrying no code.
 *
 * Post them to our API instead and the identical refusal comes back forever, because
 * nothing on that route reads a code: the dialog tells the owner their own correct code
 * is wrong, every time, and they cannot hand over their own business. That shipped once,
 * green, because every test asserted the WORDING and the MAPPING and not one asserted
 * where the digits go. This is the one that asserts where the digits go.
 *
 * A source lint rather than a call: [attemptHandover] needs a real [SettingsScope],
 * which carries the whole [com.loonext.android.AppGraph] and cannot be built in a unit
 * test — the repo's answer to exactly that problem, same shape as
 * `telephony/ClientHangupLintTest`.
 */
class HandoverGateTest {

    @Test
    fun `the funnel asks the shared rule where the digits go, and does not name a kind`() {
        val src = readMainSource("features/settings/HandoverGate.kt")

        // One statement of the rule, in HandoverConfirmation, read by every client. The
        // gate holds no second opinion — there were three copies of this rule once and
        // one of them was wrong, which is the entire reason it now lives in one place.
        assertTrue(
            "HandoverGate must read the destination off " +
                "HandoverConfirmation.goesToOurApi(...); nothing here may work it out",
            src.contains("HandoverConfirmation.goesToOurApi("),
        )
        assertTrue(
            "HandoverGate must not re-derive the destination by naming a kind: a " +
                "`Kind.REPROVE` comparison here is a fourth copy of the rule, and a " +
                "fourth kind would be sorted by whichever side the expression favoured",
            !src.contains("Kind.REPROVE"),
        )

        // And the branch must divert when the digits are NOT ours, which is the
        // direction of the whole thing. An inverted guard reads fine and posts every
        // reprove code straight at an endpoint that is not reading one.
        val asks = Regex("""HandoverConfirmation\.goesToOurApi\(""").findAll(src).toList()
        for (ask in asks) {
            assertTrue(
                "the destination question at offset ${ask.range.first} is not negated. " +
                    "In this file the only reason to ask is \"these digits are not ours, " +
                    "prove them here\", so the diverting branch is the negative one. If " +
                    "you invert it deliberately, the attempt carrying the code must move " +
                    "inside its true branch and this lint must be updated with it.",
                src.substring(0, ask.range.first).trimEnd().endsWith("!"),
            )
        }
    }

    @Test
    fun `no path sends a code to our API when that code belongs to Supabase`() {
        val src = readMainSource("features/settings/HandoverGate.kt")

        val calls = Regex("""proof\.attempt\(([^)]*)\)""").findAll(src).toList()
        assertTrue("the funnel must still run the action it was handed", calls.isNotEmpty())

        // The retry after a local proof carries NOTHING — that is what makes it work.
        assertTrue(
            "no attempt runs the action without a code, so the Supabase path either " +
                "does not exist or is still posting digits at a route that ignores them",
            calls.any { it.groupValues[1].trim() == "null" },
        )

        // The API-checked kinds (the authenticator wall, and the emailed code) still
        // send theirs, so an attempt carrying a code is expected — every one of them
        // just has to have asked about the destination first.
        val carryingCode = calls.filter { it.groupValues[1].trim() != "null" }
        assertTrue(
            "nothing carries a code any more; the authenticator and email paths need it",
            carryingCode.isNotEmpty(),
        )
        val funDecl = Regex("""\bfun\s+(\w+)\s*\(""")
        for (call in carryingCode) {
            // The nearest preceding `fun name(` is the enclosing function, so what sits
            // between the two is everything that ran before this call.
            val declaration = funDecl.findAll(src.substring(0, call.range.first)).lastOrNull()
            val ran = src.substring(declaration?.range?.first ?: 0, call.range.first)
            assertTrue(
                "`proof.attempt(${call.groupValues[1].trim()})` inside " +
                    "`fun ${declaration?.groupValues?.get(1)}` is reached without asking " +
                    "where those digits are checked. On the reprove path our server is " +
                    "not reading a code at all — it is reading how long ago this session " +
                    "proved a factor — so posting them returns the same refusal forever " +
                    "and the owner is told their correct code is wrong every time.",
                ran.contains("HandoverConfirmation.goesToOurApi("),
            )
        }
    }

    /**
     * The Supabase path has to be REACHED, not merely present.
     *
     * The three assertions around this one all pass with the diverting branches deleted
     * and `proveFactorThenRetry` left behind as an unused private function: the
     * destination is still asked, every ask is still negated, `proof.attempt(null)`
     * still appears — inside the function nothing calls any more — and Kotlin only warns
     * about the dead code, which neither build file promotes to an error. Every reprove
     * code would then go to our API, and the lint would say so was fine.
     *
     * Proximity is not control flow. This is the difference.
     */
    @Test
    fun `the funnel actually calls the Supabase path, and returns its answer`() {
        val src = readMainSource("features/settings/HandoverGate.kt")
        val body = attemptHandoverBody(src)

        val calls = Regex("""proveFactorThenRetry\(""").findAll(body).toList()
        assertTrue(
            "`attemptHandover` never calls proveFactorThenRetry — the Supabase path " +
                "exists in this file but nothing reaches it, so every code goes to our " +
                "API and the assertions above all still pass",
            calls.isNotEmpty(),
        )
        for (call in calls) {
            assertTrue(
                "the call to proveFactorThenRetry at offset ${call.range.first} is not " +
                    "returned. Discarding its outcome lets execution fall through to the " +
                    "attempt that carries the code, which is the same bug with the fix " +
                    "sitting one line above it.",
                body.substring(0, call.range.first).trimEnd().endsWith("return"),
            )
        }
    }

    /**
     * Everything between `attemptHandover`'s declaration and the next top-level one.
     *
     * The visibility modifiers matter: an earlier version of this stopped only at
     * `internal`/plain `fun`, ran straight past `private suspend fun
     * proveFactorThenRetry(` and then failed on that DECLARATION for not being preceded
     * by `return`. A body-extractor that overshoots reads the neighbouring function's
     * text as this one's.
     */
    private fun attemptHandoverBody(src: String): String {
        val start = src.indexOf("suspend fun attemptHandover(")
        assertTrue("attemptHandover is gone from this file", start >= 0)
        val next = Regex(
            """^(?:private |internal |public )?(?:suspend )?fun |^@Composable""",
            RegexOption.MULTILINE,
        ).find(src.substring(start + 1))
        return if (next == null) {
            src.substring(start)
        } else {
            src.substring(start, start + 1 + next.range.first)
        }
    }

    @Test
    fun `the Supabase path proves the factor, SAVES the session, then retries with nothing`() {
        val src = readMainSource("features/settings/HandoverGate.kt")

        val steps = listOf(
            "challengeFactor(" to "ask Supabase for a challenge",
            "verifyFactor(" to "answer it with the six digits",
            "sessionStore.save(" to "SAVE the fresh session that comes back",
            "proof.attempt(null)" to "retry the action carrying no code",
        )
        val offsets = steps.map { (needle, what) ->
            val at = src.indexOf(needle)
            assertTrue("the Supabase path never gets to $what — no `$needle` here", at >= 0)
            needle to at
        }
        for ((earlier, later) in offsets.zipWithNext()) {
            assertTrue(
                "`${later.first}` must come after `${earlier.first}`. Saving the session " +
                    "is not optional and not reorderable: the fresh token is what carries " +
                    "the new proof time, so a retry that runs before the save presents the " +
                    "old token and is refused exactly as it was the first time.",
                earlier.second < later.second,
            )
        }

        // A code Supabase refused has to leave the dialog UP, saying so once — the same
        // thing a code our own API refused does. Closing it would strand somebody who
        // simply mistyped, and a second, different message would tell whoever is
        // guessing which of their digits were right.
        assertTrue(
            "a refused local proof must come back as NeedsCode(kind, refused = true) so " +
                "the dialog stays up with the same one message",
            Regex("""NeedsCode\(\s*kind\s*,\s*refused\s*=\s*true\s*\)""").containsMatchIn(src),
        )
    }

    /**
     * The funnel decides off `proof.kind`, so every screen has to hand it the kind the
     * server actually named. Two do it by giving the held proof straight back; the
     * third rebuilds its proof on every press and has to carry the kind across
     * deliberately.
     *
     * Named per file rather than derived, because there are three of them and each
     * answers this differently — the same reason `check-sign-out-path` names its native
     * call sites. Every entry is re-checked: a file that has moved fails loudly instead
     * of quietly stopping being covered.
     */
    @Test
    fun `every screen that answers a demand hands the funnel the kind the server named`() {
        val screens = listOf(
            Triple(
                "features/settings/OwnershipCard.kt",
                "attempt(pending, code)",
                "the dialog is rendered from the HELD proof and gives that same value " +
                    "back, so the kind the server named travels with the digits",
            ),
            Triple(
                "features/settings/OwnershipPrompt.kt",
                "attempt(pending, code)",
                "the dialog is rendered from the HELD proof and gives that same value " +
                    "back, so the kind the server named travels with the digits",
            ),
            Triple(
                "features/settings/NumbersSection.kt",
                "kind = proof?.kind",
                "this screen REBUILDS its proof inside every attempt rather than " +
                    "handing the held one back, so the kind has to be carried across " +
                    "explicitly. Left at the default it says EMAIL, the funnel sends a " +
                    "stale-factor code to us where nothing reads it, and the dialog " +
                    "answers every correct code with \"that code didn't work\"",
            ),
        )
        for ((file, marker, why) in screens) {
            val src = readMainSource(file)
            assertTrue(
                "$file no longer calls attemptHandover(, so this entry is checking a " +
                    "screen that has moved. Update the list rather than dropping it — a " +
                    "surface nobody checks is how the third one was missed.",
                src.contains("attemptHandover("),
            )
            assertTrue("$file must contain `$marker`: $why", src.contains(marker))
        }
    }

    private fun readMainSource(relative: String): String {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val f = File("$base/$relative")
            if (f.exists()) return f.readText()
        }
        fail("source not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }
}
