import SwiftUI

/// Fix-and-resubmit for a draft or rejected 10DLC registration: edit the wizard
/// data (PUT /v1/registration), then submit it (POST /v1/registration/submit).
///
/// This used to be web-only, which meant a rejection reached the phone with no
/// way to act on it: the card said "fix your details in the web app" and a draft
/// row was a dead end. Field names, branches, and the floors below mirror the
/// canonical schemas in apps/api/src/telnyx/wizard.ts, because the server
/// re-validates the whole object and rejects a partial one.

/// TCR verticals — mirror of the API's list (apps/api/src/telnyx/wizard.ts).
let tcrVerticals = [
    "AGRICULTURE", "COMMUNICATION", "CONSTRUCTION", "EDUCATION", "ENERGY",
    "ENTERTAINMENT", "FINANCIAL", "GAMBLING", "GOVERNMENT", "HEALTHCARE",
    "HOSPITALITY", "HUMAN_RESOURCES", "INSURANCE", "LEGAL", "MANUFACTURING",
    "NGO", "POLITICAL", "POSTAL", "PROFESSIONAL", "REAL_ESTATE", "RETAIL",
    "TECHNOLOGY", "TRANSPORTATION",
]

func verticalLabel(_ vertical: String) -> String {
    let lower = vertical.lowercased().replacingOccurrences(of: "_", with: " ")
    return lower.prefix(1).uppercased() + lower.dropFirst()
}

/// Every field both brand paths and the campaign can carry, flat.
struct RegistrationFixValues: Equatable {
    var displayName = ""
    var email = ""
    var phone = ""
    var vertical = "PROFESSIONAL"
    var street = ""
    var city = ""
    var state = ""
    var postalCode = ""
    var companyName = ""
    var ein = ""
    var website = ""
    var firstName = ""
    var lastName = ""
    var mobilePhone = ""
    var messageFlow = ""
    var sample1 = ""
    var sample2 = ""
}

/// Draft and rejected rows are editable; anything submitted is frozen.
func registrationEditable(_ detail: RegistrationDetail?) -> Bool {
    guard let detail else { return false }
    return detail.status == RegistrationStatus.draft
        || detail.status == RegistrationStatus.rejected
}

private func wizardString(_ data: JSONValue?, _ key: String) -> String {
    guard case let .object(fields)? = data, case let .string(value)? = fields[key]
    else { return "" }
    return value
}

/// A bare domain is accepted and gets an https:// prefix on the way out,
/// exactly as onboarding accepts it.
func normalizeRegistrationWebsite(_ input: String) -> String {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "" }
    if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") { return trimmed }
    return "https://\(trimmed)"
}

private func websiteValid(_ input: String) -> Bool {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return true }
    let normalized = normalizeRegistrationWebsite(trimmed)
    guard normalized.count <= 255 else { return false }
    return normalized.range(
        of: "^https?://[^\\s/.]+\\.[^\\s/]{2,}",
        options: .regularExpression
    ) != nil
}

private func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
}

