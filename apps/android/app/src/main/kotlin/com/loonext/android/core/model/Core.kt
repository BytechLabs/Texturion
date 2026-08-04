package com.loonext.android.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Wire models mirror apps/web/src/lib/api/types.ts (the route files are the
 * truth). Server string-enums stay Kotlin Strings with named constants so a
 * lagging mobile build never crashes on a value added server-side; UI `when`
 * blocks always carry an `else`.
 */

/** SPEC §7 list envelope — cursor-based only, opaque cursor. */
@Serializable
data class Page<T>(
    val data: List<T>,
    val next_cursor: String? = null,
    /**
     * #286: how many rows this member cannot see. Sent only by /v1/numbers
     * today; defaulted so every other list decodes unchanged.
     */
    val hidden_count: Int = 0,
)

object SubscriptionStatus {
    const val INCOMPLETE = "incomplete"
    const val INCOMPLETE_EXPIRED = "incomplete_expired"
    const val ACTIVE = "active"
    const val PAST_DUE = "past_due"
    const val UNPAID = "unpaid"
    const val CANCELED = "canceled"
}

object MemberRole {
    const val OWNER = "owner"
    const val ADMIN = "admin"
    const val MEMBER = "member"

    /**
     * #315: the view-only observer — an owner's partner, an accountant, a
     * consultant who should SEE the work and never text a customer as the
     * business. Deliberately absent from the rank map below: it is a capability
     * SET, not a rung, so [atLeast] refuses it everywhere. That is the same
     * fail-closed answer the server gives.
     */
    const val READ_ONLY = "read_only"

    /**
     * #315: the bookkeeper or the spouse doing the books. Billing, and NOT the
     * inbox — the only role that never sees a customer conversation, which is
     * why the shell renders it a screen of its own rather than four tabs that
     * each answer 403. Also off the rank map, for the same reason [READ_ONLY]
     * is.
     */
    const val BOOKKEEPER = "bookkeeper"

    /**
     * The role → capability table, hand-ported from
     * packages/shared/src/capabilities.ts. Only the axes this app actually asks
     * about are listed; adding one here means adding it there first.
     *
     * A SET per role, not a rank, because two of these five roles are not on
     * the owner ⊃ admin ⊃ member line at all.
     */
    private val CAPABILITIES: Map<String, Set<String>> = mapOf(
        READ_ONLY to setOf(Capability.WORKSPACE_ACCESS, Capability.CONVERSATIONS_READ),
        BOOKKEEPER to setOf(Capability.WORKSPACE_ACCESS, Capability.BILLING_MANAGE),
        MEMBER to setOf(
            Capability.WORKSPACE_ACCESS,
            Capability.CONVERSATIONS_READ,
            Capability.CONVERSATIONS_SEND,
        ),
        ADMIN to setOf(
            Capability.WORKSPACE_ACCESS,
            Capability.CONVERSATIONS_READ,
            Capability.CONVERSATIONS_SEND,
            Capability.BILLING_MANAGE,
            Capability.SETTINGS_MANAGE,
            Capability.TEAM_MANAGE,
            Capability.NUMBERS_MANAGE,
            Capability.HISTORY_READ,
        ),
        OWNER to Capability.ALL,
    )

    /**
     * Does [role] hold [capability]? An unknown role holds nothing — the same
     * fail-closed answer [atLeast] and the server both give, so a build that
     * has not heard of a newer preset refuses rather than guesses.
     */
    fun has(role: String?, capability: String): Boolean =
        CAPABILITIES[role]?.contains(capability) == true

    /**
     * #315: can this role open the inbox at all? Every one of this app's four
     * nav slots is a conversation surface, so this decides whether the shell is
     * even the right thing to render.
     */
    fun canReadConversations(role: String?): Boolean =
        has(role, Capability.CONVERSATIONS_READ)

    /** Hierarchical check: does [role] meet [required]? */
    fun atLeast(role: String?, required: String): Boolean {
        val rank = mapOf(OWNER to 3, ADMIN to 2, MEMBER to 1)
        return (rank[role] ?: 0) >= (rank[required] ?: Int.MAX_VALUE)
    }
}

/**
 * #315: the authorization axes, hand-ported from packages/shared. A role is a
 * set of these, so a permission question is always "which axis does this
 * need?" rather than "how senior must they be?" — the second question has no
 * answer for a role that is not on the line.
 */
