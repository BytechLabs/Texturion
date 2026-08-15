package com.loonext.android.features.settings

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MemberRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #277 — the cancel screen, and the rule it is built against.
 *
 * The rule is that cancelling must never take more steps or more time than
 * subscribing did, the reason must be skippable, and a broken analytics write
 * must never be able to stop somebody leaving. Every one of those is a WIRING
 * property of a composable, which a unit test cannot raise — so the half of
 * this file that matters is source lints, in the
 * [com.loonext.android.ImeContractLintTest] idiom that
 * [PortRejectionWiringTest] also uses.
 *
 * Each lint below fails if the specific dark pattern it names is introduced,
 * which is the only reason a lint of this kind earns its place.
 *
 * One of them is load-bearing in a way the others are not. A lint that scans
 * for one shape of blocker proves nothing about a blocker of another shape:
 * the `enabled =` scan below stayed green through a version of this card whose
 * exit was two taps away, because the blocker was an early return rather than
 * a disabled control. `the way out is on the card from the first frame` reads
 * the card's structure instead, and it is the one to extend when a new way of
 * standing in front of the exit is invented.
 */
class CancellationFlowTest {

    private val billingSection = "features/settings/BillingSection.kt"
    private val repository = "features/settings/SettingsRepository.kt"

    // -- the reason codes, which are a cross-client contract ------------------

    /**
     * The codes land in the database and every count is grouped by them, so all
     * three clients must send the same six strings. A client that invented
     * `too-expensive` would not error anywhere; it would quietly open a seventh
     * bucket that nobody notices until a report is read out loud.
     */
    @Test
    fun `the six reasons are the agreed codes, in the agreed order`() {
        assertEquals(
            listOf(
                "too_expensive",
                "seasonal",
                "missing_feature",
                "switched",
                "not_using",
                "other",
            ),
            CANCELLATION_REASONS.map { it.code },
        )
        assertEquals(
            listOf(
                "Too expensive",
                "Quiet season, I'll be back",
                "Missing something I need",
                "Going with something else",
                "Not using it",
                "Something else",
            ),
            CANCELLATION_REASONS.map { AppStrings.en[it.labelKey] },
        )
    }

    /** The API trims then caps `reason` at 40; a longer code is a silent 422. */
    @Test
    fun `every code fits the API ceiling and is a distinct snake_case token`() {
        val codes = CANCELLATION_REASONS.map { it.code }
        assertEquals("codes must be distinct", codes.size, codes.toSet().size)
        codes.forEach { code ->
            assertTrue("$code is over the API's 40-char ceiling", code.length <= 40)
            assertTrue("$code is not snake_case", Regex("^[a-z][a-z_]*$").matches(code))
        }
    }

    // -- the statement -------------------------------------------------------

    @Test
    fun `skipping the question is a real statement with nothing in it`() {
        // The body this produces is `{}`, which the API documents as "they were
        // asked and did not answer" rather than as a malformed call. It is still
        // worth sending: silence is a measurement.
        val skipped = cancellationStatement(null, "")
        assertNull(skipped.reason)
        assertNull(skipped.detail)
    }

    @Test
    fun `a box opened and left alone stores the same row as one never touched`() {
        assertNull(cancellationStatement("other", "   ").detail)
        assertEquals("too much", cancellationStatement("other", "  too much  ").detail)
    }

    /**
     * Over-length is a 422, and the record is deliberately never awaited — so an
     * unclamped body would fail INVISIBLY. The person cancels, the screen
     * behaves perfectly, and the paragraph they took the trouble to write is
     * simply never stored.
     */
    @Test
    fun `detail is clamped to the ceiling rather than being refused at it`() {
        val long = "x".repeat(CANCELLATION_DETAIL_MAX + 500)
        assertEquals(CANCELLATION_DETAIL_MAX, cancellationStatement(null, long).detail!!.length)
        assertEquals(2000, CANCELLATION_DETAIL_MAX)
        assertEquals(40, CANCELLATION_REASON_MAX)
    }

    // -- who is actually offered it ------------------------------------------