/// The first thing wrong with the form, in the reader's words, or nil when it is
/// ready to send. One message at a time: a wall of red on a phone form is noise,
/// and the server re-validates anyway.
///
/// #228: `locale` is the reader's language, defaulted so no existing caller has
/// to change. It is threaded ONE layer — the view that renders this sentence is
/// the view that calls this — rather than reaching for an environment a plain
/// function does not have.
///
/// The field NAME is a key too, not an English fragment glued into a template:
/// "Enter the city." is one sentence in English and "Entrez la ville." in
/// French, and only a whole-sentence substitution can agree the article.
func registrationFixProblem(
    _ form: RegistrationFixValues,
    editBrand: Bool,
    editCampaign: Bool,
    soleProp: Bool,
    country: String,
    locale: String = MessageLocale.en
) -> String? {
    func say(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars)
    }

    func blank(_ value: String, _ fieldKey: String, _ max: Int) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let field = say(fieldKey)
        if trimmed.isEmpty { return say("settingsMore.enterField", ["field": field]) }
        if trimmed.count > max {
            return say(
                "settingsMore.fieldTooLong", ["field": field, "max": String(max)]
            )
        }
        return nil
    }

    if editBrand {
        if let problem = blank(form.displayName, "settingsMore.fieldKnownName", 255) {
            return problem
        }
        let email = form.email.trimmingCharacters(in: .whitespacesAndNewlines)
        if !matches(email, "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") || email.count > 320 {
            return say("settingsMore.enterContactEmail")
        }
        let phone = form.phone.trimmingCharacters(in: .whitespacesAndNewlines)
        if !matches(phone, "^\\+?[0-9()\\-. ]{10,20}$") {
            return say("settingsMore.enterContactPhone")
        }
        if let problem = blank(form.street, "settingsMore.fieldStreet", 255) { return problem }
        if let problem = blank(form.city, "settingsMore.fieldCity", 100) { return problem }
        if let problem = blank(
            form.state,
            country == "US" ? "settingsMore.fieldState" : "settingsMore.fieldProvince",
            20
        ) { return problem }
        if let problem = blank(
            form.postalCode,
            country == "US" ? "settingsMore.fieldZip" : "settingsMore.fieldPostal",
            10
        ) { return problem }

        let ein = form.ein.trimmingCharacters(in: .whitespacesAndNewlines)
        if soleProp {
            if let problem = blank(form.firstName, "settingsMore.fieldFirstName", 100) {
                return problem
            }
            if let problem = blank(form.lastName, "settingsMore.fieldLastName", 100) {
                return problem
            }
            if !matches(ein, "^\\d{4}$") {
                return say(
                    "settingsMore.enterLast4",
                    [
                        "idLabel": say(
                            country == "US"
                                ? "settingsMore.ssnLabel"
                                : "settingsMore.sinLabel"
                        )
                    ]
                )
            }
            if normalizeNanpInput(form.mobilePhone) == nil {
                return say("settingsMore.enterMobileForCode")
            }
        } else {
            if let problem = blank(form.companyName, "settingsMore.fieldLegalName", 255) {
                return problem
            }
            if !matches(ein, "^[0-9A-Za-z][0-9A-Za-z-]{7,14}$") {
                return say(
                    country == "US" ? "settingsMore.enterEin" : "settingsMore.enterCra"
                )
            }
        }
        if !websiteValid(form.website) {
            return say("settingsMore.enterWebsite")
        }
    }

    if editCampaign {
        let flow = form.messageFlow.trimmingCharacters(in: .whitespacesAndNewlines)
        if flow.count < 40 {
            return say("settingsMore.optInTooShort")
        }
        if flow.count > 2048 { return say("settingsMore.optInTooLong") }
        for sample in [form.sample1, form.sample2] {
            let value = sample.trimmingCharacters(in: .whitespacesAndNewlines)
            if value.count < 20 {
                return say("settingsMore.sampleTooShort")
            }
            if value.count > 1024 { return say("settingsMore.sampleTooLong") }
        }
    }
    return nil
}

