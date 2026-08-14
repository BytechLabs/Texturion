package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.RejectionDomain
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * US 10DLC registration (#157): brand + campaign status with honest dates,
 * rejection reason + resubmit (POST /v1/registration/submit), and the
 * sole-proprietor SMS OTP verify/resend step. The full wizard form stays on
 * the web — this surface tracks and unblocks.
 */
@Composable
fun RegistrationBlock(
    scope: SettingsScope,
    company: CompanyView,
    registration: RegistrationDetailPair,
    /**
     * #525 — is this workspace's plan paused, as GET /v1/billing/pause reports
     * it? Only [EnableUsCard] reads it, and only to change what it SAYS.
     *
     * REQUIRED RATHER THAN DEFAULTED, unlike the optional callbacks elsewhere on
     * this screen. A default of [PauseRead.Unasked] would be honest — it claims
     * nothing — but it would also let a new caller draw a $29 button on a paused
     * workspace without ever having thought about the pause, which is the exact
     * defect this parameter exists to close. One call site; make it decide.
     */
    pause: PauseRead,
    onChanged: () -> Unit,
) {
    // CA without US texting has nothing to register yet — but turning it on is
    // an owner decision we can take right here, the way the web does.
    if (company.country == "CA" && !company.us_texting_enabled) {
        EnableUsCard(scope, company, pause, onChanged)
        return
    }

    val brand = registration.brand
    val campaign = registration.campaign
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val locale = LocalAppLocale.current

    SettingsCard(
        title = t("settingsMore.textingRegistration"),
        description = t("settingsMore.textingRegistrationDesc"),
    ) {
        if (brand == null && campaign == null) {
            Text(
                t("settingsMore.registrationNotStarted"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@SettingsCard
        }

        // #352: which field the rejection notice asked the form to focus.
        var focusField by remember { mutableStateOf<String?>(null) }

        RegistrationRow(label = t("settingsMore.businessIdentity"), detail = brand)
        Spacer(Modifier.height(8.dp))
        RegistrationRow(label = t("settingsMore.messagingCampaign"), detail = campaign)

        val rejected = listOfNotNull(brand, campaign)
            .firstOrNull { it.status == RegistrationStatus.REJECTED }
        if (rejected != null) {
            Spacer(Modifier.height(8.dp))
            // #352: the carrier's token, translated into what happened and the
            // one thing to change, with a jump to the field it concerns. G7 has
            // required "rejection reason in plain language" since before launch;
            // what shipped was the reason, raw.
            RejectionNotice(
                domain = RejectionDomain.REGISTRATION,
                reason = rejected.rejection_reason,
                submissionCount = rejected.submission_count,
                onGoToField = { focusField = it },
            )
        }

        // Draft and rejected rows are both editable, and both are dead ends
        // without this: a rejection you cannot act on, or a draft that never
        // goes out. Resubmitting without an edit stays possible.
        val editable = registrationEditable(brand) || registrationEditable(campaign)
        if (canManage && editable) {
            InlineError(error)
            RegistrationFixForm(
                scope = scope,
                country = company.country,
                brand = brand,
                campaign = campaign,
                submitLabel = if (rejected != null) {
                    t("settingsMore.resubmitRegistration")
                } else {
                    t("settingsMore.submitRegistration")
                },
                onSubmitted = onChanged,
                focusField = focusField,
                onFocusHandled = { focusField = null },
            )
            if (rejected != null) {
                Button(
                    onClick = {
                        submitting = true
                        error = null
                        coroutines.launch {
                            try {
                                scope.repo.submitRegistration(scope.companyId)
                                scope.showMessage(
                                    AppStrings.translate(
                                        locale,
                                        "settingsMore.registrationResubmitted",
                                    ),
                                )
                                onChanged()
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                submitting = false
                            }
                        }
                    },
                    enabled = !submitting,
                    modifier = Modifier.padding(top = 8.dp),
                ) {
                    Text(
                        if (submitting) {
                            t("settingsMore.resubmitting")
                        } else {
                            t("settingsMore.resubmitNoChanges")
                        },
                    )
                }
            }
        }

        // Sole-proprietor brands verify ownership with an SMS PIN to the
        // registered mobile — the one in-app unblock the registry needs.
        if (canManage && brand != null && brand.sole_proprietor &&
            brand.status != RegistrationStatus.APPROVED &&
            brand.status != RegistrationStatus.DRAFT &&
            brand.status != RegistrationStatus.REJECTED
        ) {
            Spacer(Modifier.height(10.dp))
            SolePropOtpRow(scope, onChanged)
        }

        if (!canManage) {
            Spacer(Modifier.height(6.dp))
            ReadOnlyLine(t("settingsMore.onlyAdminsRegistration"))
        }
    }
}

/**
 * A Canadian workspace turning US texting on: a one-time carrier registration,
 * owner only. Everyone else gets the honest read-only line.
 *
 * #522 — THE FEE IS QUOTED IN THE MONEY THE CARD IS CHARGED. This surface used
 * to say "$29", which is `US_REGISTRATION_FEE_CENTS.usd`, to a reader who is
 * Canadian by construction: the card is only drawn for `country == "CA"`, and
 * `api_create_company` sets `billing_currency` to 'cad' for a Canadian
 * workspace against a `not null default 'usd'` column. So the button asking for
 * consent to a charge named a figure ten dollars under the one the invoice
 * carried, and the dialog above the confirm button repeated it.
 *
 * It takes the whole [CompanyView] rather than a pre-formatted string because
 * the currency question has exactly one right answer per workspace, and
 * [usRegistrationFee] is where it is answered — the same resolution the plan
 * card on the next screen uses.
 */
@Composable
private fun EnableUsCard(
    scope: SettingsScope,
    company: CompanyView,
    pause: PauseRead,
    onChanged: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val fee = usRegistrationFee(company.billing_currency, company.country)
    // #525: the WORDS come from the fact, and there is no control to withhold —
    // see [enableUsCopy]. `isPaused` is true only on an ANSWERED read, so a read
    // in flight or one that failed leaves every sentence exactly as it was
    // before the pause existed rather than guessing in either direction.
    val copy = enableUsCopy(fee, pause.isPaused, LocalAppLocale.current)

    SettingsCard(title = t("settingsMore.usTexting"), description = copy.description) {
        if (SettingsRoleGate.canEnableUsTexting(scope.role)) {
            // ABOVE THE BUTTON, because it is what pressing the button gets you
            // and when. Under it, the disclosure would be read after the press.
            copy.pausedNote?.let { note ->
                ReadOnlyLine(note)
                Spacer(Modifier.height(8.dp))
            }
            Button(onClick = { confirming = true }) {
                Text(copy.buttonLabel)
            }
        } else {
            ReadOnlyLine(copy.readOnlyLine)
        }
    }

    if (confirming) {
        ConfirmDialog(
            title = copy.confirmTitle,
            body = copy.confirmBody,
            confirmLabel = if (pending) t("settingsMore.starting") else copy.confirmLabel,
            confirmEnabled = !pending,
            pending = pending,
            error = error,
            dismissLabel = t("settingsMore.notNow"),
            onDismiss = {
                if (!pending) {
                    confirming = false
                    error = null
                }
            },
            onConfirm = {
                pending = true
                error = null
                coroutines.launch {
                    try {
                        scope.repo.enableUsTexting(scope.companyId)
                        confirming = false
                        scope.showMessage(copy.startedMessage)
                        onChanged()
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        pending = false
                    }
                }
            },
        )
    }
}

// ---------------------------------------------------------------------------
// #525 — what the enable-US card says while the plan is paused
// ---------------------------------------------------------------------------

/**
 * How long the carriers take, written once.
 *
 * Two branches quote it and they may not disagree: a paused reader deciding
 * whether the wait fits inside their winter is doing arithmetic on this number,
 * and a card that says "3 to 7 business days" in the dialog and something else
 * in the note above the button is asking them which of us to believe.
 *
 * It is OURS rather than the server's, and that is the honest shape: nothing in
 * the API knows how long a carrier will take. It is the estimate the product has
 * always given, kept in one place instead of two.
 */
const val US_APPROVAL_WINDOW = "3 to 7 business days"

/**
 * The same window, as the catalogue holds it — the key [enableUsCopy] quotes.
 *
 * TWO NAMES FOR ONE FIGURE, deliberately and narrowly. The constant above is
 * the ENGLISH, and it is what `EnableUsPausedTest` reads: that guard counts the
 * spellings of `business days` in THIS file and allows exactly one, so a
 * constant that resolved itself out of the catalogue would leave zero and the
 * guard would pass on an empty set. The catalogue's English for this key is
 * byte-identical to it; the French is web's own ("3 à 7 jours ouvrables").
 */
const val US_APPROVAL_WINDOW_KEY = "settings.usApprovalWindow"

/** Every sentence the enable-US card can render, decided in one place. */
data class EnableUsCopy(
    /** Under the card title. */
    val description: String,
    /** The control. Carries the fee in both branches — see [enableUsCopy]. */
    val buttonLabel: String,
    /** What somebody who cannot press it reads instead. */
    val readOnlyLine: String,
    /** The extra line a PAUSED workspace reads, above the button. Else null. */
    val pausedNote: String?,
    val confirmTitle: String,
    val confirmBody: String,
    val confirmLabel: String,
    /** Said once the POST lands, and it has to survive the pause too. */
    val startedMessage: String,
)

/**
 * The enable-US card's words, branched on one fact: is the plan paused?
 *
 * WHAT WAS WRONG. `POST /v1/registration/enable-us` never reads `paused_at` and
 * is not going to start: the carrier registration genuinely runs to completion
 * while a workspace is paused — the brand goes out, the campaign is built, the
 * numbers are assigned — and refusing the purchase would mean a seasonal crew
 * resumes in spring and THEN waits a week before they can text a US customer.
 * That is the worst possible week to spend on paperwork. So the fee is allowed
 * during a pause, and it is better value there than in spring.
 *
 * What was NOT allowed is what this card used to say to a paused owner: "We
 * handle it and email you when it's live." Approval lands; texting does not.
 * `runPreSendGates` refuses every send with `workspace_paused` for as long as
 * the pause holds, so "live" was a description of a thing that would not
 * happen on the day it was promised. Somebody paid for a capability and was
 * told the wrong date for it.
 *
 * WHAT THE PAUSED BRANCH HAS TO CARRY, and each clause is here because leaving
 * it out is a different wrong impression:
 *
 *   the review runs anyway    without it, the reader assumes the fee buys a
 *                             queue position that starts in spring, and the
 *                             sensible thing to do is wait — which is the one
 *                             conclusion the facts do not support.
 *   texting waits for resume  without it, this is the old promise again.
 *   the timing is the point   the wait is spent on a quiet week instead of a
 *                             busy one. Said plainly, once, as a fact about
 *                             when rather than a reason to hurry.
 *   once per workspace, ever  `registration_fee_paid_at` is stamped once and
 *                             checkout only adds the line when it is null, so
 *                             waiting until spring cannot make this cheaper.
 *                             Somebody weighing "buy it now or later" is owed
 *                             that, because the alternative they are imagining
 *                             does not exist.
 *
 * NOTHING IS WITHHELD. The button is the same button with the same label and
 * the same fee on it, and no branch here returns a disabled control or a null
 * one. A pause is not a reason to refuse a purchase that works.
 *
 * THE FEE IS THE CALLER'S, resolved through [usRegistrationFee] from the
 * workspace's own billing currency (#522). This function never names an amount.
 */
fun enableUsCopy(fee: String, paused: Boolean, locale: String? = null): EnableUsCopy {
    fun say(key: String, vararg vars: Pair<String, String>) =
        AppStrings.translate(locale, key, vars.toMap())

    // The approval window is quoted rather than spelled out, in every sentence
    // that mentions it — `EnableUsPausedTest` counts the spellings and allows
    // exactly one. [US_APPROVAL_WINDOW] stays the English figure that guard
    // reads; the catalogue holds the same words for English and the French
    // web already uses ("3 à 7 jours ouvrables").
    val window = say(US_APPROVAL_WINDOW_KEY)
    // One sentence, both branches, because it is the sentence somebody agrees
    // to a charge on and two copies of it are two chances to reprice one of
    // them. It is also the phrase `RegistrationFeeTest` pins.
    val charge = say("settings.enableUsCharge", "fee" to fee)

    return EnableUsCopy(
        description = say("settings.enableUsDescription"),
        buttonLabel = say("settings.enableUsButton", "fee" to fee),
        readOnlyLine = say("settings.enableUsReadOnly", "fee" to fee),
        pausedNote = if (paused) {
            say("settings.enableUsPausedNote", "window" to window)
        } else {
            null
        },
        confirmTitle = say("settings.enableUsConfirmTitle"),
        confirmBody = if (paused) {
            say(
                "settings.enableUsConfirmBodyPaused",
                "charge" to charge,
                "window" to window,
            )
        } else {
            say("settings.enableUsConfirmBody", "charge" to charge, "window" to window)
        },
        confirmLabel = say("settings.enableUsConfirmLabel"),
        startedMessage = if (paused) {
            say("settings.enableUsStartedPaused")
        } else {
            say("settings.enableUsStarted")
        },
    )
}

@Composable
private fun RegistrationRow(label: String, detail: RegistrationDetail?) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            // The status word and the "how long ago" clause are separate keys:
            // the clause is optional on every branch, and a language that puts
            // its time expression somewhere else can move it without rewriting
            // four status words.
            val line = when {
                detail == null -> t("settingsMore.regNotStarted")
                detail.status == RegistrationStatus.APPROVED ->
                    t("settingsMore.regApproved") + (
                        detail.approved_at?.let {
                            t("settingsMore.agoSuffix", "ago" to relativeTime(it))
                        } ?: ""
                        )

                detail.status == RegistrationStatus.REJECTED ->
                    t("settingsMore.regRejected") + (
                        detail.rejected_at?.let {
                            t("settingsMore.agoSuffix", "ago" to relativeTime(it))
                        } ?: ""
                        )

                detail.status == RegistrationStatus.SUBMITTED ||
                    detail.status == RegistrationStatus.PENDING ->
                    t("settingsMore.regInReview") + (
                        detail.submitted_at?.let {
                            t("settingsMore.submittedSuffix", "ago" to relativeTime(it))
                        } ?: ""
                        )

                else -> t("settingsMore.regDraftLine")
            }
            Text(
                line,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(8.dp))
        when (detail?.status) {
            null -> StatusPill(t("settingsMore.regNotStarted"), PillTone.Neutral)
            RegistrationStatus.APPROVED ->
                StatusPill(t("settingsMore.regApproved"), PillTone.Positive)

            RegistrationStatus.REJECTED ->
                StatusPill(t("settingsMore.regRejected"), PillTone.Bad)

            RegistrationStatus.SUBMITTED, RegistrationStatus.PENDING ->
                StatusPill(t("settingsMore.regInReview"), PillTone.Warn)

            else -> StatusPill(t("settingsMore.regDraft"), PillTone.Neutral)
        }
    }
}

@Composable
private fun SolePropOtpRow(scope: SettingsScope, onChanged: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var verifying by remember { mutableStateOf(false) }
    var resending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val locale = LocalAppLocale.current

    Text(
        t("settingsMore.solePropPin"),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(
        modifier = Modifier.padding(top = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = code,
            onValueChange = { next ->
                if (next.length <= 6 && next.all(Char::isDigit)) code = next
            },
            modifier = Modifier.weight(1f),
            singleLine = true,
            enabled = !verifying && !resending,
            label = { Text(t("settingsMore.sixDigitPin")) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        Spacer(Modifier.width(8.dp))
        Button(
            onClick = {
                verifying = true
                error = null
                coroutines.launch {
                    try {
                        scope.repo.verifyRegistrationOtp(scope.companyId, code)
                        scope.showMessage(
                            AppStrings.translate(locale, "settingsMore.otpVerified"),
                        )
                        onChanged()
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        verifying = false
                    }
                }
            },
            enabled = !verifying && !resending && code.length == 6,
        ) {
            Text(
                if (verifying) t("settingsMore.checking") else t("settingsMore.verify"),
            )
        }
    }
    OutlinedButton(
        onClick = {
            resending = true
            error = null
            coroutines.launch {
                try {
                    scope.repo.resendRegistrationOtp(scope.companyId)
                    scope.showMessage(
                        AppStrings.translate(locale, "settingsMore.newPinSent"),
                    )
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    resending = false
                }
            }
        },
        enabled = !verifying && !resending,
        modifier = Modifier.padding(top = 6.dp),
    ) {
        Text(
            if (resending) t("settingsMore.sending") else t("settingsMore.resendPin"),
        )
    }
    InlineError(error)
}