object Capability {
    const val WORKSPACE_ACCESS = "workspace.access"
    const val CONVERSATIONS_READ = "conversations.read"
    const val CONVERSATIONS_SEND = "conversations.send"
    const val BILLING_MANAGE = "billing.manage"
    const val SETTINGS_MANAGE = "settings.manage"
    const val TEAM_MANAGE = "team.manage"
    const val NUMBERS_MANAGE = "numbers.manage"
    const val HISTORY_READ = "history.read"

    /** Everything — the owner's set, and the list a test can iterate. */
    val ALL = setOf(
        WORKSPACE_ACCESS,
        CONVERSATIONS_READ,
        CONVERSATIONS_SEND,
        BILLING_MANAGE,
        SETTINGS_MANAGE,
        TEAM_MANAGE,
        NUMBERS_MANAGE,
        HISTORY_READ,
    )
}

@Serializable
data class Membership(
    val company_id: String,
    val name: String,
    val role: String,
    val subscription_status: String,
)

/**
 * GET /v1/me/firsts — #405/#476. Has THIS member replied, written a note, and
 * marked something done, in THIS workspace.
 *
 * Its own route rather than a field on /v1/me: that one is the hottest in the
 * product, and this answers a question that only matters for a few days of one
 * person's life. Every field defaults, so a lagging build cannot fail the read
 * on a payload it half-understands — the card renders nothing on any error
 * anyway, and a checklist is never worth an exception.
 */
@Serializable
data class MemberFirsts(
    val replied: Boolean = false,
    val noted: Boolean = false,
    val marked_done: Boolean = false,
    /**
     * #286: has this member been through the joining orientation — the one
     * piece of their first-run state that cannot be derived from rows they
     * wrote, because it is a thing we did to them rather than a thing they did.
     *
     * Defaults to TRUE, not false. Every other field here defaults to "not
     * done yet", which is the harmless answer for a checklist row; the
     * harmless answer for a FLOW is "already seen". A server one release behind
     * that omits the key must not walk somebody through four screens they have
     * been past for a month.
     */
    val oriented: Boolean = true,
)

/** GET /v1/me — optionally hydrated with `company` when X-Company-Id is sent. */
@Serializable
data class Me(
    val user_id: String,
    val display_name: String,
    val memberships: List<Membership>,
    /**
     * #386: null when email can reach this person, which is the common case.
     * Present when their address hard-bounced or reported us as spam — the
     * only other symptom is that their notifications stop, which looks
     * exactly like a quiet week.
     */
    val email_state: EmailState? = null,
    val company: CompanyView? = null,
    /**
     * #283: the client-side flags for the active workspace.
     *
     * Only `kill:realtime` today, and only because it is the one switch the
     * server cannot enforce — clients hold their own Supabase token and open
     * their own socket, so there is nothing for the Worker to refuse.
     * Defaulted so a response from a server that predates it still decodes,
     * and absent always reads as "no statement", never as "off".
     */
    val flags: Map<String, Boolean> = emptyMap(),
)

/** #386: why we cannot email this member, and whether they can fix it. */
@Serializable
data class EmailState(
    val email: String,
    /** "hard_bounce" — the address rejected us. "complaint" — reported as spam. */
    val reason: String,
    val since: String? = null,
    /**
     * True only for a hard bounce. A complaint is not ours to undo: tapping a
     * button in our app is not consent to resume mailing somebody who marked
     * us as spam.
     */
    val fixable: Boolean = false,
)

object NumberStatus {
    const val PROVISIONING = "provisioning"
    const val ACTIVE = "active"
    const val SUSPENDED = "suspended"
    const val RELEASED = "released"
    const val PROVISION_FAILED = "provision_failed"
}

/** #235: a number a carrier has started filtering or labelling. */
@Serializable
data class NumberHealth(
    /** Always "degraded" when present — a healthy number carries no row. */
    val state: String,
    /** 0-1 over the assessment window, or null when there was too little to say. */
    val delivery_rate: Double? = null,
    /** When it first left healthy, so the notice can say how long. */
    val degraded_since: String? = null,
    /** Plain language, for support rather than the customer. */
    val detail: String? = null,
)

