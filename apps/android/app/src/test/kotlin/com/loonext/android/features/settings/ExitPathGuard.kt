package com.loonext.android.features.settings

/**
 * #524 — the exit, guarded by a PROPERTY rather than by a list of mechanisms.
 *
 * WHAT IS CHECKED, IN ONE SENTENCE: nothing that has to run for the cancel
 * button to be drawn and pressed may name the pause read.
 *
 * WHY IT IS SHAPED LIKE THAT. Every guard this replaces enumerated ways to
 * disable the exit — a control with `enabled =` on it, a collapse trigger, an
 * early return — and a list can always be added to. Three escapes were applied
 * to this screen and the whole suite stayed green, because none of them was a
 * disabled control and none of them was on the list:
 *
 *  - `if (company.subscriptionActive && pause.isRunning)` at the exit's own call
 *    site, which withdraws the card entirely for the length of the read;
 *  - `if (pause is PauseRead.Loading) return` as the first statement of
 *    [CancelCard], ABOVE `SettingsCard {` — every structural check in
 *    `CancellationFlowTest` slices its window from the ROLE GATE forward, so a
 *    blocker in front of the role gate is outside every window;
 *  - `modifier = if (pause is PauseRead.Loading) Modifier.height(0.dp) else
 *    Modifier` on the button itself, which leaves it enabled, present, and zero
 *    pixels tall.
 *
 * They are not three bugs. They are one bug three times, and the twelfth will be
 * a mechanism nobody has written down yet — an alpha, a `heightIn`, a
 * `pointerInput` that swallows the tap, a `LaunchedEffect` that navigates away.
 * What every one of them has in common is not its mechanism: it is that the code
 * ON THE PATH TO THE EXIT has to consult the pause state in order to know when
 * to fire. So that is the property, and it is checked on the path rather than on
 * the mechanism. Nothing in this file needs touching to catch a new one.
 *
 * WHAT COUNTS AS THE PATH. Three regions, and they are the complete set of code
 * that must run for a thumb to reach Stripe:
 *
 *  1. the conditions still open at the `CancelCard(` call site, which decide
 *     whether the card renders at all;
 *  2. any bare `return` above that call site, which decides whether the screen
 *     gets that far;
 *  3. [CancelCard] from its first statement down to and including the button's
 *     own argument list — every statement that has to paint, and every modifier
 *     the button carries.
 *
 * Region 3 starts at the FIRST STATEMENT rather than at the role gate. That is
 * the whole of escape two: `CancellationFlowTest` measures from
 * `return@SettingsCard` forward, so the region it protects begins several
 * statements into the function and a blocker placed before it is invisible.
 *
 * THE VOCABULARY IS DERIVED, NEVER TYPED IN. A guard that greps for the word
 * `pause` is defeated by renaming a parameter, and a guard that lists
 * `isRunning`, `isPaused`, `answer` is the same enumeration mistake one level
 * down. So the words are read out of the shipped source:
 *
 *  - every extension declared on `PauseRead` and every top-level function that
 *    takes a `PauseRead` or a `PauseState`, read from `SettingsLogic.kt` — so a
 *    new consumer joins the vocabulary the day it is written;
 *  - every parameter of [CancelCard] that either DECLARES a pause type or is
 *    bound at the call site to something that carries one — so renaming the
 *    parameter changes nothing;
 *  - every local in `BillingSection` whose declaration mentions any of the
 *    above, to a fixpoint — so laundering the read through
 *    `val checking = pause is PauseRead.Loading` changes nothing either.
 *
 * The literal string `pause` is a belt on top of that, not the buckle.
 *
 * PROVEN BY BREAKING, and the proof lives with the guard: [ESCAPES] are real
 * edits to the real source, applied in `CancellationFlowTest`, each of which
 * must produce a finding. A guard that has only ever passed is unproven. Adding
 * a twelfth escape to that list is optional — it documents an attempt, it does
 * not extend the check.
 *
 * AND IT IS THE SECOND LINE NOW, NOT THE ANSWER (#524). Everything above is
 * still true and still cheap, but it is a scan, and the limit of a scan is
 * plainly stated: it sees blockers keyed on THE PAUSE READ, because that is the
 * vocabulary it derives. A blocker keyed on anything else — a flag nobody has
 * invented yet, a covering overlay that consults nothing at all — walks past it
 * untouched. [BillingPressTest] is the guard that cannot be walked past: it
 * renders this screen in all four [PauseRead] states, presses the button, and
 * requires the Stripe session to have been minted and the browser opened. Every
 * escape in the list below fails there too, and so does the one nobody has
 * thought of, because they all produce the same observable — the press did
 * nothing. Read this file as the fast, structural first opinion.
 */