    /**
     * POST /v1/billing/portal mints the full portal for an owner and a
     * `payment_method_update` session for everybody else, and that flow has no
     * cancellation surface. Offering the button to a bookkeeper would send them
     * to a page with no such button on it.
     */
    @Test
    fun `only the owner is offered the cancellation`() {
        assertTrue(SettingsRoleGate.canCancelSubscription(MemberRole.OWNER))
        assertFalse(SettingsRoleGate.canCancelSubscription(MemberRole.ADMIN))
        assertFalse(SettingsRoleGate.canCancelSubscription(MemberRole.BOOKKEEPER))
        assertFalse(SettingsRoleGate.canCancelSubscription(MemberRole.MEMBER))
        assertFalse(SettingsRoleGate.canCancelSubscription(null))
        // The bookkeeper still holds billing generally — the two questions are
        // different, and collapsing them is what would hide the card entirely.
        assertTrue(SettingsRoleGate.canManageBilling(MemberRole.BOOKKEEPER))
    }

    // -- the wiring the rule actually lives in --------------------------------

    @Test
    fun `nothing on the screen may disable the way out`() {
        val body = cancelCard()
        // The trap this pins is "Continue" greyed out until a reason is picked.
        // Only the request already in flight may ever disable a control here.
        Regex("enabled\\s*=\\s*([^,\n]*)").findAll(body).forEach { match ->
            val expression = match.groupValues[1]
            assertFalse(
                "a control in CancelCard is gated on the reason ($expression) - " +
                    "the way through must never depend on answering",
                expression.contains("reason") || expression.contains("detail"),
            )
        }
        assertTrue(
            "the continue button must be enabled except while opening",
            body.contains("enabled = !opening"),
        )
    }

    /**
     * #228 — the key and the words behind it have to stay one thing.
     *
     * Since the extraction there are two anchors for one button:
     * [ExitPath.EXIT_KEY] is how every SOURCE guard here finds it, and
     * [ExitPath.EXIT_LABEL] is what [BillingPressTest] taps by rendered text.
     * Nothing else ties them together — so a rename of the English behind the
     * key would leave every lint in this file green while the press test hunted
     * for a button that no longer says that, which is the failure mode this
     * whole file exists to refuse.
     *
     * English rather than French deliberately: the press test renders with no
     * locale provided, and [AppStrings.translate] answers English there.
     */
    @Test
    fun `the exit's key and the words the press test taps are the same button`() {
        assertEquals(
            "the button that leaves renders something other than ExitPath.EXIT_LABEL",
            ExitPath.EXIT_LABEL,
            AppStrings.translate(null, ExitPath.EXIT_KEY),
        )
        // And the key really resolves: a typo would fall back to the key itself,
        // which is a string that would pass a looser assertion than this one.
        assertTrue(
            "the exit's key is not in the catalogue at all",
            AppStrings.en.containsKey(ExitPath.EXIT_KEY),
        )
    }