/** Numbers summary embedded in company views + GET /v1/numbers rows. */
@Serializable
data class PhoneNumberSummary(
    val id: String,
    val status: String,
    val country: String,
    val number_e164: String? = null,
    val requested_area_code: String? = null,
    val created_at: String,
    val source: String? = null,
    val voice_enabled: Boolean? = null,
    /**
     * #366: how many people an inbound call to this number could ring, and the
     * ceiling on how many it actually will. Null when the server could not
     * resolve it, which reads as "nothing to say" rather than as zero.
     */
    val ring_targets: Int? = null,
    val ring_target_limit: Int? = null,
    /**
     * #235: present only when a carrier is filtering or labelling this number.
     * Null means healthy — which is also what an unassessed number reads as.
     * The internal 'watch' state never reaches a client.
     */
    val health: NumberHealth? = null,
    val suspended_at: String? = null,
    val released_at: String? = null,
    val failure_reason: String? = null,
    val provision_attempts: Int? = null,
    val retrying: Boolean? = null,
)

@Serializable
data class RegistrationSummary(
    val kind: String,
    val status: String,
    val sole_proprietor: Boolean,
    val rejection_reason: String? = null,
    val submission_count: Int,
    val submitted_at: String? = null,
    val approved_at: String? = null,
    val rejected_at: String? = null,
    val deactivated_at: String? = null,
)

@Serializable
data class RegistrationPair(
    val brand: RegistrationSummary? = null,
    val campaign: RegistrationSummary? = null,
)

@Serializable
data class DayHours(val open: String, val close: String)

/**
 * #402: a date, or a run of dates, that overrides the weekly schedule.
 *
 * A RANGE rather than a list of single dates, so a week off is one entry the
 * owner can read back and delete rather than seven kept in step. [hours] null
 * means closed all day.
 */
@Serializable
data class HoursException(
    val from: String,
    val to: String,
    val hours: DayHours? = null,
    val note: String? = null,
)

/**
 * #228: which language an AUTOMATED text goes out in.
 *
 * Hand-ported from packages/shared/src/locale.ts. There is no shared Kotlin
 * package, so these values live in two places and have to move together; the
 * server validates whatever is sent, so a client that lags is refused rather
 * than believed.
 *
 * Named for the MESSAGE, not the app. This is not `java.util.Locale` and never
 * becomes it: nothing here translates the interface or anything a person typed,
 * only the handful of texts we send on the owner's behalf.
 */
object MessageLocale {
    const val EN = "en"
    const val FR_CA = "fr-CA"

    /** What a business works in until it says otherwise. */
    const val DEFAULT = EN

    /** The offer order for a picker: the product default first. */
    val ALL = listOf(EN, FR_CA)

    /**
     * How each language names itself, never translated.
     *
     * Character-for-character equal to LOCALE_LABELS in packages/shared,
     * unaccented "Francais" included: three clients each prettifying the label
     * on their own is three pickers that no longer name the same thing.
     * An unrecognised value renders as its own code, which is at least true.
     */
    fun label(value: String): String = when (value) {
        EN -> "English"
        FR_CA -> "Francais (Canada)"
        else -> value
    }

    /**
     * What the "follow the workspace" choice is called on a CONTACT.
     *
     * It NAMES the language being inherited rather than saying "default",
     * because "same as workspace" on its own gives somebody the rule and not
     * the answer, and the answer is what they opened the screen for. It is also
     * the only option that can put a contact back to following the workspace,
     * so it has to read as a real choice rather than as an absence.
     */
    fun inheritLabel(companyLocale: String): String =
        "Same as workspace (${label(companyLocale)})"

    /**
     * The language a text to this contact actually goes out in.
     *
     * A null contact locale means "whatever the business works in", NEVER
     * English: an owner who moves the workspace to fr-CA moves every customer
     * they have not said otherwise about, including ones added years earlier.
     * Anything unrecognised on either side falls back rather than throwing;
     * this decides copy on a send path, and a row carrying a locale some later
     * release added must not stop a text reaching somebody.
     */
    fun resolve(contactLocale: String?, companyLocale: String?): String =
        contactLocale?.takeIf { it in ALL }
            ?: companyLocale?.takeIf { it in ALL }
            ?: DEFAULT
}