internal object ExitPath {

    /** The call that puts the card carrying the exit on the screen. */
    private const val EXIT_CARD = "CancelCard("

    /**
     * The words on the button that leaves.
     *
     * Not private: [BillingPressTest] presses this button for real, and the two
     * must name the same control. Written once here because this object is the
     * thing that fails loudly when the shipped label drifts — see the check in
     * [findings] — so the press test inherits that anchor rather than carrying a
     * second copy of the string that nothing verifies.
     */
    const val EXIT_LABEL = "Continue to cancel"

    /** The two files the property is read out of. */
    const val BILLING_SECTION = "features/settings/BillingSection.kt"
    const val SETTINGS_LOGIC = "features/settings/SettingsLogic.kt"

    /**
     * One place on the path to the exit that consults the pause read.
     *
     * Carries the WORD it reached the read through, because that is what a
     * reader needs in order to see the dependency — the line alone can be a
     * `Modifier` chain with the interesting part three tokens in.
     */
    data class Finding(
        val where: String,
        val word: String,
        val line: Int,
        val text: String,
    ) {
        override fun toString(): String =
            "$where — BillingSection.kt:$line reaches the pause read through " +
                "`$word`: ${text.trim()}"
    }

    /**
     * A real defect, expressed as edits to the shipped source.
     *
     * Each edit must match EXACTLY ONCE. An anchor that has drifted makes the
     * proof vacuous rather than failing it, which is how a guard quietly stops
     * being one — so the harness asserts the count rather than calling
     * `replace` and hoping.
     */
    data class Escape(val name: String, val edits: List<Pair<String, String>>)

    val ESCAPES: List<Escape> = listOf(
        Escape(
            "a condition added to the exit's own call site",
            listOf(
                "        if (company.subscriptionActive) {\n            CancelCard(" to
                    "        if (company.subscriptionActive && pause.isRunning) {\n" +
                    "            CancelCard(",
            ),
        ),
        Escape(
            "an early return above the card's body, in front of the role gate",
            listOf(
                "    SettingsCard(title = \"Cancel\") {\n" +
                    "        if (!SettingsRoleGate.canCancelSubscription(scope.role)) {" to
                    "    if (pause is PauseRead.Loading) return\n" +
                    "    SettingsCard(title = \"Cancel\") {\n" +
                    "        if (!SettingsRoleGate.canCancelSubscription(scope.role)) {",
            ),
        ),
        Escape(
            "a modifier that leaves the button enabled and zero pixels tall",
            listOf(
                "            enabled = !opening,\n" +
                    "            onClick = {\n" +
                    "                opening = true" to
                    "            modifier = if (pause is PauseRead.Loading) " +
                    "Modifier.height(0.dp) else Modifier,\n" +
                    "            enabled = !opening,\n" +
                    "            onClick = {\n" +
                    "                opening = true",
            ),
        ),
        // The one that defeats a name scan: the read is laundered through a
        // local with an innocent name, and the exit's condition never says
        // "pause" at all. Only the taint fixpoint sees this.
        Escape(
            "the read laundered through a local before it reaches the exit",
            listOf(
                "    StatusNotices(scope, company, canManage)" to
                    "    val checking = pause is PauseRead.Loading\n" +
                    "    StatusNotices(scope, company, canManage)",
                "        if (company.subscriptionActive) {\n            CancelCard(" to
                    "        if (company.subscriptionActive && !checking) {\n" +
                    "            CancelCard(",
            ),
        ),
    )

    /**
     * The outcome of applying an escape — and the reason this is a RESULT rather
     * than a return value with an exception beside it.
     *
     * #529: `apply` used to `check()` the anchor count and throw. The throw was
     * correct and its message was clear, and it was still the wrong shape,
     * because of WHERE it surfaced: inside the loop of
     * `every escape that has walked past this file is caught by the property`.
     * So a drifted anchor turned that test red, under that name, and a reader
     * seeing it go red after making a change read it as the property catching
     * their change. Two escapes were reported as caught on that basis and neither
     * had been.
     *
     * The two failures now cannot be confused, because they are different types
     * reaching different tests with different names. Drift is not a weaker catch;
     * it is the guard telling you it has stopped being able to look.
     */
    sealed interface Applied {
        /** The escape landed. `source` is the shipped file with the defect in it. */
        data class Broken(val source: String) : Applied