    /**
     * THE guard for this card, and the one the shipped defect walked straight
     * past.
     *
     * What blocked the exit was never a disabled button. It was an early
     * `return@SettingsCard` behind an `expanded` flag: one tap to open the card,
     * a second to leave. Every `enabled =` lint in this file was green the whole
     * time it was there, because there was nothing wrong with any `enabled =`.
     * A regex hunting for the wrong shape of blocker is not a guard, it is
     * reassurance.
     *
     * So this one reads the card's SHAPE instead. From the point the owner's
     * half begins, nothing may stand between the card rendering and the button
     * that leaves: no second early return, no conditional statement, no flag
     * that has to be flipped first. The number that has to hold is one action
     * from landing on the billing screen, which is what the "Manage payment &
     * invoices" button beside it costs.
     */
    @Test
    fun `the way out is on the card from the first frame, with nothing tapped first`() {
        val body = cancelCard()

        // Everything after the owner check, which is the one legitimate early
        // return here: a bookkeeper is told who can cancel instead, because the
        // portal their role mints has no cancellation surface on it at all.
        val gate = body.indexOf("!SettingsRoleGate.canCancelSubscription")
        assertTrue("the owner check must still open the card", gate > 0)
        val gateReturn = body.indexOf("return@SettingsCard", gate)
        assertTrue("the owner check must still return early", gateReturn > gate)
        val confirm = body.indexOf(ExitPath.EXIT_KEY)
        assertTrue("the card must still carry the button that leaves", confirm > gateReturn)

        val toTheExit = body.substring(gateReturn + "return@SettingsCard".length, confirm)

        assertFalse(
            "a second early return between the owner check and the way out is the " +
                "collapse trigger come back: one tap to reveal the card, another to " +
                "leave",
            toTheExit.contains("return@SettingsCard"),
        )
        listOf("expanded", "showSheet", "ModalBottomSheet", "AnimatedVisibility").forEach { word ->
            assertFalse(
                "`$word` in CancelCard means the way out sits behind something that " +
                    "has to be opened first",
                body.contains(word),
            )
        }
        toTheExit.lines().forEach { line ->
            val statement = line.trim()
            assertFalse(
                "a conditional statement stands between the card rendering and the " +
                    "way out: `$statement`. Everything down to the button must paint " +
                    "on the first frame",
                statement.startsWith("if (") || statement.startsWith("if(") ||
                    statement.startsWith("when (") || statement.startsWith("when(") ||
                    statement.startsWith("} else"),
            )
        }

        // And the button is a direct statement of the card, not a child of
        // something wrapped around it. Brace depth is the property that holds
        // here: a lambda that opens and closes on the way to the button nets
        // zero, while anything still open when the button is reached nets one
        // or more, and that open brace is what a re-introduced trigger is.
        //
        // The indentation check below says the same thing and is easier to read
        // in a failure message, but it can be walked past by wrapping the button
        // without re-indenting its body, and nothing in this module's Gradle
        // config would force the re-indent: there is no ktlint, detekt or
        // spotless here. So the brace count is the one that has to be right.
        val depth = withoutStringsOrComments(toTheExit)
            .fold(0) { acc, ch -> if (ch == '{') acc + 1 else if (ch == '}') acc - 1 else acc }
        assertEquals(
            "the way out is nested $depth level(s) inside something that opens " +
                "between the card and the button. It has to be a direct child of " +
                "the card, painted on the first frame",
            0,
            depth,
        )

        val cardIndent = Regex("(?m)^([ \\t]*)if \\(!SettingsRoleGate").find(body)
            ?.groupValues?.get(1)?.length ?: -1
        assertTrue("could not read the card's own statement indentation", cardIndent > 0)
        val leaveButton = Regex("(?m)^([ \\t]*)Button\\(").findAll(body)
            .lastOrNull { it.range.first < confirm }
        assertTrue(
            "could not find the leave button's declaration. If it was reformatted, " +
                "teach this guard the new shape rather than deleting it",
            leaveButton != null,
        )
        assertEquals(
            "the button that leaves is nested inside something. It has to be a direct " +
                "child of the card, rendered unconditionally",
            cardIndent,
            leaveButton!!.groupValues[1].length,
        )
    }

