package com.loonext.android.core.contacts

import com.loonext.android.core.i18n.AppStrings
import java.util.Locale

/**
 * #248 — the contract both bulk contact importers have to satisfy, hand-ported
 * from `packages/shared/src/contact-import.ts`.
 *
 * A crew arriving from another tool meets this importer on their first day, and
 * two halves of it had drifted apart from the server without anything noticing.
 *
 * The BOUNDS were never written down here at all: this app promised "2 MB or
 * less" from a figure typed into a sentence, sitting next to a constant typed
 * into a file, sitting next to the server's own. A client that promises a file
 * will import and a server that refuses it is a broken promise made at the
 * worst possible moment.
 *
 * The ATTESTATION field was written down once, on the server. #226 (edfa044)
 * made `consent_attested` mandatory on CSV import and no client ever sent it,
 * so every CSV import from this app 422'd against a field name the UI had no
 * control for — and the only bulk door that still worked was the vCard one,
 * which asked nothing.
 *
 * `ContactImportTest` reads the TypeScript and fails if any of this drifts.
 */
object ContactImport {

    /**
     * The multipart field carrying the importer's consent attestation. Only the
     * literal [CONSENT_VALUE] passes the server's gate: a field that also
     * accepts "false" is not an attestation, it is a field.
     */
    const val CONSENT_FIELD = "consent_attested"

    /** The one value [CONSENT_FIELD] may carry. */
    const val CONSENT_VALUE = "true"

    /**
     * #248 ROUND 3 — the field a caller repeats ONCE PER COLUMN, saying what
     * every column of the file is.
     *
     * NOT AN ACKNOWLEDGEMENT OF A REFUSAL, which is what round two shipped and
     * what this replaced. That field was sent only for the columns the server had
     * just complained about, so the shortest path to a 200 was: post, read the
     * column names out of the 422, post again — two round trips and no human,
     * which was demonstrated live. A COMPLETE declaration removes the loop rather
     * than policing it: there is nothing to learn from a refusal, because the
     * caller already has the file and its header row before it sends anything.
     *
     * Repeated rather than one delimited value because a header may contain
     * anything, commas included. That repetition is why the field builders below
     * return a LIST: a `Map<String, String>` cannot say the same name twice, so
     * the shape this app used to post in could not have expressed the answer.
     */
    const val COLUMN_FIELD = "column"

    /** The same thing at the vCard door, once per property the cards carry. */
    const val VCARD_PROPERTY_FIELD = "property"

    /** Rows one CSV import may carry — bounds URL sizes and Worker CPU. */
    const val MAX_ROWS = 2000

    /** Bytes of CSV text one import may carry. */
    const val MAX_BYTES = 2L * 1024 * 1024

    /** Cards one .vcf may carry — the same CPU bound as the CSV row cap. */
    const val VCARD_MAX_CARDS = MAX_ROWS

    /** Bytes of vCard text one import may carry. Bigger: a card is verbose. */
    const val VCARD_MAX_BYTES = 5L * 1024 * 1024

    /**
     * The form fields a CSV import posts.
     *
     * NEITHER ARGUMENT HAS A DEFAULT, and that is the whole safety property of
     * this function. [attested] is somebody else's phone number arriving in a
     * shared inbox and [columns] is somebody's statement about what the file
     * says; a default on either would let a caller reach the import route
     * without anybody having answered. There is no value this app may supply on
     * a person's behalf, so it supplies none.
     *
     * Returns NO attestation when the importer has not attested, rather than
     * failing locally with a message of our own. The server owns that gate — it
     * is the same refusal for a phone, a browser and a script — and a client that
     * answers it locally is a client that can be argued out of it.
     *
     * An EMPTY [columns] is legal and means "declaring nothing", which the server
     * refuses for any file that has columns. That is deliberate: it is how a file
     * with no readable header row, or one over the row cap, reaches the server
     * and comes back with the sentence that actually explains it.
     */
    fun csvFields(attested: Boolean, columns: List<String>): List<Pair<String, String>> =
        buildList {
            if (attested) add(CONSENT_FIELD to CONSENT_VALUE)
            columns.forEach { add(COLUMN_FIELD to it) }
        }