        /**
         * An anchor no longer matches exactly once, so this escape proves nothing
         * about anything.
         *
         * ALWAYS EXPECTED EVENTUALLY, which is the part worth understanding: the
         * needles are anchored on the very lines a real regression edits, so the
         * first genuine change to the exit's call site or the button's argument
         * list will land here. That is not a flaw in the anchors — it is the exit
         * path changing shape, which is exactly when these proofs need re-reading
         * rather than trusting.
         */
        data class StaleAnchor(
            val escape: String,
            val needle: String,
            val occurrences: Int,
        ) : Applied {
            override fun toString(): String =
                "THIS IS NOT A CAUGHT ESCAPE — the guard has gone stale.\n\n" +
                    "The escape `$escape` no longer applies to the shipped source: " +
                    "its anchor matches $occurrences times instead of once, so " +
                    "applying it would prove nothing either way.\n\n" +
                    "These anchors sit on the lines a real regression edits, so this " +
                    "is what a genuine change to the exit path looks like from here. " +
                    "Re-anchor the edit against the new shape and check the escape " +
                    "still walks past the property — do not drop it, and do not read " +
                    "this failure as the property having caught something.\n\n" +
                    "The anchor that no longer matches:\n$needle"
        }
    }

    /** Apply an escape, reporting drift as drift rather than as a failed proof. */
    fun apply(source: String, escape: Escape): Applied {
        var out = source.replace("\r\n", "\n")
        escape.edits.forEach { (needle, replacement) ->
            val occurrences = out.split(needle).size - 1
            if (occurrences != 1) {
                return Applied.StaleAnchor(escape.name, needle, occurrences)
            }
            out = out.replace(needle, replacement)
        }
        return Applied.Broken(out)
    }

    /**
     * #529 (A9) — every `if` condition still open at the `CancelCard(` call site.
     *
     * WHY THIS EXISTS BESIDE THE PAUSE PROPERTY, which is the interesting part.
     * The property above asks whether the path to the exit consults the PAUSE
     * READ, and it is the right question for the eleven escapes that all reduced
     * to that. It cannot see A9:
     *
     *     if (company.subscriptionActive && company.plan != null) { CancelCard(
     *
     * That withdraws the cancel card permanently from a workspace with a live
     * subscription and no plan column — nothing to do with the pause read, so the
     * taint fixpoint is silent, correctly. It was reported as caught; it was not.
     * What failed was two escape anchors drifting off the line it edits.
     *
     * So this asks the other question, and asks it as an ALLOWLIST OF TWO rather
     * than a search for suspicious words. There are exactly two reasons the exit
     * may not be on screen — the reader cannot manage billing, and there is no
     * live subscription to cancel — and a third condition of any shape withdraws
     * the way out from somebody. An allowlist cannot be defeated by a mechanism
     * nobody has written down yet, which is the failure mode every list-of-bad-
     * things guard on this screen has already had.
     */
    fun exitConditions(billingSource: String): List<String> {
        val code = blank(billingSource.replace("\r\n", "\n"))
        val section = body(code, "fun BillingSection(")
        val exitCard = code.indexOf(EXIT_CARD, section.first)
        check(exitCard in section.first until section.second) {
            "the billing screen no longer calls `$EXIT_CARD` — see `findings`"
        }
        val open = ArrayDeque<String>()
        var i = section.first
        while (i < exitCard) {
            when (code[i]) {
                '{' -> open.addLast(header(code, i))
                '}' -> if (open.isNotEmpty()) open.removeLast()
            }
            i++
        }
        // Only the `if`s. A `Column(...) {` or a `SettingsCard(...) {` is layout
        // and cannot withhold the card; an `if` is the only header that decides
        // whether the call happens at all.
        return open
            .map { it.trim() }
            .filter { it.startsWith("if (") }
            .map { it.removePrefix("if (").removeSuffix(")").trim() }
    }

