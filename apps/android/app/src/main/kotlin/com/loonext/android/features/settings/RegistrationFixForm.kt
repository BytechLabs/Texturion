package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Fix-and-resubmit for a draft or rejected 10DLC registration: edit the wizard
 * data (PUT /v1/registration), then submit it (POST /v1/registration/submit).
 *
 * This used to be web-only, which meant a rejection reached the phone with no
 * way to act on it: the card said "fix your details in the web app" and a draft
 * row was a dead end. Field names, branches, and the floors below mirror the
 * canonical schemas in apps/api/src/telnyx/wizard.ts, because the server
 * re-validates the whole object and rejects a partial one.
 */

/** TCR verticals — mirror of the API's list (apps/api/src/telnyx/wizard.ts). */
private val TCR_VERTICALS = listOf(
    "AGRICULTURE", "COMMUNICATION", "CONSTRUCTION", "EDUCATION", "ENERGY",
    "ENTERTAINMENT", "FINANCIAL", "GAMBLING", "GOVERNMENT", "HEALTHCARE",
    "HOSPITALITY", "HUMAN_RESOURCES", "INSURANCE", "LEGAL", "MANUFACTURING",
    "NGO", "POLITICAL", "POSTAL", "PROFESSIONAL", "REAL_ESTATE", "RETAIL",
    "TECHNOLOGY", "TRANSPORTATION",
)

private fun verticalLabel(vertical: String): String =
    vertical.lowercase().replace('_', ' ').replaceFirstChar(Char::uppercase)

/** Every field both brand paths and the campaign can carry, flat. */
private data class FixForm(
    val displayName: String = "",
    val email: String = "",
    val phone: String = "",
    val vertical: String = "PROFESSIONAL",
    val street: String = "",
    val city: String = "",
    val state: String = "",
    val postalCode: String = "",
    val companyName: String = "",
    val ein: String = "",
    val website: String = "",
    val firstName: String = "",
    val lastName: String = "",
    val mobilePhone: String = "",
    val messageFlow: String = "",
    val sample1: String = "",
    val sample2: String = "",
)

private fun str(data: JsonObject?, key: String): String =
    (data?.get(key)?.jsonPrimitive?.contentOrNull).orEmpty()

private val kotlinx.serialization.json.JsonPrimitive.contentOrNull: String?
    get() = if (isString) content else null

/** Draft and rejected rows are editable; anything submitted is frozen. */
fun registrationEditable(detail: RegistrationDetail?): Boolean =
    detail != null &&
        (detail.status == RegistrationStatus.DRAFT ||
            detail.status == RegistrationStatus.REJECTED)

private const val CONTACT_PHONE_PATTERN = """^\+?[0-9()\-. ]{10,20}$"""
private const val EMAIL_PATTERN = """^[^\s@]+@[^\s@]+\.[^\s@]+$"""
private const val EIN_PATTERN = """^[0-9A-Za-z][0-9A-Za-z-]{7,14}$"""

/**
 * A website is valid when blank (optional on every brand path) or looks like a
 * web address. A bare domain is accepted and gets an https:// prefix on the way
 * out, exactly as onboarding accepts it.
 */
private fun normalizeWebsite(input: String): String {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return ""
    return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        trimmed
    } else {
        "https://$trimmed"
    }
}

private fun websiteValid(input: String): Boolean {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return true
    val normalized = normalizeWebsite(trimmed)
    return normalized.length <= 255 &&
        Regex("""^https?://[^\s/.]+\.[^\s/]{2,}""").containsMatchIn(normalized)
}

/**
 * The first thing wrong with the form, in the reader's words, or null when it
 * is ready to send. One message at a time: a wall of red on a phone form is
 * noise, and the server re-validates anyway.
 */