/** GET /v1/company and the GET /v1/me `company` hydration. */
@Serializable
data class CompanyView(
    val id: String,
    val name: String,
    val country: String,
    val us_texting_enabled: Boolean,
    val requested_area_code: String,
    val chosen_number_e164: String? = null,
    val timezone: String,
    /**
     * #228: the language the automated texts go out in: the after-hours away
     * reply, the missed-call text-back, the emergency acknowledgment, and the
     * rating ask. Never null on the wire; defaulted so a payload from a Worker
     * that predates the field decodes as the language the product has always
     * sent rather than failing the whole company read.
     */
    val locale: String = MessageLocale.DEFAULT,
    val plan: String? = null,
    val subscription_status: String,
    val current_period_start: String? = null,
    val current_period_end: String? = null,
    /** Wire union number|string|null — parse via [overageCapMultiplier]. */
    val overage_cap_multiplier: kotlinx.serialization.json.JsonPrimitive? = null,
    val registration_fee_paid_at: String? = null,
    val canceled_at: String? = null,
    /** #481: what a departing owner's customers are told. Null = off. */
    val offramp_message: String? = null,
    val offramp_opted_in_at: String? = null,
    val cancel_at_period_end: Boolean = false,
    /** weekday (mon..sun) -> window; missing/null weekday = closed all day. */
    val business_hours: Map<String, DayHours?> = emptyMap(),
    /** #402: dates that override the weekly loop — Christmas is not a Thursday. */
    val business_hours_exceptions: List<HoursException> = emptyList(),
    val away_enabled: Boolean = false,
    val away_message: String? = null,
    /**
     * #414 ask 5: the template that will ACTUALLY send — the owner's text if
     * they wrote one, else the product default, resolved by the SERVER. This
     * screen used to carry its own copy of that default; so did web and iOS,
     * and nothing kept the three equal.
     */
    val away_effective_message: String = "",
    /** True when the owner's own away text is in effect. */
    val away_message_is_custom: Boolean = false,
    /**
     * #414: whether a customer replying URGENT/EMERGENCY/911/SOS wakes the
     * whole crew at high priority, exempt from the daily notification limit.
     * Defaults TRUE for a lagging client, matching the server — the away copy
     * that asks a homeowner to send it is on by default too.
     */
    val emergency_keyword_enabled: Boolean = true,
    /**
     * #460: the workspace's own emergency words, or null for the product list.
     * Null means "use the default", never "watch for nothing".
     */
    val emergency_keywords: List<String>? = null,
    /** #460: the workspace's own emergency reply, or null for the default. */
    val emergency_message: String? = null,
    /**
     * #460: the words the inbound handler will really match on, resolved by the
     * SERVER. The unrecognised-reply-word warning reads THIS — warning against
     * a list nothing uses is how an owner learns to ignore warnings.
     */
    val emergency_effective_keywords: List<String> = emptyList(),
    /**
     * #460: what actually lands on the customer's phone — the effective body
     * PLUS the safety sentence no setting removes. Composed by the server, for
     * the same reason [away_effective_message] is.
     */
    val emergency_effective_message: String = "",
    /** True when the owner's own emergency reply is in effect. */
    val emergency_message_is_custom: Boolean = false,
    /** True when the owner set their own words rather than the defaults. */
    val emergency_keywords_are_custom: Boolean = false,
    /**
     * #388: chase a new lead nobody has answered. The defaults MATCH the
     * server's and are asymmetric on purpose — rung one re-alerts only people
     * already told once, so it ships on; rung two reaches people who were not
     * told, so an owner opts in. A lagging client that guessed the second one
     * true would render a klaxon as already-enabled.
     */
    /**
     * #392: the seat allowance, served rather than recomputed. Null only when
     * talking to a Worker older than #392, in which case the plan-derived
     * fallback in SettingsLogic applies.
     */
    val seat_limit: Int? = null,
    val lead_chase_enabled: Boolean = true,
    val lead_chase_crew_enabled: Boolean = false,
    /** #430: whether a push may carry words a person typed. Workspace-wide. */
    val push_include_content: Boolean = true,
    val mctb_enabled: Boolean = false,
    val mctb_message: String? = null,
    /** Server-resolved template that will actually send (custom else default). */
    val mctb_effective_message: String? = null,
    val mctb_message_is_custom: Boolean = false,
    /** #393: whether the first text to a customer is signed with the business
     *  name. Default false — D4's 2026-07 reversal stands until an owner opts in. */
    val first_message_identification: Boolean = false,
    /** #393: the EXACT suffix such a text will carry (null when off, or when the
     *  company name is blank). Render and METER this — never build it here, or
     *  the part count can drift from the body the server bills. */
    val first_message_identification_suffix: String? = null,
    /** #225: whether STARTING a conversation inside the destination's
     *  8pm-8am local window asks for a confirmation. That prompt only —
     *  automated sends are held to the window regardless. Defaults TRUE so a
     *  payload without the field keeps the prompt. */
    val quiet_hours_confirm_enabled: Boolean = true,
    /** #298: whether members may INVENT tags, or only use the set that already
     *  exists. Attaching an existing tag is never restricted — a tech who
     *  cannot categorise a thread leaves it uncategorised rather than filing it
     *  somewhere else. Defaults FALSE: most shops want no taxonomy at all. */
    val tags_locked: Boolean = false,
    val voicemail_greeting: String? = null,
    /** #309: the workspace's default RECORDING; null = the written words. */
    val voicemail_greeting_id: String? = null,
    /** #278: what an inbound call does outside business hours. Defaults to
     *  ring_everyone, which is the product exactly as it behaved before it
     *  existed — a payload without the field keeps that. */
    val after_hours_calls: String = "ring_everyone",
    /** #278: the recording played after hours; null falls back to the ordinary
     *  greeting, never to silence. */
    val after_hours_greeting_id: String? = null,
    /** #278: every phone at once, or joining the ring one at a time. */
    val ring_strategy: String = "all",
    /** #278: how long they ring before the caller gets the greeting. 45 is the
     *  ceiling — the call legs themselves end there. */
    val ring_seconds: Int = 45,
    val call_screening: String = "off",
    val cnam_display_name: String? = null,
    val caller_id_lookup: Boolean = false,
    /** #193: the outbound caller ID actually in effect (server-resolved:
     *  the explicit override, else the company name in the carrier
     *  alphabet). Null only when neither yields a listable name. */
    val caller_id_effective: String? = null,
    /** #193: 'company_name' = platform default; 'custom' = owner-set. */
    val caller_id_source: String = "company_name",
    /** #193: when the listing last went to the carrier side (propagation
     *  takes days with no completion signal, so the timestamp IS the state). */
    val cnam_submitted_at: String? = null,
    val created_at: String,
    val updated_at: String,
    val numbers: List<PhoneNumberSummary> = emptyList(),
    val enabled_modules: List<String> = emptyList(),
    val registration: RegistrationPair = RegistrationPair(),
) {
    val subscriptionActive: Boolean get() = subscription_status == SubscriptionStatus.ACTIVE

    /** null = no cap. */
    val overageCapMultiplier: Double?
        get() = overage_cap_multiplier?.content?.toDoubleOrNull()
}