    /**
     * #524 — THE PROPERTY, WHICH REPLACES THE ENUMERATION ABOVE.
     *
     * Every guard in this file up to this line names a MECHANISM: a control with
     * `enabled =` on it, an `expanded` flag, a `ModalBottomSheet`, a second
     * `return@SettingsCard`, a brace that stays open. Each one is real and each
     * one stays. But a list of mechanisms is a list, and a list can always be
     * added to — three escapes were applied to this exact screen and every test
     * here stayed green, because none of them was on it:
     *
     *  - `&& pause.isRunning` on the exit's own call site, which is not a
     *    control at all;
     *  - `if (pause is PauseRead.Loading) return` placed ABOVE `SettingsCard {`,
     *    which is in front of the role gate every window here measures from;
     *  - `Modifier.height(0.dp)` on the button, which leaves it enabled,
     *    present, and invisible.
     *
     * WHAT THIS ASSERTS INSTEAD, in one sentence: nothing that has to run for
     * the cancel button to be drawn and pressed may name the pause read. That is
     * a property of the code on the path rather than of any mechanism, so the
     * twelfth escape — an alpha, a `heightIn`, a `pointerInput` that eats the
     * tap — fails here without this test being touched. See [ExitPath] for how
     * the path and the vocabulary are derived.
     *
     * WHY THE PAUSE SPECIFICALLY. It is the only asynchronous fact this screen
     * reads, and it is a Stripe round trip. Anything on the way to the exit that
     * waits on it turns a slow billing route into a person who cannot cancel,
     * which is the exact failure the whole card is built against, re-created by
     * the feature that was meant to be an alternative to leaving.
     *
     * AND IT IS STILL A SCAN, WHICH IS WHY IT IS NO LONGER THE ANSWER. It reads
     * source and derives a vocabulary; a blocker keyed on something other than
     * the pause is outside that vocabulary and outside this test. The guard that
     * cannot be walked past is [BillingPressTest], which renders this screen and
     * PRESSES the button in every state the read can be in. This one stays
     * because it is cheap, it runs without a device, and it fails at the line
     * that introduced the problem rather than at the effect that went missing.
     */
    @Test
    fun `nothing on the way to the exit consults the pause read`() {
        assertEquals(
            "the way out now depends on the pause read. Reaching Stripe having " +
                "answered nothing is ONE press from landing on this screen, and it " +
                "may not wait on, be hidden by, or be shrunk by a billing round " +
                "trip. Whatever this reads, move it off the path — the pause is an " +
                "answer rendered BELOW the button, never a condition in front of it",
            emptyList<ExitPath.Finding>(),
            ExitPath.findings(
                readMainSource(ExitPath.BILLING_SECTION),
                readMainSource(ExitPath.SETTINGS_LOGIC),
            ),
        )
    }

    /**
     * ...AND THE GUARD ABOVE IS PROVEN BY BREAKING IT, EVERY RUN.
     *
     * A guard that has only ever passed is unproven. Each entry in
     * [ExitPath.ESCAPES] is a real edit to the real shipped source — the three
     * that walked past this file, plus one that launders the read through a
     * plainly-named local so a scan for the word "pause" would not see it — and
     * every one of them has to be reported.
     *
     * The edits are applied by exact match and the count is asserted, so an
     * anchor that drifts FAILS rather than quietly making the proof vacuous.
     * That is the failure mode this style of harness actually has.
     *
     * #529: and it is now a SEPARATE failure from this one. Drift used to throw
     * from inside this loop, turning this test red under this name — so a reader
     * who had just changed the exit path saw "every escape ... is caught by the
     * property FAILED" and read it as their change being caught. Two escapes were
     * reported as caught on exactly that basis and neither had been. The test
     * below owns drift; this one refuses to speak about it.
     */
    @Test
    fun `every escape that has walked past this file is caught by the property`() {
        val billing = readMainSource(ExitPath.BILLING_SECTION)
        val logic = readMainSource(ExitPath.SETTINGS_LOGIC)
        ExitPath.ESCAPES.forEach { escape ->
            val applied = ExitPath.apply(billing, escape)
            if (applied is ExitPath.Applied.StaleAnchor) {
                // Not `fail(...)` with the proof's own wording: this test's name
                // is about the property catching things, and the one thing this
                // failure must never be mistaken for is a catch. The message says
                // so in its first line.
                throw AssertionError(applied.toString())
            }
            val findings = ExitPath.findings(
                (applied as ExitPath.Applied.Broken).source,
                logic,
            )
            assertTrue(
                "`${escape.name}` walks past the exit-path property. It is a real " +
                    "defect applied to the real source, so a guard that stays silent " +
                    "on it is decorative",
                findings.isNotEmpty(),
            )
        }
    }