private fun firstProblem(
    form: FixForm,
    editBrand: Boolean,
    editCampaign: Boolean,
    soleProp: Boolean,
    country: String,
    /**
     * #228: the reader's language, handed down from the one composable that
     * calls this. One layer, not five — every sentence this returns is shown
     * directly under the form, so it cannot stay English while the form is not.
     */
    locale: String?,
): String? {
    fun say(key: String, vararg vars: Pair<String, String>): String =
        AppStrings.translate(locale, key, vars.toMap())

    // The field's own name, in the middle of a sentence ("Enter the city.").
    // Kept as a key rather than a bare noun so a language that inflects it can.
    fun blank(value: String, labelKey: String, max: Int): String? = when {
        value.trim().isEmpty() -> say("settingsMore.enterField", "field" to say(labelKey))
        value.trim().length > max ->
            say(
                "settingsMore.fieldTooLong",
                "field" to say(labelKey),
                "max" to "$max",
            )

        else -> null
    }

    if (editBrand) {
        blank(form.displayName, "settingsMore.fieldKnownName", 255)?.let { return it }
        if (!Regex(EMAIL_PATTERN).matches(form.email.trim()) ||
            form.email.trim().length > 320
        ) {
            return say("settingsMore.enterContactEmail")
        }
        if (!Regex(CONTACT_PHONE_PATTERN).matches(form.phone.trim())) {
            return say("settingsMore.enterContactPhone")
        }
        blank(form.street, "settingsMore.fieldStreet", 255)?.let { return it }
        blank(form.city, "settingsMore.fieldCity", 100)?.let { return it }
        blank(
            form.state,
            if (country == "US") "settingsMore.fieldState" else "settingsMore.fieldProvince",
            20,
        )?.let { return it }
        blank(
            form.postalCode,
            if (country == "US") "settingsMore.fieldZip" else "settingsMore.fieldPostal",
            10,
        )?.let { return it }

        if (soleProp) {
            blank(form.firstName, "settingsMore.fieldFirstName", 100)?.let { return it }
            blank(form.lastName, "settingsMore.fieldLastName", 100)?.let { return it }
            if (!Regex("""^\d{4}$""").matches(form.ein.trim())) {
                return say(
                    "settingsMore.enterLast4",
                    "idLabel" to say(
                        if (country == "US") {
                            "settingsMore.ssnLabel"
                        } else {
                            "settingsMore.sinLabel"
                        },
                    ),
                )
            }
            if (normalizeNanpInput(form.mobilePhone) == null) {
                return say("settingsMore.enterMobileForCode")
            }
        } else {
            blank(form.companyName, "settingsMore.fieldLegalName", 255)?.let { return it }
            if (!Regex(EIN_PATTERN).matches(form.ein.trim())) {
                return if (country == "US") {
                    say("settingsMore.enterEin")
                } else {
                    say("settingsMore.enterCra")
                }
            }
        }
        if (!websiteValid(form.website)) {
            return say("settingsMore.enterWebsite")
        }
    }

    if (editCampaign) {
        val flow = form.messageFlow.trim()
        if (flow.length < 40) {
            return say("settingsMore.optInTooShort")
        }
        if (flow.length > 2048) return say("settingsMore.optInTooLong")
        listOf(form.sample1, form.sample2).forEach { sample ->
            val value = sample.trim()
            if (value.length < 20) return say("settingsMore.sampleTooShort")
            if (value.length > 1024) return say("settingsMore.sampleTooLong")
        }
    }
    return null
}

/** The PUT body: complete drafts only, with the sole-prop XOR the API enforces. */
private fun payload(
    form: FixForm,
    editBrand: Boolean,
    editCampaign: Boolean,
    soleProp: Boolean,
    country: String,
): JsonObject = buildJsonObject {
    if (editBrand) {
        put(
            "brand",
            buildJsonObject {
                put("displayName", form.displayName.trim())
                put("email", form.email.trim())
                put("phone", form.phone.trim())
                put("vertical", form.vertical)
                put("street", form.street.trim())
                put("city", form.city.trim())
                put("state", form.state.trim())
                put("postalCode", form.postalCode.trim())
                put("country", country)
                if (soleProp) {
                    put("firstName", form.firstName.trim())
                    put("lastName", form.lastName.trim())
                    put("ein", form.ein.trim())
                    put("mobilePhone", normalizeNanpInput(form.mobilePhone).orEmpty())
                } else {
                    put("companyName", form.companyName.trim())
                    put("ein", form.ein.trim())
                }
                // Omitted when blank: the API's website is optional, and an
                // empty string is not a URL.
                if (form.website.isNotBlank()) {
                    put("website", normalizeWebsite(form.website))
                }
            },
        )
    }
    if (editCampaign) {
        put(
            "campaign",
            buildJsonObject {
                put("messageFlow", form.messageFlow.trim())
                put("sample1", form.sample1.trim())
                put("sample2", form.sample2.trim())
            },
        )
    }
}

