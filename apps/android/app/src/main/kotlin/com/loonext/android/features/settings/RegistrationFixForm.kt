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
): String? {
    fun blank(value: String, label: String, max: Int): String? = when {
        value.trim().isEmpty() -> "Enter $label."
        value.trim().length > max -> "Keep $label under $max characters."
        else -> null
    }

    if (editBrand) {
        blank(form.displayName, "the business name customers know", 255)?.let { return it }
        if (!Regex(EMAIL_PATTERN).matches(form.email.trim()) ||
            form.email.trim().length > 320
        ) {
            return "Enter a contact email address."
        }
        if (!Regex(CONTACT_PHONE_PATTERN).matches(form.phone.trim())) {
            return "Enter a contact phone number."
        }
        blank(form.street, "the street address", 255)?.let { return it }
        blank(form.city, "the city", 100)?.let { return it }
        blank(form.state, if (country == "US") "the state" else "the province", 20)
            ?.let { return it }
        blank(
            form.postalCode,
            if (country == "US") "the ZIP code" else "the postal code",
            10,
        )?.let { return it }

        if (soleProp) {
            blank(form.firstName, "your first name", 100)?.let { return it }
            blank(form.lastName, "your last name", 100)?.let { return it }
            if (!Regex("""^\d{4}$""").matches(form.ein.trim())) {
                return "Enter the last 4 digits of your " +
                    (if (country == "US") "SSN" else "SIN") + "."
            }
            if (normalizeNanpInput(form.mobilePhone) == null) {
                return "Enter a US or Canadian mobile number; it gets the verification text."
            }
        } else {
            blank(form.companyName, "your legal business name", 255)?.let { return it }
            if (!Regex(EIN_PATTERN).matches(form.ein.trim())) {
                return if (country == "US") {
                    "Enter your 9-digit EIN (numbers only, dashes ok)."
                } else {
                    "Enter your CRA business number."
                }
            }
        }
        if (!websiteValid(form.website)) {
            return "Enter a web address (e.g. mikesplumbing.com) or leave it blank."
        }
    }

    if (editCampaign) {
        val flow = form.messageFlow.trim()
        if (flow.length < 40) {
            return "Carriers need at least 40 characters here: describe how customers " +
                "ask you to text them."
        }
        if (flow.length > 2048) return "Keep the opt-in description under 2,048 characters."
        listOf(form.sample1, form.sample2).forEach { sample ->
            val value = sample.trim()
            if (value.length < 20) return "Each sample needs at least 20 characters: a real text you'd send."
            if (value.length > 1024) return "Keep each sample under 1,024 characters."
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

    val regionLabel = if (country == "US") "State" else "Province"
    val postalLabel = if (country == "US") "ZIP code" else "Postal code"
    val idLabel = if (country == "US") "EIN" else "Business number"

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
        ) { Text("Edit your details") }
        return
    }

    Column(Modifier.padding(top = 8.dp)) {
        if (editBrand) {
            Text(
                "These go to the carrier registry exactly as typed.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (soleProp) {
                field(form.firstName, "First name", { form = form.copy(firstName = it) })
                field(form.lastName, "Last name", { form = form.copy(lastName = it) })
            } else {
                field(
                    form.companyName,
                    "Legal business name",
                    { form = form.copy(companyName = it) },
                    key = "companyName",
                )
            }
            field(
                form.displayName,
                "Business name customers know",
                { form = form.copy(displayName = it) },
            )
            field(
                form.ein,
                if (soleProp) {
                    "Last 4 of ${if (country == "US") "SSN" else "SIN"}"
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
                "Contact email",
                { form = form.copy(email = it) },
                keyboard = KeyboardType.Email,
                key = "email",
            )
            field(
                form.phone,
                "Contact phone",
                { form = form.copy(phone = it) },
                keyboard = KeyboardType.Phone,
            )
            if (soleProp) {
                field(
                    form.mobilePhone,
                    "Mobile for the verification text",
                    { form = form.copy(mobilePhone = it) },
                    keyboard = KeyboardType.Phone,
                )
            }
            field(form.website, "Website (optional)", { form = form.copy(website = it) }, key = "website")

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
                    label = { Text("Industry") },
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

            field(form.street, "Street address", { form = form.copy(street = it) }, key = "street")
            field(form.city, "City", { form = form.copy(city = it) })
            field(form.state, regionLabel, { form = form.copy(state = it) })
            field(form.postalCode, postalLabel, { form = form.copy(postalCode = it) })
        }

        if (editCampaign) {
            Spacer(Modifier.height(10.dp))
            Text(
                "How customers ask you to text them, and two texts you actually send. " +
                    "Carriers read these.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            field(
                form.messageFlow,
                "How customers opt in",
                { form = form.copy(messageFlow = it) },
                lines = 3,
                key = "messageFlow",
            )
            field(
                form.sample1,
                "Sample text 1",
                { form = form.copy(sample1 = it) },
                lines = 2,
                key = "sample1",
            )
            field(
                form.sample2,
                "Sample text 2",
                { form = form.copy(sample2 = it) },
                lines = 2,
            )
        }

        InlineError(error)
        Button(
            onClick = {
                val problem = firstProblem(form, editBrand, editCampaign, soleProp, country)
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
                            "Submitted. We'll email you when carriers approve it.",
                        )
                        open = false
                        onSubmitted()
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        saving = false
                    }
                }
            },
            enabled = !saving,
            modifier = Modifier.padding(top = 8.dp),
        ) { Text(if (saving) "Submitting…" else submitLabel) }
    }
}