    /**
     * Every place on the path from arrival to the exit that consults the pause
     * read. Empty is the only acceptable answer.
     */
    fun findings(billingSource: String, logicSource: String): List<Finding> {
        val source = billingSource.replace("\r\n", "\n")
        val code = blank(source)
        val words = vocabulary(blank(logicSource.replace("\r\n", "\n")))
        val out = mutableListOf<Finding>()

        val section = body(code, "fun BillingSection(")
        val tainted = words + locals(code.substring(section.first, section.second), words)

        val exitCard = code.indexOf(EXIT_CARD, section.first)
        check(exitCard in section.first until section.second) {
            "the billing screen no longer calls `$EXIT_CARD`. Point this guard at " +
                "the new shape rather than deleting it — the property it checks is " +
                "the reason the exit is one press away"
        }

        // (1) and (2): what has to hold, and what could return, before the call.
        val open = ArrayDeque<Pair<Int, String>>()
        var i = section.first
        while (i < exitCard) {
            when (code[i]) {
                '{' -> open.addLast(i to header(code, i))
                '}' -> if (open.isNotEmpty()) open.removeLast()
            }
            // `return@label` leaves a lambda, not the screen — the read's own
            // `LaunchedEffect` legitimately does that, and it renders nothing.
            // A BARE return is the one that can skip the exit.
            if (code.startsWith("return", i) && standalone(code, i, "return".length) &&
                code.getOrNull(i + "return".length) != '@'
            ) {
                val statement = line(code, i)
                val reached = (open.map { it.second } + statement)
                    .firstNotNullOfOrNull { hit(it, tainted) }
                if (reached != null) {
                    out += Finding(
                        "a return that could skip the exit",
                        reached,
                        lineOf(source, i),
                        line(source, i),
                    )
                }
            }
            i++
        }
        open.forEach { (at, text) ->
            hit(text, tainted)?.let { word ->
                out += Finding(
                    "a condition the exit is drawn under",
                    word,
                    lineOf(source, at),
                    text,
                )
            }
        }

        // (3) the card itself, from its first statement to the button's own
        // arguments. The parameters are excluded — declaring one is not
        // consulting it, and the pause is legitimately forwarded to the answer
        // that renders BELOW the exit.
        val card = body(code, "fun CancelCard(")
        val carried = pauseCarrying(code, exitCard, tainted)
        val label = source.indexOf(EXIT_LABEL, card.first)
        check(label in card.first until card.second) {
            "the button that leaves no longer says \"$EXIT_LABEL\". Teach this guard " +
                "the new label rather than deleting it"
        }
        val seen = mutableSetOf<String>()
        identifiers(code, card.first, label + EXIT_LABEL.length).forEach { (word, at) ->
            if ((word in words || word in carried || pauseNamed(word)) && seen.add(word)) {
                out += Finding(
                    "the card's own path from its first statement to the button",
                    word,
                    lineOf(source, at),
                    line(source, at),
                )
            }
        }
        return out
    }

    // -- the vocabulary, read out of the shipped source -----------------------

    /**
     * Everything that names or consumes the pause read, derived rather than
     * listed: the two types, every extension declared on `PauseRead`, and every
     * top-level function that takes one of them.
     */
    private fun vocabulary(logic: String): Set<String> {
        val out = mutableSetOf("PauseRead", "PauseState")
        Regex("(?m)^\\s*(?:val|var)\\s+PauseRead\\.([A-Za-z_][A-Za-z0-9_]*)")
            .findAll(logic)
            .forEach { out += it.groupValues[1] }
        Regex("(?m)^fun\\s+(?:PauseRead\\.)?([A-Za-z_][A-Za-z0-9_]*)\\s*\\(")
            .findAll(logic)
            .forEach { match ->
                val open = logic.indexOf('(', match.range.first)
                val declared = logic.substring(open + 1, matchForward(logic, open))
                if (declared.contains("PauseRead") || declared.contains("PauseState")) {
                    out += match.groupValues[1]
                }
            }
        check(out.size > 2) {
            "no consumer of the pause read was found in $SETTINGS_LOGIC, so this " +
                "guard would pass on anything. The derivation, not the screen, is " +
                "what broke"
        }
        return out
    }

    /**
     * [CancelCard]'s parameters that carry the pause, whatever they are called:
     * by DECLARED TYPE, and by what the call site binds to them. The second half
     * is what makes renaming the parameter useless.
     */
    private fun pauseCarrying(code: String, exitCard: Int, tainted: Set<String>): Set<String> {
        val parameters = parameters(code, "fun CancelCard(")
        val open = code.indexOf('(', exitCard)
        val arguments = split(code.substring(open + 1, matchForward(code, open)))

        val bound = mutableMapOf<String, String>()
        var position = 0
        arguments.forEach { argument ->
            val named = Regex("^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=(?!=)([\\s\\S]*)$")
                .find(argument)
            val name = named?.groupValues?.get(1)
            if (name != null && parameters.any { it.first == name }) {
                bound[name] = named.groupValues[2]
            } else {
                parameters.getOrNull(position)?.let { bound[it.first] = argument }
                position++
            }
        }

        return parameters
            .filter { (name, type) ->
                hit(type, tainted) != null ||
                    pauseNamed(type) ||
                    bound[name]?.let { hit(it, tainted) != null || pauseNamed(it) } == true
            }
            .map { it.first }
            .toSet()
    }