    /**
     * The form fields a vCard import posts — the same rule in the shape that
     * format allows. One field per property the cards carry that the importer
     * does not read; empty when they carry none.
     */
    fun vcardFields(attested: Boolean, properties: List<String>): List<Pair<String, String>> =
        buildList {
            if (attested) add(CONSENT_FIELD to CONSENT_VALUE)
            properties.forEach { add(VCARD_PROPERTY_FIELD to it) }
        }

    /**
     * "…and 12 more." under a row list, or null when the list is whole.
     *
     * [total] is the server's own COUNT and [listed] is how many rows this
     * screen actually drew, which are two different facts even though the first
     * import to ship them made them look like one. #248 round 2 found the count
     * and the list being assembled independently on the server, so a list
     * truncated for any reason would print "40 refused" over five rows with
     * nothing saying the rest existed. The server now derives one from the other
     * and guards it; this derives the overflow from the COUNT anyway, because
     * the screen that would tell the lie is this one, and a refusal names a
     * person this workspace must not text.
     *
     * Pure, and out of the Compose file, because Compose is not unit-testable in
     * this module — an arithmetic claim nothing can run is a claim nothing can
     * check.
     */
    fun overflowLine(total: Int, listed: Int, locale: String? = null): String? {
        val hidden = total - listed
        return if (hidden > 0) {
            AppStrings.translate(
                locale,
                "contactsTasks.importAndMore",
                mapOf("count" to hidden.toString()),
            )
        } else {
            null
        }
    }

    /**
     * "Up to 2,000 rows, 2 MB." — both figures derived, neither typed.
     *
     * #228: one KEY per door rather than one sentence with the unit slotted in,
     * because the two caps differ and a sentence quoting the CSV cap at a vCard
     * promises a file the server refuses. The unit is inside the sentence so
     * French can say "Mo".
     */
    fun limitsLine(kind: ContactImportKind, locale: String? = null): String =
        AppStrings.translate(
            locale,
            kind.limitsKey,
            mapOf(
                "count" to grouped(kind.maxEntries),
                "size" to megabytes(kind.maxBytes),
            ),
        )

    /**
     * Said when the picked file is over the cap, before anything uploads —
     * the phone can refuse it without spending the customer's data on a body
     * the server will reject anyway.
     */
    fun tooLargeMessage(kind: ContactImportKind, locale: String? = null): String =
        AppStrings.translate(
            locale,
            kind.tooLargeKey,
            mapOf("size" to megabytes(kind.maxBytes)),
        )

    /**
     * #248 — the heading over the rows whose attestation the server refused.
     *
     * The server sends its own sentence about what a refusal MEANS, and that
     * sentence is rendered verbatim beside this one. This says only how BIG it
     * is, because a count is the one thing a sentence written before the import
     * cannot know and the first thing anybody asks.
     *
     * Derived from the server's number rather than typed, so a report can never
     * say "3 customers" over four rows.
     */
    fun consentRefusedHeadline(count: Int, locale: String? = null): String =
        AppStrings.translate(
            locale,
            if (count == 1) {
                "contactsTasks.importOptedOutOne"
            } else {
                "contactsTasks.importOptedOutMany"
            },
            mapOf("count" to count.toString()),
        )

    private fun grouped(count: Int): String = String.format(Locale.US, "%,d", count)

    /**
     * The megabyte figure alone.
     *
     * The UNIT lives in the sentence rather than here, because "MB" is "Mo" in
     * French — a number formatted with its unit baked in is a number no
     * catalogue entry can translate.
     */
    private fun megabytes(bytes: Long): String = "${bytes / (1024L * 1024L)}"

