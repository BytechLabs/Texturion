package com.loonext.android.core.contacts

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
    fun overflowLine(total: Int, listed: Int): String? {
        val hidden = total - listed
        return if (hidden > 0) "…and $hidden more." else null
    }

    /** "Up to 2,000 rows, 2 MB." — both figures derived, neither typed. */
    fun limitsLine(kind: ContactImportKind): String =
        "Up to ${grouped(kind.maxEntries)} ${kind.unitPlural}, ${megabytes(kind.maxBytes)}."

    /**
     * Said when the picked file is over the cap, before anything uploads —
     * the phone can refuse it without spending the customer's data on a body
     * the server will reject anyway.
     */
    fun tooLargeMessage(kind: ContactImportKind): String =
        "${kind.fileWord} files must be ${megabytes(kind.maxBytes)} or less."

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
    fun consentRefusedHeadline(count: Int): String {
        val noun = if (count == 1) "customer" else "customers"
        return "$count $noun in this file had already opted out"
    }

    private fun grouped(count: Int): String = String.format(Locale.US, "%,d", count)

    private fun megabytes(bytes: Long): String = "${bytes / (1024L * 1024L)} MB"

    /**
     * What the attestation sheet says.
     *
     * It lives beside the field it guards so the sentence somebody agrees to
     * and the value that gets posted cannot be changed independently of each
     * other — the wording IS the claim, and a claim whose wording drifts from
     * what it authorises is worse than no claim.
     */
    object Copy {
        const val TITLE = "Before you import"

        const val LEAD =
            "You are about to upload other people's phone numbers into this workspace."

        /**
         * THE CLAIM. Never pre-ticked, on any surface: a consent box that
         * arrives already agreed to is not an attestation, and this is the one
         * control in the app where a smart default would be a lie.
         */
        const val ATTESTATION =
            "Everyone in this file agreed to be texted by this business."

        /**
         * What ticking it actually writes. The server records the attestation
         * only where there is no basis yet and leaves an existing one alone, so
         * saying "we record it for everyone" would be the older, wrong story.
         */
        const val RECORDED =
            "For anyone with no consent recorded yet, this is stored as your " +
                "attestation. Contacts who already have one keep it."

        /** The primary action — it opens the file picker, it does not upload. */
        const val CONTINUE = "Choose file"

        const val CANCEL = "Cancel"
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
        const val TITLE = "This file was not imported"

        /** Dismisses. There is nothing to retry until the file or the answer changes. */
        const val CLOSE = "Close"

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
        const val EDIT_COLUMNS = "Change columns"
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
        const val TITLE = "What is in this file?"

        /**
         * WHY they are being asked, naming the consequence rather than the
         * mechanism. "We did not recognise these" invites "so skip them", which
         * is the behaviour that caused #248 in the first place.
         */
        const val LEAD =
            "This import does not guess what a column means — a do-not-contact " +
                "column read as nothing texts somebody who asked this business " +
                "to stop. Say what each column is, or ignore it on purpose."

        /**
         * THE CONSEQUENCE OF A WRONG ANSWER, on the path to the button rather
         * than above the list: this is the last thing read before committing.
         *
         * The answer it names is DERIVED from the control's own label rather than
         * retyped beside it. A sentence telling somebody to choose an option that
         * is no longer called that is worse than no sentence — it reads as a bug
         * in the moment somebody is deciding whether to text a person who said
         * stop.
         */
        val WRONG_COLUMN =
            "If a column marks who must not be texted, choose " +
                "“${actionLabel(ImportColumns.FIELD_OPTED_OUT)}” — ignoring it " +
                "would text everyone it was protecting."

        /** Enabled only once every column has an answer. */
        const val CONFIRM = "Import"

        const val CANCEL = "Cancel"

        /** Shown while anything is unanswered, so the disabled button has a reason. */
        const val UNANSWERED_HINT =
            "Every column needs an answer before this file can import."

        /**
         * The two groups the list is split into, and the order is the point: the
         * work is in the columns nobody has spoken for, so they come first.
         *
         * The split is by what the DETECTOR recognised, which never changes while
         * the sheet is open — grouping by what is answered right now would make
         * cards jump between sections under the finger that just answered them.
         */
        const val NEEDS_ANSWER = "Not recognised"

        const val RECOGNISED = "Recognised — change any that are wrong"

        /**
         * Said when a person has given two columns the same job. The server
         * refuses that file ("a contact has one"), so catching it here only ever
         * saves a round trip — it cannot let anything through.
         */
        fun duplicateHint(action: String): String =
            "Two columns are both marked “${actionLabel(action)}”. A contact has one."

        /** What an unanswered column's control says. */
        const val CHOOSE = "Choose…"

        /** "Column 3" — 1-based, matching how the server names a column at fault. */
        fun positionLabel(index: Int): String = "Column ${index + 1}"

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
        fun headerLabel(header: String): String =
            if (header.isBlank()) "(no header)" else "“$header”"

        /**
         * "Values include: DO NOT CALL, OK" — what a header alone will not tell
         * you, and the reason this screen exists at all.
         *
         * "include" rather than "holds": these are the first
         * [ImportColumns.SAMPLE_LIMIT] distinct values, and claiming to have
         * listed the column would be a claim nobody checked.
         */
        fun valuesLine(samples: List<String>): String =
            if (samples.isEmpty()) {
                "Every row leaves this column empty."
            } else {
                "Values include: ${samples.joinToString(", ")}"
            }

        /**
         * "4 of 7 answered".
         *
         * It starts at whatever the detector recognised rather than at zero,
         * because it is telling the truth about work already done — and a
         * progress line that opens at 0% on a screen that is one third complete
         * is the reason people abandon the flow.
         */
        fun progressLine(answered: Int, total: Int): String = "$answered of $total answered"

        /** What each answer is called. Every action in ImportColumns.ACTIONS has one. */
        fun actionLabel(action: String): String = when (action) {
            "phone" -> "Phone number"
            "name" -> "Name"
            "first_name" -> "First name"
            "last_name" -> "Last name"
            "address" -> "Address"
            "notes" -> "Notes"
            "opted_out" -> "Do not text"
            ImportColumns.ACTION_IGNORE -> "Ignore this column"
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
        const val TITLE = "What do these cards carry?"

        const val LEAD =
            "These cards carry information this import does not read. A card's " +
                "categories, a note saying they asked us to stop, or a label " +
                "typed beside a number are where a .vcf says do-not-text — so a " +
                "property read as nothing texts somebody who asked this business " +
                "to stop."

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
        const val PARAMETER_NOTE =
            "A name with a “;” in it is a label attached to the property before " +
                "it, and the label carries free text of its own — “DO NOT CALL” " +
                "is one of the things people type there."

        /**
         * The coarseness, stated rather than discovered. It is genuinely blunt —
         * a `CATEGORIES` of "Friends" is blocked alongside one of "DNC" — and
         * somebody should know that before they choose it rather than after.
         *
         * Names the option by DERIVING its label, for the same reason
         * [Columns.WRONG_COLUMN] does.
         */
        val COARSE =
            "“${actionLabel(VCardProperties.ACTION_OPTED_OUT)}” blocks every card " +
                "carrying that property, whatever it says on the card. Not texting " +
                "somebody is the only direction this import is allowed to be wrong in."

        const val CONFIRM = "Import"

        const val CANCEL = "Cancel"

        const val UNANSWERED_HINT =
            "Every one of these needs an answer before the file can import."

        const val CHOOSE = ContactImport.Columns.CHOOSE

        fun actionLabel(action: String): String = when (action) {
            VCardProperties.ACTION_IGNORE -> "Says nothing about texting"
            VCardProperties.ACTION_OPTED_OUT -> "Do not text these cards"
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
    /** How the server's per-entry errors are labelled in the report sheet. */
    val rowWord: String,
    /** The unit, plural, for the limits line. */
    val unitPlural: String,
    /** What the file is called when we refuse it for being too big. */
    val fileWord: String,
    /**
     * The opt-out truth for this door, which is genuinely different on each.
     * An import can only ever ADD a block: the CSV path revives a REVOKED
     * opt-out and inserts new ones, and neither path can clear an active one.
     */
    val optOutNote: String,
) {
    CSV(
        maxEntries = ContactImport.MAX_ROWS,
        maxBytes = ContactImport.MAX_BYTES,
        rowWord = "Row",
        unitPlural = "rows",
        fileWord = "CSV",
        optOutNote = "A STOP always survives an import, and an opted-out column in " +
            "your file blocks those people here too.",
    ),
    VCARD(
        maxEntries = ContactImport.VCARD_MAX_CARDS,
        maxBytes = ContactImport.VCARD_MAX_BYTES,
        rowWord = "Card",
        unitPlural = "cards",
        fileWord = "vCard",
        // #248 round 3: a .vcf CAN now say it, in the one place the format
        // allows — a property somebody declared do-not-text blocks every card
        // carrying it. The old wording ("a .vcf carries no opt-out column") was
        // true of the parser and false of the format, which is how CATEGORIES:DNC
        // came to be dropped in silence.
        optOutNote = "A STOP always survives an import. A card marked do-not-text " +
            "blocks that person here too.",
    ),
}