    /**
     * Locals in `BillingSection` that carry the pause, to a fixpoint.
     *
     * A declaration whose type or initialiser mentions anything already tainted
     * is itself tainted, and the sweep repeats until nothing new appears. This
     * is the half that survives `val checking = pause is PauseRead.Loading`
     * followed by a condition that never says "pause".
     */
    private fun locals(section: String, seeds: Set<String>): Set<String> {
        val found = mutableSetOf<String>()
        val declaration =
            Regex("(?m)^\\s*(?:val|var)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*(:[^=\n]*)?(?:=|\\bby\\b)")
        var changed = true
        while (changed) {
            changed = false
            declaration.findAll(section).forEach { match ->
                val name = match.groupValues[1]
                if (name in found) return@forEach
                val initialiser = statement(section, match.range.last + 1)
                if (hit(match.groupValues[2] + " " + initialiser, seeds + found) != null) {
                    found += name
                    changed = true
                }
            }
        }
        return found
    }

    // -- reading Kotlin without a Kotlin parser -------------------------------

    /** True for an identifier that says so itself, whatever else is derived. */
    private fun pauseNamed(text: String) = text.contains("pause", ignoreCase = true)

    /** The first tainted identifier in a stretch of code, or null. */
    private fun hit(text: String, words: Set<String>): String? =
        Regex("[A-Za-z_][A-Za-z0-9_]*").findAll(text)
            .map { it.value }
            .firstOrNull { it in words || pauseNamed(it) }

    private fun identifiers(code: String, from: Int, to: Int): List<Pair<String, Int>> =
        Regex("[A-Za-z_][A-Za-z0-9_]*")
            .findAll(code.substring(from, to))
            .map { it.value to from + it.range.first }
            .toList()

    /**
     * The header a `{` belongs to — the whole `if (…)` including a condition
     * spread over several lines, which is the shape a one-line scan reads the
     * innocent half of.
     */
    private fun header(code: String, brace: Int): String {
        var j = brace - 1
        while (j >= 0 && code[j].isWhitespace()) j--
        if (j >= 0 && code[j] == ')') {
            var k = matchBack(code, j) - 1
            while (k >= 0 && code[k].isWhitespace()) k--
            while (k >= 0 && (code[k].isLetterOrDigit() || code[k] in "_.?@")) k--
            return code.substring(k + 1, brace)
        }
        return code.substring(code.lastIndexOf('\n', brace) + 1, brace)
    }

    /** The whole line an index sits on. */
    private fun line(text: String, at: Int): String {
        val start = text.lastIndexOf('\n', at) + 1
        val end = text.indexOf('\n', at).let { if (it < 0) text.length else it }
        return text.substring(start, end)
    }

    private fun lineOf(source: String, at: Int) =
        source.substring(0, at).count { it == '\n' } + 1

    /** True when a keyword is not part of a longer identifier. */
    private fun standalone(code: String, at: Int, length: Int): Boolean {
        val before = code.getOrNull(at - 1)
        val after = code.getOrNull(at + length)
        val part = { c: Char? -> c != null && (c.isLetterOrDigit() || c == '_') }
        return !part(before) && !part(after)
    }

    /**
     * A statement from `start`: to the end of the line, unless brackets are
     * still open or the line ends on an operator, in which case it continues.
     * Kotlin has no terminator, so this is the closest honest approximation.
     */
    private fun statement(text: String, start: Int): String {
        var depth = 0
        var i = start
        while (i < text.length) {
            when (text[i]) {
                '(', '{', '[' -> depth++
                ')', '}', ']' -> depth--
                '\n' -> if (depth <= 0) {
                    val far = text.substring(start, i).trimEnd()
                    if (far.isEmpty() || far.last() !in "&|+-*/?.,=<>:") {
                        return text.substring(start, i)
                    }
                }
            }
            i++
        }
        return text.substring(start)
    }