    /**
     * What the attestation sheet says.
     *
     * It lives beside the field it guards so the sentence somebody agrees to
     * and the value that gets posted cannot be changed independently of each
     * other — the wording IS the claim, and a claim whose wording drifts from
     * what it authorises is worse than no claim.
     *
     * #228: these are catalogue KEYS, not sentences. `t()` is @Composable and
     * this object is not, so the key travels and the sheet resolves it — the
     * pairing the docblock above is about is preserved, because the key and the
     * field it guards still live in the same object.
     */
    object Copy {
        const val TITLE = "contactsTasks.importBeforeTitle"

        const val LEAD = "contactsTasks.importBeforeLead"

        /**
         * THE CLAIM. Never pre-ticked, on any surface: a consent box that
         * arrives already agreed to is not an attestation, and this is the one
         * control in the app where a smart default would be a lie.
         */
        const val ATTESTATION = "contactsTasks.importAttestation"

        /**
         * What ticking it actually writes. The server records the attestation
         * only where there is no basis yet and leaves an existing one alone, so
         * saying "we record it for everyone" would be the older, wrong story.
         */
        const val RECORDED = "contactsTasks.importRecorded"

        /** The primary action — it opens the file picker, it does not upload. */
        const val CONTINUE = "contactsTasks.importChooseFile"

        const val CANCEL = "common.cancel"
    }

    /**
     * #248 — what the app says when the server refuses a whole file.
     *
     * That refusal is several sentences of prose written for a person, and this
     * app was putting it in a Snackbar — truncated to a line and a half, gone in
     * four seconds, with no way back to it. The one refusal in the product that
     * somebody MUST read in full was the one they could not.
     */
    object Refusal {
        /**
         * Said above the server's own sentence.
         *
         * "Not imported" rather than "import failed": nothing is broken and
         * nothing landed, and the difference decides whether somebody's next
         * move is to check what arrived or to fix the file.
         */
        const val TITLE = "contactsTasks.importRefusedTitle"

        /** Dismisses. There is nothing to retry until the file or the answer changes. */
        const val CLOSE = "common.close"

        /**
         * The way back into the per-column step, offered only for a file this app
         * managed to read.
         *
         * Several of the server's refusals are answered by declaring the columns
         * differently — no column was declared `phone`, or the wrong one was
         * declared the do-not-text column — and re-picking the file to change one
         * answer is how somebody decides to go and use a laptop instead. It
         * re-opens the same question rather than resending the same answer:
         * every retry is a complete declaration made again by a person.
         */
        const val EDIT_COLUMNS = "contactsTasks.importRefusedEdit"
    }

    /**
     * #248 ROUND 3 — the per-column step. Every column of the file, answered
     * before anything is uploaded.
     *
     * NOT A REVIEW OF WHAT WE DROPPED, which is what round two asked and what
     * made this a defect twice. There is no shape test and no vocabulary deciding
     * which columns are worth asking about, because the two attempts at that
     * question both shipped and both ended with a message delivered to somebody
     * who had said stop. Every column is asked about, including the ones this
     * import recognised and the ones that are empty.
     */
    object Columns {
        const val TITLE = "contactsTasks.importColumnsTitle"

        /**
         * WHY they are being asked, naming the consequence rather than the
         * mechanism. "We did not recognise these" invites "so skip them", which
         * is the behaviour that caused #248 in the first place.
         */
        const val LEAD = "contactsTasks.importColumnsLead"

        /**
         * THE CONSEQUENCE OF A WRONG ANSWER, on the path to the button rather
         * than above the list: this is the last thing read before committing.
         *
         * The answer it names is DERIVED from the control's own label rather than
         * retyped beside it — the catalogue sentence carries a `{answer}` slot and
         * [wrongColumn] fills it from [actionLabel]. A sentence telling somebody to
         * choose an option that is no longer called that is worse than no sentence:
         * it reads as a bug in the moment somebody is deciding whether to text a
         * person who said stop.
         */
        const val WRONG_COLUMN = "contactsTasks.importWrongColumn"