/// The PUT body: complete drafts only, with the sole-prop XOR the API enforces.
func registrationFixPayload(
    _ form: RegistrationFixValues,
    editBrand: Bool,
    editCampaign: Bool,
    soleProp: Bool,
    country: String
) -> JSONValue {
    func trimmed(_ value: String) -> JSONValue {
        .string(value.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    var body: [String: JSONValue] = [:]
    if editBrand {
        var brand: [String: JSONValue] = [
            "displayName": trimmed(form.displayName),
            "email": trimmed(form.email),
            "phone": trimmed(form.phone),
            "vertical": .string(form.vertical),
            "street": trimmed(form.street),
            "city": trimmed(form.city),
            "state": trimmed(form.state),
            "postalCode": trimmed(form.postalCode),
            "country": .string(country),
            "ein": trimmed(form.ein),
        ]
        if soleProp {
            brand["firstName"] = trimmed(form.firstName)
            brand["lastName"] = trimmed(form.lastName)
            brand["mobilePhone"] = .string(normalizeNanpInput(form.mobilePhone) ?? "")
        } else {
            brand["companyName"] = trimmed(form.companyName)
        }
        // Omitted when blank: the API's website is optional, and an empty
        // string is not a URL.
        if !form.website.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            brand["website"] = .string(normalizeRegistrationWebsite(form.website))
        }
        body["brand"] = .object(brand)
    }
    if editCampaign {
        body["campaign"] = .object([
            "messageFlow": trimmed(form.messageFlow),
            "sample1": trimmed(form.sample1),
            "sample2": trimmed(form.sample2),
        ])
    }
    return .object(body)
}

/// The form itself, rendered inside the registration card. `submitLabel` is
/// "Submit registration" for a draft that never went out and "Resubmit
/// registration" for a fix after a rejection.
@MainActor
struct RegistrationFixForm: View {
    let scope: SettingsScope
    let country: String
    let brand: RegistrationDetail?
    let campaign: RegistrationDetail?
    let submitLabel: String
    let onSubmitted: @MainActor () -> Void
    /// #352: the field a carrier rejection concerns. The notice above sets it;
    /// this opens itself and puts the cursor there, because handing somebody who
    /// has just been rejected a sixteen-field form and no direction is how they
    /// resubmit the same mistake and buy another multi-day carrier review.
    @Binding var focusField: String?

    @FocusState private var focused: String?
    @State private var form = RegistrationFixValues()
    @State private var seeded = false
    @State private var open = false
    @State private var saving = false
    @State private var error: String?

    private var editBrand: Bool { registrationEditable(brand) }
    private var editCampaign: Bool { registrationEditable(campaign) }
    private var soleProp: Bool { brand?.sole_proprietor ?? false }

    private var regionLabel: String { country == "US" ? "State" : "Province" }
    private var postalLabel: String { country == "US" ? "ZIP code" : "Postal code" }
    private var idLabel: String { country == "US" ? "EIN" : "Business number" }
    private var last4Label: String { country == "US" ? "SSN" : "SIN" }

    var body: some View {
        // Grouped so the focus effect has somewhere to live: the branch below
        // does not render at all when neither row is editable, and an effect on
        // a branch that disappears never runs.
        Group {
            content
        }
        .task(id: focusField) {
            guard let target = focusField else { return }
            open = true
            // The requester cannot resolve until the field has composed, which
            // is at least one runloop turn after `open` flips.
            try? await Task.sleep(nanoseconds: 50_000_000)
            focused = target
            focusField = nil
        }
    }

    @ViewBuilder
    private var content: some View {
        if editBrand || editCampaign {
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    if editBrand { brandFields }
                    if editCampaign { campaignFields }
                    InlineError(error)
                    Button(saving ? "Submitting…" : submitLabel) { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(saving)
                        .padding(.top, 8)
                }
                .padding(.top, 8)
                .onAppear(perform: seed)
            } else {
                Button("Edit your details") { open = true }
                    .buttonStyle(.bordered)
                    .padding(.top, 8)
            }
        }
    }

    // MARK: Sections

    private var brandFields: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("These go to the carrier registry exactly as typed.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if soleProp {
                field("First name", text: $form.firstName)
                field("Last name", text: $form.lastName)
            } else {
                field("Legal business name", text: $form.companyName, key: "companyName")
            }
            field("Business name customers know", text: $form.displayName)
            field(
                soleProp ? "Last 4 of \(last4Label)" : idLabel,
                text: $form.ein,
                keyboard: soleProp ? .numberPad : .default,
                key: "ein"
            )
            field("Contact email", text: $form.email, keyboard: .emailAddress, key: "email")
            field("Contact phone", text: $form.phone, keyboard: .phonePad)
            if soleProp {
                field(
                    "Mobile for the verification text",
                    text: $form.mobilePhone,
                    keyboard: .phonePad
                )
            }
            field("Website (optional)", text: $form.website, keyboard: .URL, key: "website")

            VStack(alignment: .leading, spacing: 2) {
                Text("Industry")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Industry", selection: $form.vertical) {
                    ForEach(tcrVerticals, id: \.self) { vertical in
                        Text(verticalLabel(vertical)).tag(vertical)
                    }
                }
                .pickerStyle(.menu)
                .disabled(saving)
            }
            .padding(.vertical, 4)

            field("Street address", text: $form.street, key: "street")
            field("City", text: $form.city)
            field(regionLabel, text: $form.state)
            field(postalLabel, text: $form.postalCode)
        }
    }

    private var campaignFields: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 10)
            Text(
                "How customers ask you to text them, and two texts you actually send. "
                    + "Carriers read these."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
            field("How customers opt in", text: $form.messageFlow, lines: 3, key: "messageFlow")
            field("Sample text 1", text: $form.sample1, lines: 2, key: "sample1")
            field("Sample text 2", text: $form.sample2, lines: 2)
        }
    }

    private func field(
        _ label: String,
        text: Binding<String>,
        keyboard: UIKeyboardType = .default,
        lines: Int = 1,
        key: String? = nil
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(label, text: text, axis: lines > 1 ? .vertical : .horizontal)
                // Unkeyed fields get a value nothing routes to, rather than a
                // conditional modifier that would change the view's type.
                .focused($focused, equals: key ?? "unrouted:\(label)")
                .textFieldStyle(.roundedBorder)
                .keyboardType(keyboard)
                .textInputAutocapitalization(
                    keyboard == .emailAddress || keyboard == .URL ? .never : .sentences
                )
                .autocorrectionDisabled(keyboard == .emailAddress || keyboard == .URL)
                .lineLimit(lines > 1 ? lines...(lines + 3) : 1...1)
                .disabled(saving)
        }
        .padding(.vertical, 4)
    }

    // MARK: Actions

    /// Prefill from whatever the wizard already holds, once. Re-seeding on every
    /// render would fight the keyboard.
    private func seed() {
        guard !seeded else { return }
        seeded = true
        let brandData = brand?.data
        let campaignData = campaign?.data
        let storedVertical = wizardString(brandData, "vertical")
        form = RegistrationFixValues(
            displayName: wizardString(brandData, "displayName"),
            email: wizardString(brandData, "email"),
            phone: wizardString(brandData, "phone"),
            vertical: storedVertical.isEmpty ? "PROFESSIONAL" : storedVertical,
            street: wizardString(brandData, "street"),
            city: wizardString(brandData, "city"),
            state: wizardString(brandData, "state"),
            postalCode: wizardString(brandData, "postalCode"),
            companyName: wizardString(brandData, "companyName"),
            ein: wizardString(brandData, "ein"),
            website: wizardString(brandData, "website"),
            firstName: wizardString(brandData, "firstName"),
            lastName: wizardString(brandData, "lastName"),
            mobilePhone: wizardString(brandData, "mobilePhone"),
            messageFlow: wizardString(campaignData, "messageFlow"),
            sample1: wizardString(campaignData, "sample1"),
            sample2: wizardString(campaignData, "sample2")
        )
    }

    private func save() {
        if let problem = registrationFixProblem(
            form,
            editBrand: editBrand,
            editCampaign: editCampaign,
            soleProp: soleProp,
            country: country
        ) {
            error = problem
            return
        }
        saving = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.saveRegistrationDraft(
                    scope.companyId,
                    body: registrationFixPayload(
                        form,
                        editBrand: editBrand,
                        editCampaign: editCampaign,
                        soleProp: soleProp,
                        country: country
                    )
                )
                _ = try await scope.repo.submitRegistration(scope.companyId)
                scope.showMessage("Submitted. We'll email you when carriers approve it.")
                open = false
                onSubmitted()
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}