    /** A function's body: the index after its `{`, and the index of its `}`. */
    private fun body(code: String, signature: String): Pair<Int, Int> {
        val at = code.indexOf(signature)
        check(at >= 0) {
            "`$signature` is gone from $BILLING_SECTION. Point this guard at the new " +
                "shape rather than deleting it"
        }
        val open = code.indexOf('(', at)
        val brace = code.indexOf('{', matchForward(code, open))
        var depth = 0
        var i = brace
        while (i < code.length) {
            when (code[i]) {
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return (brace + 1) to i
                }
            }
            i++
        }
        error("`$signature` has no closing brace")
    }

    /** `name: Type` pairs from a parameter list, defaults dropped. */
    private fun parameters(code: String, signature: String): List<Pair<String, String>> {
        val at = code.indexOf(signature)
        val open = code.indexOf('(', at)
        return split(code.substring(open + 1, matchForward(code, open))).mapNotNull { raw ->
            val declared = raw.substringBefore('=')
            val name = declared.substringBefore(':').trim()
            if (name.isEmpty()) null else name to declared.substringAfter(':', "").trim()
        }
    }

    /** Split on the commas that are not inside brackets. */
    private fun split(list: String): List<String> {
        val out = mutableListOf<String>()
        var depth = 0
        var start = 0
        list.forEachIndexed { i, ch ->
            when (ch) {
                '(', '{', '[' -> depth++
                ')', '}', ']' -> depth--
                ',' -> if (depth == 0) {
                    out += list.substring(start, i)
                    start = i + 1
                }
            }
        }
        if (list.substring(start).isNotBlank()) out += list.substring(start)
        return out
    }

    private fun matchForward(text: String, open: Int): Int {
        var depth = 0
        var i = open
        while (i < text.length) {
            when (text[i]) {
                '(' -> depth++
                ')' -> {
                    depth--
                    if (depth == 0) return i
                }
            }
            i++
        }
        error("unbalanced parentheses from index $open")
    }

    private fun matchBack(text: String, close: Int): Int {
        var depth = 0
        var i = close
        while (i >= 0) {
            when (text[i]) {
                ')' -> depth++
                '(' -> {
                    depth--
                    if (depth == 0) return i
                }
            }
            i--
        }
        error("unbalanced parentheses back from index $close")
    }

    /**
     * The source with comment bodies and string contents replaced by spaces,
     * LENGTH AND LINE BREAKS PRESERVED so every index still points at the same
     * place in the original.
     *
     * Both have to go for the same reason the older guards in this package strip
     * comments: a docblock explains the shape it forbids by writing it out, and
     * copy on this screen contains the word "pause" in three sentences. A scan
     * that read either would fail on correct code, and a guard softened until it
     * stops doing that is a guard that catches nothing. Blanking the CONTENTS
     * rather than deleting the span keeps `{` and `}` counts honest, including
     * the braces inside `${…}` templates.
     */
    private fun blank(source: String): String {
        val out = source.toCharArray()
        var i = 0
        while (i < source.length) {
            val ch = source[i]
            when {
                ch == '/' && source.getOrNull(i + 1) == '/' -> {
                    while (i < source.length && source[i] != '\n') out[i++] = ' '
                }

                ch == '/' && source.getOrNull(i + 1) == '*' -> {
                    val end = source.indexOf("*/", i + 2)
                        .let { if (it < 0) source.length else it + 2 }
                    while (i < end) {
                        if (source[i] != '\n') out[i] = ' '
                        i++
                    }
                }

                source.startsWith("\"\"\"", i) -> {
                    val end = source.indexOf("\"\"\"", i + 3)
                        .let { if (it < 0) source.length else it }
                    i += 3
                    while (i < end) {
                        if (source[i] != '\n') out[i] = ' '
                        i++
                    }
                    i = minOf(source.length, end + 3)
                }

                ch == '"' -> {
                    i++
                    while (i < source.length && source[i] != '"') {
                        if (source[i] == '\\') {
                            out[i] = ' '
                            i++
                        }
                        if (i < source.length && source[i] != '\n') out[i] = ' '
                        i++
                    }
                    i++
                }

                // A char literal is at most four characters wide (`'A'` is
                // the long one), so the scan is bounded: a stray apostrophe in
                // code cannot swallow the rest of the file.
                ch == '\'' -> {
                    val end = source.indexOf('\'', i + 1)
                    if (end in (i + 1)..(i + 8)) {
                        while (i <= end) out[i++] = ' '
                    } else {
                        i++
                    }
                }

                else -> i++
            }
        }
        return String(out)
    }
}