        /** [WRONG_COLUMN], with the do-not-text answer's own label in it. */
        fun wrongColumn(locale: String? = null): String = AppStrings.translate(
            locale,
            WRONG_COLUMN,
            mapOf("answer" to actionLabel(ImportColumns.FIELD_OPTED_OUT, locale)),
        )

        /** Enabled only once every column has an answer. */
        const val CONFIRM = "contactsTasks.importConfirm"

        const val CANCEL = "common.cancel"

        /** Shown while anything is unanswered, so the disabled button has a reason. */
        const val UNANSWERED_HINT = "contactsTasks.importUnansweredColumns"

        /**
         * The two groups the list is split into, and the order is the point: the
         * work is in the columns nobody has spoken for, so they come first.
         *
         * The split is by what the DETECTOR recognised, which never changes while
         * the sheet is open — grouping by what is answered right now would make
         * cards jump between sections under the finger that just answered them.
         *
         * #228: these two travel as KEYS on `ImportColumns.SheetRow.heading`, and
         * the sheet resolves them where it draws them.
         */
        const val NEEDS_ANSWER = "contactsTasks.importNotRecognised"

        const val RECOGNISED = "contactsTasks.importRecognisedHeading"

        /**
         * Said when a person has given two columns the same job. The server
         * refuses that file ("a contact has one"), so catching it here only ever
         * saves a round trip — it cannot let anything through.
         */
        fun duplicateHint(action: String, locale: String? = null): String =
            AppStrings.translate(
                locale,
                "contactsTasks.importDuplicateHint",
                mapOf("answer" to actionLabel(action, locale)),
            )

        /** What an unanswered column's control says. */
        const val CHOOSE = "contactsTasks.importChoose"

        /** "Column 3" — 1-based, matching how the server names a column at fault. */
        fun positionLabel(index: Int, locale: String? = null): String =
            AppStrings.translate(
                locale,
                "contactsTasks.importColumnPosition",
                mapOf("number" to "${index + 1}"),
            )

        /**
         * The header as the file spelled it, quoted so its spaces are visible —
         * they have to find this exact string in their own spreadsheet.
         *
         * A nameless column is named by its position instead and is asked about
         * like any other. Round two withheld these from the person because its
         * field matched columns BY NAME and there was no answer that would work;
         * the declaration is by INDEX, so there is now an answer, and a cell past
         * the end of the header row — `Phone,Name` over `+1206…,Ann,DO NOT CALL`
         * — arrives here as a column with no name and gets asked about.
         */
        fun headerLabel(header: String, locale: String? = null): String =
            if (header.isBlank()) {
                AppStrings.translate(locale, "contactsTasks.importColumnNoHeader")
            } else {
                AppStrings.translate(
                    locale,
                    "contactsTasks.importColumnQuoted",
                    mapOf("header" to header),
                )
            }

        /**
         * "Values include: DO NOT CALL, OK, and 12 more" — what a header alone
         * will not tell you, and the reason this screen exists at all.
         *
         * "include" rather than "holds", because these are the first
         * [ImportColumns.SAMPLE_LIMIT] distinct values and claiming to have listed
         * the column would be a claim nobody checked. THE HEDGE WAS NOT ENOUGH ON
         * ITS OWN: it admitted there might be more without saying how many, so a
         * column with nine answers and one with four hundred read identically, and
         * neither said where to find the rest. [showAllValuesLabel] is the other
         * half — a count nobody can act on is a better-worded dead end.
         */
        fun valuesLine(
            samples: List<String>,
            total: Int = samples.size,
            locale: String? = null,
        ): String =
            if (samples.isEmpty()) {
                AppStrings.translate(locale, "contactsTasks.importValuesEmpty")
            } else {
                val hidden = total - samples.size
                val more = if (hidden > 0) {
                    AppStrings.translate(
                        locale,
                        "contactsTasks.importValuesAndMore",
                        mapOf("count" to hidden.toString()),
                    )
                } else {
                    ""
                }
                AppStrings.translate(
                    locale,
                    "contactsTasks.importValuesInclude",
                    mapOf("samples" to samples.joinToString(", ")),
                ) + more
            }