/**
 * The form itself, rendered inside the registration card. [submitLabel] is
 * "Submit registration" for a draft that never went out and "Resubmit
 * registration" for a fix after a rejection.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegistrationFixForm(
    scope: SettingsScope,
    country: String,
    brand: RegistrationDetail?,
    campaign: RegistrationDetail?,
    submitLabel: String,
    onSubmitted: () -> Unit,
    // #352: the field a carrier rejection concerns. The notice above sets it;
    // this opens itself and puts the cursor there, because handing somebody who
    // has just been rejected a sixteen-field form and no direction is how they
    // resubmit the same mistake and buy another multi-day carrier review.
    focusField: String? = null,
    onFocusHandled: () -> Unit = {},
) {
    val editBrand = registrationEditable(brand)
    val editCampaign = registrationEditable(campaign)
    val soleProp = brand?.sole_proprietor ?: false
    if (!editBrand && !editCampaign) return

    var form by remember(brand?.id, campaign?.id) {
        mutableStateOf(
            FixForm(
                displayName = str(brand?.data, "displayName"),
                email = str(brand?.data, "email"),
                phone = str(brand?.data, "phone"),
                vertical = str(brand?.data, "vertical").ifBlank { "PROFESSIONAL" },
                street = str(brand?.data, "street"),
                city = str(brand?.data, "city"),
                state = str(brand?.data, "state"),
                postalCode = str(brand?.data, "postalCode"),
                companyName = str(brand?.data, "companyName"),
                ein = str(brand?.data, "ein"),
                website = str(brand?.data, "website"),
                firstName = str(brand?.data, "firstName"),
                lastName = str(brand?.data, "lastName"),
                mobilePhone = str(brand?.data, "mobilePhone"),
                messageFlow = str(campaign?.data, "messageFlow"),
                sample1 = str(campaign?.data, "sample1"),
                sample2 = str(campaign?.data, "sample2"),
            ),
        )
    }
    var open by remember { mutableStateOf(false) }
    // Keyed by the same field names the shared catalogue routes to, so the
    // vectors that pin the routing also pin what this can reach.
    val focusRequesters = remember { mutableMapOf<String, FocusRequester>() }
    var verticalOpen by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val locale = LocalAppLocale.current

    val regionLabel = if (country == "US") {
        t("settingsMore.stateLabel")
    } else {
        t("settingsMore.provinceLabel")
    }
    val postalLabel = if (country == "US") {
        t("settingsMore.zipLabel")
    } else {
        t("settingsMore.postalLabel")
    }
    val idLabel = if (country == "US") {
        t("settingsMore.einLabel")
    } else {
        t("settingsMore.businessNumberLabel")
    }

    @Composable
    fun field(
        value: String,
        label: String,
        onChange: (String) -> Unit,
        keyboard: KeyboardType = KeyboardType.Text,
        lines: Int = 1,
        key: String? = null,
    ) {
        val requester = key?.let { name ->
            remember(name) { FocusRequester() }.also { focusRequesters[name] = it }
        }
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp)
                .let { if (requester != null) it.focusRequester(requester) else it },
            singleLine = lines == 1,
            minLines = lines,
            enabled = !saving,
            label = { Text(label) },
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        )
    }

    // #352: a rejection notice asking for a field opens the form for them.
    // Opening it is half the value on a phone — the form is collapsed by
    // default, so "take me to it" that only scrolls would land on a button.
    LaunchedEffect(focusField) {
        if (focusField != null) open = true
    }
    // Separate from the effect above because the requester does not exist until
    // the field has composed, which is one frame after `open` becomes true.
    LaunchedEffect(focusField, open) {
        val target = focusField ?: return@LaunchedEffect
        if (!open) return@LaunchedEffect
        // requestFocus throws if the node is gone (a field the current country
        // or sole-proprietor branch does not render). Losing the cursor is a
        // worse-than-nothing outcome, not a crash-worthy one.
        runCatching { focusRequesters[target]?.requestFocus() }
        onFocusHandled()
    }

    if (!open) {
        Button(
            onClick = { open = true },
            modifier = Modifier.padding(top = 8.dp),
        ) { Text(t("settingsMore.editDetails")) }
        return
    }

    Column(Modifier.padding(top = 8.dp)) {
        if (editBrand) {
            Text(
                t("settingsMore.registryExactly"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (soleProp) {
                field(
                    form.firstName,
                    t("settingsMore.firstName"),
                    { form = form.copy(firstName = it) },
                )
                field(
                    form.lastName,
                    t("settingsMore.lastName"),
                    { form = form.copy(lastName = it) },
                )
            } else {
                field(
                    form.companyName,
                    t("settingsMore.legalBusinessName"),
                    { form = form.copy(companyName = it) },
                    key = "companyName",
                )
            }
            field(
                form.displayName,
                t("settingsMore.knownBusinessName"),
                { form = form.copy(displayName = it) },
            )
            field(
                form.ein,
                if (soleProp) {
                    t(
                        "settingsMore.last4Of",
                        "idLabel" to if (country == "US") {
                            t("settingsMore.ssnLabel")
                        } else {
                            t("settingsMore.sinLabel")
                        },
                    )
                } else {
                    idLabel
                },
                { next ->
                    if (!soleProp || (next.length <= 4 && next.all(Char::isDigit))) {
                        form = form.copy(ein = next)
                    }
                },
                keyboard = if (soleProp) KeyboardType.Number else KeyboardType.Text,
                key = "ein",
            )
            field(
                form.email,
                t("settingsMore.contactEmail"),
                { form = form.copy(email = it) },
                keyboard = KeyboardType.Email,
                key = "email",
            )
            field(
                form.phone,
                t("settingsMore.contactPhone"),
                { form = form.copy(phone = it) },
                keyboard = KeyboardType.Phone,
            )
            if (soleProp) {
                field(
                    form.mobilePhone,
                    t("settingsMore.mobileForCode"),
                    { form = form.copy(mobilePhone = it) },
                    keyboard = KeyboardType.Phone,
                )
            }
            field(
                form.website,
                t("settingsMore.websiteOptional"),
                { form = form.copy(website = it) },
                key = "website",
            )

            ExposedDropdownMenuBox(
                expanded = verticalOpen,
                onExpandedChange = { if (!saving) verticalOpen = it },
                modifier = Modifier.padding(vertical = 4.dp),
            ) {
                OutlinedTextField(
                    value = verticalLabel(form.vertical),
                    onValueChange = {},
                    readOnly = true,
                    enabled = !saving,
                    label = { Text(t("settingsMore.industry")) },
                    trailingIcon = {
                        ExposedDropdownMenuDefaults.TrailingIcon(expanded = verticalOpen)
                    },
                    modifier = Modifier
                        .menuAnchor(
                            androidx.compose.material3.MenuAnchorType.PrimaryNotEditable,
                        )
                        .fillMaxWidth(),
                )
                ExposedDropdownMenu(
                    expanded = verticalOpen,
                    onDismissRequest = { verticalOpen = false },
                ) {
                    TCR_VERTICALS.forEach { vertical ->
                        DropdownMenuItem(
                            text = { Text(verticalLabel(vertical)) },
                            onClick = {
                                form = form.copy(vertical = vertical)
                                verticalOpen = false
                            },
                        )
                    }
                }
            }

            field(
                form.street,
                t("settingsMore.streetAddress"),
                { form = form.copy(street = it) },
                key = "street",
            )
            field(form.city, t("settingsMore.city"), { form = form.copy(city = it) })
            field(form.state, regionLabel, { form = form.copy(state = it) })
            field(form.postalCode, postalLabel, { form = form.copy(postalCode = it) })
        }

        if (editCampaign) {
            Spacer(Modifier.height(10.dp))
            Text(
                t("settingsMore.campaignIntro"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            field(
                form.messageFlow,
                t("settingsMore.howCustomersOptIn"),
                { form = form.copy(messageFlow = it) },
                lines = 3,
                key = "messageFlow",
            )
            field(
                form.sample1,
                t("settingsMore.sampleText1"),
                { form = form.copy(sample1 = it) },
                lines = 2,
                key = "sample1",
            )
            field(
                form.sample2,
                t("settingsMore.sampleText2"),
                { form = form.copy(sample2 = it) },
                lines = 2,
            )
        }

        InlineError(error)
        Button(
            onClick = {
                val problem =
                    firstProblem(form, editBrand, editCampaign, soleProp, country, locale)
                if (problem != null) {
                    error = problem
                    return@Button
                }
                saving = true
                error = null
                coroutines.launch {
                    try {
                        scope.repo.saveRegistrationDraft(
                            scope.companyId,
                            payload(form, editBrand, editCampaign, soleProp, country),
                        )
                        scope.repo.submitRegistration(scope.companyId)
                        scope.showMessage(
                            AppStrings.translate(
                                locale,
                                "settingsMore.registrationSubmitted",
                            ),
                        )
                        open = false
                        onSubmitted()
                    } catch (cause: Exception) {
                        error = cause.userMessage(locale)
                    } finally {
                        saving = false
                    }
                }
            },
            enabled = !saving,
            modifier = Modifier.padding(top = 8.dp),
        ) { Text(if (saving) t("settingsMore.submitting") else submitLabel) }
    }
}