    /**
     * #529 — the guard's own staleness, asked about by name.
     *
     * The escapes above are textual edits anchored on the lines a real regression
     * edits, so the FIRST genuine change to the exit's call site or the button's
     * argument list drifts them. That is not a defect in the anchors; it is the
     * exit path changing shape. But it has to announce itself as that.
     *
     * Before this test, the only place drift could surface was inside the proof
     * loop, and a red proof loop reads as a catch. Now there is a test whose NAME
     * is the diagnosis, so the two are told apart in the run output rather than in
     * the stack trace nobody opens.
     */
    /**
     * #529 (A9) — the OTHER reason the exit can vanish, which the pause property
     * is structurally unable to see.
     *
     * The adversary added `&& company.plan != null` to the exit's call site. That
     * withdraws the cancel card permanently from a workspace with a live
     * subscription and no plan column, and it mentions the pause read nowhere — so
     * the taint fixpoint stayed silent, correctly, because it is answering a
     * different question. It was reported as caught. What actually happened is that
     * two escape anchors sit on the line it edits, and their drift turned the proof
     * loop red.
     *
     * So: an ALLOWLIST OF TWO, not a search for suspect conditions. There are
     * exactly two reasons this card may be absent — the reader cannot manage
     * billing, and there is no live subscription to cancel — and any third
     * condition, of any shape, takes the way out away from somebody. A list of
     * forbidden conditions could always be added to; a list of the two permitted
     * ones cannot be walked past.
     */
    @Test
    fun `only two conditions may stand between arrival and the exit`() {
        val open = ExitPath.exitConditions(readMainSource(ExitPath.BILLING_SECTION))
        assertEquals(
            "a condition was added between landing on the billing screen and the " +
                "card that carries the way out. Only two may stand there: whether " +
                "the reader can manage billing, and whether there is a live " +
                "subscription to cancel. Anything else withdraws the exit from " +
                "somebody permanently, and no notice anywhere says it has happened.",
            listOf("canManage", "company.subscriptionActive"),
            open,
        )
    }

    /**
     * AND NOTHING MAY STAND BETWEEN PRESSING IT AND STRIPE.
     *
     * The test above answers whether the card is on screen. This answers the
     * question one layer in, which is where every check on this screen was blind:
     * a button can be drawn, enabled, opaque, full height and hit-testable while
     * its handler opens with `if (exporting) return` and does nothing. Not one
     * assertion about the button changes. The press is simply silent, which is the
     * worst way for a way out to fail — the person pressing it cannot tell.
     *
     * The allowlist is EMPTY, and that is not strictness for its own sake: the card
     * only exists when the reader can manage billing and there is a live
     * subscription, so by the time this button is on screen both questions are
     * already answered. `opening` belongs on `enabled`, where the button says
     * "Opening…" and a person can see it.
     */
    @Test
    fun `nothing may stand between pressing the exit and reaching stripe`() {
        val press = ExitPath.press(readMainSource(ExitPath.BILLING_SECTION))
        assertEquals(
            "a condition was added inside the handler that reaches Stripe. Every " +
                "check on this button — drawn, enabled, opaque, hit-testable — " +
                "passes while a guard here makes the press do nothing at all. The " +
                "state of an export, or of anything else, is not a reason to " +
                "withhold the way out; if the request is already in flight, say so " +
                "on the button.",
            emptyList<String>(),
            press.conditions,
        )
        assertEquals(
            "a `return` was added above the handoff to Stripe. It leaves both the " +
                "portal request and the browser open where any search for them " +
                "finds them, and unreachable — which is the same silent press by a " +
                "different route.",
            emptyList<String>(),
            press.returns,
        )
        assertTrue(
            "the portal session is minted and never opened, so the press ends in " +
                "nothing while every mirror on it still passes",
            press.opens,
        )
    }