        /** The control that puts every value a column holds on the screen. */
        fun showAllValuesLabel(total: Int, locale: String? = null): String =
            AppStrings.translate(
                locale,
                "contactsTasks.importShowAllValues",
                mapOf("count" to total.toString()),
            )

        /** The control that puts an expanded column back to its first few values. */
        const val SHOW_FEWER_VALUES_LABEL = "contactsTasks.importShowFewerValues"

        /**
         * What an expanded column says when even the full list is cut.
         *
         * Said rather than left to be inferred, because somebody believing a list
         * is complete when it is not is the same defect as "and more" wearing a
         * longer list. It states the two numbers and stops: how many answers a
         * column has is NOT a rule about what the column means.
         */
        fun valueCeilingNote(shown: Int, total: Int, locale: String? = null): String =
            AppStrings.translate(
                locale,
                "contactsTasks.importValueCeiling",
                mapOf("shown" to shown.toString(), "total" to total.toString()),
            )

        /**
         * "4 of 7 answered".
         *
         * It starts at whatever the detector recognised rather than at zero,
         * because it is telling the truth about work already done — and a
         * progress line that opens at 0% on a screen that is one third complete
         * is the reason people abandon the flow.
         */
        fun progressLine(answered: Int, total: Int, locale: String? = null): String =
            AppStrings.translate(
                locale,
                "contactsTasks.importProgress",
                mapOf("answered" to answered.toString(), "total" to total.toString()),
            )

        /**
         * What each answer is called. Every action in ImportColumns.ACTIONS has one.
         *
         * Four of the eight reach for the FIELD labels the contact record already
         * uses — a column called "Address" here and "Adresse" on the record it
         * lands in would be two names for one thing.
         */
        fun actionLabel(action: String, locale: String? = null): String = when (action) {
            "phone" -> AppStrings.translate(locale, "contactsTasks.importActionPhone")
            "name" -> AppStrings.translate(locale, "contactsTasks.nameField")
            "first_name" ->
                AppStrings.translate(locale, "contactsTasks.importActionFirstName")
            "last_name" ->
                AppStrings.translate(locale, "contactsTasks.importActionLastName")
            "address" -> AppStrings.translate(locale, "contactsTasks.address")
            "notes" -> AppStrings.translate(locale, "contactsTasks.notesField")
            "opted_out" ->
                AppStrings.translate(locale, "contactsTasks.importActionOptedOut")
            ImportColumns.ACTION_IGNORE ->
                AppStrings.translate(locale, "contactsTasks.importActionIgnore")
            // Never reached while ACTIONS and this function agree, and
            // `ContactImportTest` fails the moment they do not. Printing the raw
            // token beats printing nothing: a mystery blank control is worse to
            // meet than an ugly one.
            else -> action
        }
    }

    /**
     * #248 ROUND 3 — the vCard door's version of the same question.
     *
     * `CATEGORIES:DNC`, a `NOTE` saying they asked us to stop, and a label like
     * `X-ABLabel=DO NOT CALL` on the TEL line are where a .vcf says do-not-text.
     * They are what Apple and Google actually export, and this door had no gate
     * of any kind.
     */
    object Properties {
        const val TITLE = "contactsTasks.importPropertiesTitle"

        const val LEAD = "contactsTasks.importPropertiesLead"

        /**
         * WHAT A NAME WITH A `;` IN IT IS, shown only when one is in the list.
         *
         * Half the names on this sheet are now parameters, and `TEL;TYPE` is not
         * a word — somebody meeting it with no explanation cannot answer it, and
         * the honest answer to a question you do not understand is to pick the
         * one that makes the sheet go away. The server's own refusal explains the
         * `;` for the same reason; this says it before the refusal, not after.
         *
         * Named after the shape rather than the example, because the example is
         * whatever their phone happened to write.
         */
        const val PARAMETER_NOTE = "contactsTasks.importParameterNote"