/** One realtime broadcast payload is always an ID-bag; kept as raw JSON. */
typealias EventPayload = JsonObject

/**
 * #301 — where these customers came from.
 *
 * `coverage` and `note` are computed SERVER-side, like every other number on
 * the home surface and for the same reason: three clients deciding
 * independently how much of a thin ranking to believe is three chances to show
 * an owner a confidence the others would not.
 */
@Serializable
data class LeadSourceCount(
    val lead_source_id: String,
    val name: String,
    /** Attributed automatically, by which line rang. */
    val by_number: Int = 0,
    /** A person said so. */
    val by_person: Int = 0,
    val total: Int = 0,
)

@Serializable
data class LeadSourceReport(
    val days: Int = 30,
    val sources: List<LeadSourceCount> = emptyList(),
    /** Conversations with no source at all. A row, never an omission. */
    val unknown: Int = 0,
    val total: Int = 0,
    /** 0-1, or null when the window held no conversations at all. */
    val coverage: Double? = null,
    /** The caveat to print above the table, or null when there is none. */
    val note: String? = null,
)

/** #301: the workspace's own list of where customers come from. */
@Serializable
data class LeadSource(
    val id: String,
    val name: String,
    /** Non-null once retired: off the pickers, kept in the record. */
    val archived_at: String? = null,
    val created_at: String = "",
)