    /**
     * The guard above, proved by breaking it.
     *
     * A guard that has only ever passed is a guard nobody has tested. Each escape
     * below is applied to the real source, scoped to `CancelCard` so a mutation
     * cannot land in some other card and report a hole that is not there — the way
     * the iOS twin's first simulation did.
     */
    @Test
    fun `the press guard catches every way to silence the press`() {
        val real = readMainSource(ExitPath.BILLING_SECTION)
        val card = real.indexOf("private fun CancelCard(")
        val anchor = real.indexOf("opening = true", card)
        assertTrue("the press no longer starts by marking the request in flight", anchor > card)

        fun escape(inserted: String): String =
            real.substring(0, anchor) + inserted + real.substring(anchor)

        // THE TWO SHAPES ARE CAUGHT BY DIFFERENT FIELDS, and getting that wrong is
        // how a guard passes for the wrong reason. A guard CLAUSE closes before the
        // handoff, so nothing is open at it and `conditions` is rightly empty — the
        // `return` is what makes it an escape. A WRAPPING condition is still open at
        // the handoff and carries no `return` at all.

        // Guard clause, braced.
        val clause = ExitPath.press(
            escape("if (exporting) {\n            return@Button\n        }\n        ")
        )
        assertTrue("a braced guard clause walked past", clause.returns.isNotEmpty())

        // Guard clause, brace-LESS and on one line — which brace-tracking cannot
        // see and a bare-return test would not match either. This is the shape
        // Kotlin makes easiest to write, so it is the one that had to be covered.
        val inline = ExitPath.press(escape("if (exporting) return@Button\n        "))
        assertTrue("a one-line guard clause walked past", inline.returns.isNotEmpty())

        // No condition at all — just a way out.
        val bare = ExitPath.press(escape("return@Button\n        "))
        assertTrue("a bare return above the handoff walked past", bare.returns.isNotEmpty())

        // A wrapping condition: no `return` anywhere, the handoff simply does not
        // happen. This is the one `conditions` exists for.
        val handoffPair =
            "val hosted = scope.repo.billingPortal(scope.companyId)\n" +
                "                        openExternal(context, hosted.url)"
        assertTrue(
            "the handoff pair this escape wraps has been reshaped — re-anchor it",
            real.contains(handoffPair),
        )
        val wrapped = ExitPath.press(
            real.replace(
                handoffPair,
                "if (!exporting) {\n" +
                    "                        $handoffPair\n" +
                    "                        }",
            )
        )
        assertTrue("a condition wrapping the handoff walked past", wrapped.conditions.isNotEmpty())

        // And the baseline is clean, so the three above are catching the escape
        // rather than something that was already there.
        val baseline = ExitPath.press(real)
        assertEquals(emptyList<String>(), baseline.conditions)
        assertEquals(emptyList<String>(), baseline.returns)
        assertTrue(baseline.opens)
    }

    @Test
    fun `every escape still anchors to the shipped source`() {
        val billing = readMainSource(ExitPath.BILLING_SECTION)
        val stale = ExitPath.ESCAPES
            .map { ExitPath.apply(billing, it) }
            .filterIsInstance<ExitPath.Applied.StaleAnchor>()
        assertTrue(
            "the exit path has changed shape and ${stale.size} of " +
                "${ExitPath.ESCAPES.size} escapes can no longer be applied to it. " +
                "Nothing has been caught and nothing has been proven — re-anchor " +
                "them, then confirm each still walks past the property. " +
                stale.joinToString(separator = "; "),
            stale.isEmpty(),
        )
    }

    @Test
    fun `no reason is pre-selected`() {
        assertTrue(
            "a default answer is not an answer anybody gave",
            cancelCard()
                .contains("var reason by rememberSaveable { mutableStateOf<String?>(null) }"),
        )
    }

    /**
     * A rotation, a switch to dark mode, or the system reclaiming the activity
     * recreates this screen. Plain `remember` is gone by then, so the paragraph
     * somebody wrote at us on their way out would vanish mid-sentence with
     * nothing on screen to explain it. `rememberSaveable` is house style in this
     * codebase for exactly this.
     */
    @Test
    fun `what somebody typed survives the screen being recreated`() {
        assertTrue(
            "the free-text note must be saveable, not merely remembered",
            cancelCard().contains("var detail by rememberSaveable { mutableStateOf(\"\") }"),
        )
    }

    /**
     * The comment on the field says it stops at the ceiling. A length check that
     * drops the edit does the opposite: paste a long paragraph and the whole
     * thing is refused, with no counter and no message to say why.
     */
    @Test
    fun `the note truncates a long paste rather than refusing it`() {
        val body = cancelCard()
        assertTrue(
            "house shape is `.take(MAX)`, the same as the contact and address fields",
            body.contains("detail = it.take(CANCELLATION_DETAIL_MAX)"),
        )
        assertFalse(
            "a length guard that assigns nothing throws away everything somebody " +
                "pasted and says nothing about it",
            body.contains("if (it.length <="),
        )
    }

    /**
     * Six `selectable` rows with `RadioButton(onClick = null)` and nothing else
     * are announced as six unrelated tappable lines: no "1 of 6", no group. This
     * is the one card in the app being judged on how hard it is to leave, so it
     * is the last place a screen-reader user should have to guess.
     */
    @Test
    fun `the six rows are announced as one group of radio buttons`() {
        val body = cancelCard()
        assertTrue(
            "without selectableGroup the rows are not a group to TalkBack",
            body.contains("Modifier.selectableGroup()"),
        )
        assertTrue(
            "without the role each row is announced as a generic selectable item",
            body.contains("role = Role.RadioButton"),
        )
    }