        /**
         * The coarseness, stated rather than discovered. It is genuinely blunt —
         * a `CATEGORIES` of "Friends" is blocked alongside one of "DNC" — and
         * somebody should know that before they choose it rather than after.
         *
         * Names the option by DERIVING its label, for the same reason
         * [Columns.WRONG_COLUMN] does.
         */
        const val COARSE = "contactsTasks.importPropertiesCoarse"

        /** [COARSE], with the blocking answer's own label in it. */
        fun coarse(locale: String? = null): String = AppStrings.translate(
            locale,
            COARSE,
            mapOf("answer" to actionLabel(VCardProperties.ACTION_OPTED_OUT, locale)),
        )

        const val CONFIRM = "contactsTasks.importConfirm"

        const val CANCEL = "common.cancel"

        const val UNANSWERED_HINT = "contactsTasks.importUnansweredProperties"

        const val CHOOSE = ContactImport.Columns.CHOOSE

        fun actionLabel(action: String, locale: String? = null): String = when (action) {
            VCardProperties.ACTION_IGNORE ->
                AppStrings.translate(locale, "contactsTasks.importPropertyIgnore")
            VCardProperties.ACTION_OPTED_OUT ->
                AppStrings.translate(locale, "contactsTasks.importPropertyOptedOut")
            else -> action
        }
    }
}

/**
 * Which bulk door an import is going through, with everything that differs
 * between them attached to it: the caps the server enforces, the word it uses
 * to label a skipped entry in its per-row errors, and what importing can and
 * cannot do to somebody who has said STOP.
 */
enum class ContactImportKind(
    /** Rows (CSV) or cards (.vcf) the server accepts in one file. */
    val maxEntries: Int,
    /** Bytes of file text the server accepts in one import. */
    val maxBytes: Long,
    /**
     * How the server's per-entry errors are labelled in the report sheet.
     *
     * #228: a catalogue KEY. A .vcf reports CARD numbers, and a refusal list
     * saying "Row 12" over a vCard import points at a line the file has not —
     * so this stays attached to the KIND, in whatever language it is read in.
     */
    val rowWord: String,
    /** The limits sentence for this door — its own, because the caps differ. */
    val limitsKey: String,
    /** What this door says when the picked file is over its cap. */
    val tooLargeKey: String,
    /**
     * The opt-out truth for this door, which is genuinely different on each.
     * An import can only ever ADD a block: the CSV path revives a REVOKED
     * opt-out and inserts new ones, and neither path can clear an active one.
     *
     * STOP is a carrier keyword and is never translated in either sentence.
     */
    val optOutNote: String,
) {
    CSV(
        maxEntries = ContactImport.MAX_ROWS,
        maxBytes = ContactImport.MAX_BYTES,
        rowWord = "contactsTasks.importRowWordRow",
        limitsKey = "contactsTasks.importLimitsCsv",
        tooLargeKey = "contactsTasks.importTooLargeCsv",
        optOutNote = "contactsTasks.importOptOutNoteCsv",
    ),
    VCARD(
        maxEntries = ContactImport.VCARD_MAX_CARDS,
        maxBytes = ContactImport.VCARD_MAX_BYTES,
        rowWord = "contactsTasks.importRowWordCard",
        limitsKey = "contactsTasks.importLimitsVcard",
        tooLargeKey = "contactsTasks.importTooLargeVcard",
        // #248 round 3: a .vcf CAN now say it, in the one place the format
        // allows — a property somebody declared do-not-text blocks every card
        // carrying it. The old wording ("a .vcf carries no opt-out column") was
        // true of the parser and false of the format, which is how CATEGORIES:DNC
        // came to be dropped in silence.
        optOutNote = "contactsTasks.importOptOutNoteVcard",
    ),
}