    @Test
    fun `there is no second dialog between the screen and Stripe`() {
        val body = cancelCard()
        assertFalse(
            "an 'are you sure' step here is the friction the rule forbids",
            body.contains("AlertDialog") || body.contains("ConfirmDialog"),
        )
    }

    /**
     * The load-bearing lint. If the reason POST is ever awaited on the path to
     * the portal, a dead endpoint or a slow one becomes a person who cannot
     * cancel — which is the exact failure this whole screen exists to avoid.
     */
    @Test
    fun `the reason is recorded off the handoff path, and started before it`() {
        val body = cancelCard()
        val calls = Regex("recordCancellationReason").findAll(body).count()
        assertEquals("exactly one call site in the card", 1, calls)

        val record = body.indexOf("recordCancellationReason")
        val preceding = body.substring(maxOf(0, record - 300), record)
        assertTrue(
            "the record must be fired on the process-lifetime scope: a screen-" +
                "scoped one dies when the browser comes forward, and awaiting it " +
                "would put an analytics write in front of a cancellation",
            preceding.contains("appScope.launch"),
        )
        assertTrue(
            "and it must be started before the handoff, not after it - the " +
                "browser takes the screen away",
            record < body.indexOf("billingPortal"),
        )
    }

    @Test
    fun `the export offer and the confirm button are on the same card`() {
        val body = cancelCard()
        val export = body.indexOf("exportLauncher.launch(")
        val confirm = body.indexOf(ExitPath.EXIT_KEY)
        assertTrue("the cancel card must offer the contacts export", export > 0)
        assertTrue("and the confirm button lives on the same card", confirm > 0)
        assertTrue(
            "the export is offered before the way out, so the last thing somebody " +
                "sees before the handoff is their own customer list rather than a " +
                "link they will never come back for",
            export < confirm,
        )
    }

    @Test
    fun `the rows come from the shared list rather than a second copy`() {
        assertTrue(
            "a hardcoded list here would drift from the codes the API stores",
            cancelCard().contains("CANCELLATION_REASONS.forEach"),
        )
    }

    /**
     * The route answers 204 No Content. A typed helper would try to decode an
     * empty body and throw on a call that had in fact succeeded.
     */
    @Test
    fun `the 204 route is called through raw, not a decoding helper`() {
        val src = readMainSource(repository)
        val fn = src.substringAfter("suspend fun recordCancellationReason")
            .substringBefore("\n    /**")
        assertTrue(
            "recordCancellationReason must go through ApiClient.raw",
            fn.contains("api.raw("),
        )
        assertTrue(fn.contains("\"/v1/billing/cancellation-reason\""))
    }

    // -- helpers -------------------------------------------------------------

    /** The CancelCard composable's source, from its signature to its brace. */
    private fun cancelCard(): String {
        val src = readMainSource(billingSection)
        val start = src.indexOf("private fun CancelCard(")
        if (start < 0) fail("CancelCard not found in $billingSection")
        val end = src.indexOf("\n}\n", start)
        if (end < 0) fail("CancelCard has no closing brace at column 0")
        return src.substring(start, end)
    }

    /**
     * Kotlin source with string literals and line comments blanked out, so a
     * brace inside copy or inside a `${'$'}{...}` template does not read as a block
     * that opened. Only the braces the compiler sees are left behind.
     */
    private fun withoutStringsOrComments(source: String): String {
        val out = StringBuilder(source.length)
        var inString = false
        var inComment = false
        var i = 0
        while (i < source.length) {
            val ch = source[i]
            when {
                inComment -> if (ch == '\n') { inComment = false; out.append(ch) }
                inString -> {
                    // A backslash escape cannot end the literal, so step over it.
                    if (ch == '\\') i++ else if (ch == '"') inString = false
                }
                ch == '/' && i + 1 < source.length && source[i + 1] == '/' -> inComment = true
                ch == '"' -> inString = true
                else -> out.append(ch)
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
