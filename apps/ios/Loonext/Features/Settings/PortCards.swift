import SwiftUI

// MARK: - Port form (create phase 2 + fix-and-resubmit share it)

struct PortForm: Equatable, Sendable {
    var entityName = ""
    var authPersonName = ""
    var accountNumber = ""
    var pinPasscode = ""
    var ssnSinLast4 = ""
    var street = ""
    var locality = ""
    var adminArea = ""
    var postalCode = ""

    func isComplete(wireless: Bool) -> Bool {
        !entityName.isBlank && !authPersonName.isBlank
            && !accountNumber.isBlank && !street.isBlank
            && !locality.isBlank && !adminArea.isBlank && !postalCode.isBlank
            && (!wireless || (!pinPasscode.isBlank && ssnSinLast4.count == 4 && ssnSinLast4.allSatisfy(\.isNumber)))
    }

    /// The shared fields of POST and PUT /v1/port-requests bodies.
    func fieldsJson(wireless: Bool) -> [String: JSONValue] {
        var fields: [String: JSONValue] = [
            "entity_name": .string(entityName.trimmingCharacters(in: .whitespaces)),
            "auth_person_name": .string(authPersonName.trimmingCharacters(in: .whitespaces)),
            "account_number": .string(accountNumber.trimmingCharacters(in: .whitespaces)),
            "service_street": .string(street.trimmingCharacters(in: .whitespaces)),
            "service_locality": .string(locality.trimmingCharacters(in: .whitespaces)),
            "service_admin_area": .string(adminArea.trimmingCharacters(in: .whitespaces)),
            "service_postal_code": .string(postalCode.trimmingCharacters(in: .whitespaces)),
        ]
        if wireless {
            fields["pin_passcode"] = .string(pinPasscode.trimmingCharacters(in: .whitespaces))
            fields["ssn_sin_last4"] = .string(ssnSinLast4.trimmingCharacters(in: .whitespaces))
        }
        return fields
    }
}

/// The fields a rejection can send somebody to (#319). These strings are what
/// the shared catalogue returns from `explainRejection(.port, …)` AND the keys
/// `fieldsJson` puts on the wire; `PortRejectionRoutingTests` pins the three
/// together, because a name no field carries is a "Take me to it" button that
/// does nothing at all.
enum PortFixField {
    static let entityName = "entity_name"
    static let authPersonName = "auth_person_name"
    static let accountNumber = "account_number"
    static let serviceStreet = "service_street"

    static let all: Set<String> = [
        entityName, authPersonName, accountNumber, serviceStreet,
    ]
}

private struct PortFormFields: View {
    @Binding var form: PortForm
    let wireless: Bool
    let country: String
    let enabled: Bool
    /// #319: the field a rejection named, routed in from the notice above and
    /// cleared once the cursor lands there. Constant on the create path, which
    /// has no rejection behind it.
    var focusField: Binding<String?> = .constant(nil)

    @FocusState private var focused: String?

    @Environment(\.appLocale) private var appLocale

    // SSN stays SSN in French — it is a US federal identifier and the form is
    // filled from a US carrier's bill. SIN's Quebec name is NAS, and a Montreal
    // owner reading "SIN" would hunt for a field their paperwork does not have.
    private var ssnLabel: String {
        AppStrings.translate(
            appLocale, country == "US" ? "settingsMore.ssnLabel" : "settingsMore.sinLabel"
        )
    }
    private var regionLabel: String {
        AppStrings.translate(
            appLocale,
            country == "US" ? "settingsMore.stateLabel" : "settingsMore.provinceLabel"
        )
    }
    private var postalLabel: String {
        AppStrings.translate(
            appLocale, country == "US" ? "settingsMore.zipLabel" : "settingsMore.postalLabel"
        )
    }

    var body: some View {
        Text(AppStrings.translate(appLocale, "settingsMore.portFormIntro"))
        .font(.footnote)
        .foregroundStyle(.secondary)
        // The jump hangs off this line because the body is a bare list of
        // siblings with no container to carry an effect, and this one always
        // renders.
        .task(id: focusField.wrappedValue) {
            guard let target = focusField.wrappedValue else { return }
            // The requester cannot resolve until the field has composed, which
            // is at least one runloop turn after the sheet appears.
            try? await Task.sleep(nanoseconds: 50_000_000)
            focused = target
            focusField.wrappedValue = nil
        }
        field(
            AppStrings.translate(appLocale, "settingsMore.accountHolder"),
            text: $form.entityName,
            key: PortFixField.entityName
        )
        field(
            AppStrings.translate(appLocale, "settingsMore.authorizedPerson"),
            text: $form.authPersonName,
            key: PortFixField.authPersonName
        )
        field(
            AppStrings.translate(appLocale, "settingsMore.accountNumber"),
            text: $form.accountNumber,
            key: PortFixField.accountNumber
        )
        if wireless {
            Text(
                AppStrings.translate(
                    appLocale, "settingsMore.portWirelessNote", ["idLabel": ssnLabel]
                )
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.top, 4)
            field(
                AppStrings.translate(appLocale, "settingsMore.transferPin"),
                text: $form.pinPasscode
            )
            TextField(
                AppStrings.translate(
                    appLocale, "settingsMore.last4Of", ["idLabel": ssnLabel]
                ),
                text: Binding(
                    get: { form.ssnSinLast4 },
                    set: { next in
                        if next.count <= 4 && next.allSatisfy(\.isNumber) {
                            form.ssnSinLast4 = next
                        }
                    }
                )
            )
            .textFieldStyle(.roundedBorder)
            .keyboardType(.numberPad)
            .disabled(!enabled)
            .padding(.vertical, 4)
        }
        field(
            AppStrings.translate(appLocale, "settingsMore.streetAddress"),
            text: $form.street,
            key: PortFixField.serviceStreet
        )
        field(AppStrings.translate(appLocale, "settingsMore.city"), text: $form.locality)
        field(regionLabel, text: $form.adminArea)
        field(postalLabel, text: $form.postalCode)
    }

    private func field(_ label: String, text: Binding<String>, key: String? = nil) -> some View {
        TextField(label, text: text)
            // Unkeyed fields get a value nothing routes to, rather than a
            // conditional modifier that would change the view's type.
            .focused($focused, equals: key ?? "unrouted:\(label)")
            .textFieldStyle(.roundedBorder)
            .disabled(!enabled)
            .padding(.vertical, 4)
    }
}

// MARK: - Ports block: start affordance + one tracker card per port

@MainActor
struct PortsBlock: View {
    let scope: SettingsScope
    let company: CompanyView
    let ports: [PortRequest]
    /// #523 — the numbers list, so a FINISHED transfer can find out whether the
    /// line it delivered still works. A port row knows the transfer completed
    /// and nothing at all about a hold, which is how this block came to say
    /// "Ported, all done" an inch under a number card saying "On hold".
    /// `portedLineIsOnHold` is the whole of the matching rule.
    let numbers: [PhoneNumberSummary]
    let onChanged: @MainActor () -> Void

    @State private var starting = false

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        ForEach(ports.filter { $0.status != PortStatus.cancelled }, id: \.id) { port in
            PortCard(
                scope: scope,
                port: port,
                onHold: portedLineIsOnHold(port, in: numbers),
                onChanged: onChanged
            )
        }

        if SettingsRoleGate.canManageNumbers(scope.role) && company.subscriptionActive {
            SettingsCard(
                title: AppStrings.translate(appLocale, "settingsMore.bringNumber"),
                description: AppStrings.translate(appLocale, "settingsMore.bringNumberDesc")
            ) {
                Button(AppStrings.translate(appLocale, "settingsMore.startTransfer")) {
                    starting = true
                }
                    .buttonStyle(.bordered)
            }
            .sheet(isPresented: $starting) {
                StartPortSheet(scope: scope, company: company) {
                    starting = false
                    onChanged()
                } onDismiss: {
                    starting = false
                }
            }
        }
    }
}

private struct PortCard: View {
    let scope: SettingsScope
    let port: PortRequest
    /// #523 — the line this finished transfer delivered is SUSPENDED. Resolved
    /// by `PortsBlock` from the numbers list, false on every ordinary transfer.
    ///
    /// It changes two things and deliberately not a third: the pill stops
    /// celebrating, and a sentence says which of the two things is held. The
    /// STEPPER is left fully filled, because it reports the transfer's own story
    /// and that story is true — the number did move to us. Dimming it would
    /// replace one wrong claim with another.
    let onHold: Bool
    let onChanged: @MainActor () -> Void

    @State private var fixing = false
    @State private var cancelling = false
    @State private var busy = false
    @State private var actionError: String?
    /// #319: the field the rejection notice asked the fix sheet to focus. Set
    /// afresh at every entry point, because a sheet can also be swiped away.
    @State private var focusField: String?

    @Environment(\.appLocale) private var appLocale

    private var canManage: Bool { SettingsRoleGate.canManageNumbers(scope.role) }
    private var canCancel: Bool { SettingsRoleGate.canCancelPort(scope.role) }

    /// #319: the request is with the carriers and the number has not moved yet
    /// — the only stretch where the checklist can still change the outcome.
    ///
    /// Excluded on purpose: `draft` (nothing is in flight), `exception` (the
    /// rejection notice owns that card and a checklist under it buries the
    /// fix), and `ported`/`cancel-pending`/`cancelled` (too late to export, or
    /// moot). `in-process` is included even though #319 names only the other
    /// three, because it is where a submitted transfer actually sits — `submit`
    /// and `resubmit` below both land the order there (routes/porting.ts) — so
    /// leaving it out would blank the guidance for most of the wait. The
    /// tracker already folds it in with the other two at "In progress"
    /// (`portStepIndex`), and web/Android gate on the same four.
    private var isPreCutover: Bool { preCutoverStatuses.contains(port.status) }

    var body: some View {
        SettingsCard(
            title: AppStrings.translate(
                appLocale,
                "settingsMore.transferTitle",
                ["number": formatPhone(port.phone_e164)]
            )
        ) {
            statusPill
            Spacer().frame(height: 8)
            PortStepper(status: port.status)

            // #523: the line is on hold, said in the app's one sentence for a
            // hold rather than a second copy of it. Directly under the stepper
            // and above every other note on this card, because it is the only
            // thing here that decides whether the number works today — the
            // switch date, the temporary number and the registration note all
            // describe a transfer, and this describes the line.
            if onHold {
                Text(
                    portedLineOnHoldLine(
                        canManageBilling: SettingsRoleGate.canManageBilling(scope.role)
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            }

            // Grouped for one mechanical reason: a ViewBuilder block takes ten
            // children and this card was already at ten, so #319's checklist
            // below had nowhere to go. These four are the card's context lines
            // — what the carriers have said about THIS transfer — so they group
            // without inventing a relationship. Group flattens into the
            // enclosing stack, so nothing about the layout changes.
            //
            // The block stands at NINE children after #523's hold note above.
            // The tenth is the last one that fits; the eleventh does not
            // compile, and the error it produces names none of this.
            Group {
                if let foc = port.foc_date {
                    Text(
                        AppStrings.translate(
                            appLocale, "settingsMore.focDate", ["date": foc]
                        )
                    )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                }
                if port.status == PortStatus.exception {
                    // #319: the carrier's own token translated into what happened
                    // and the one thing to change, with a jump into the fix sheet
                    // at the field it concerns. The raw reason is not lost — the
                    // notice keeps it on screen, demoted, and it is all the
                    // customer has when the catalogue does not recognise it.
                    RejectionNotice(
                        domain: .port,
                        reason: port.rejection_reason,
                        submissionCount: port.submission_count,
                        onGoToField: { field in
                            // Viewers read the rejection but cannot act on it, the
                            // same way "Fix and resubmit" below is owner/admin only.
                            guard canManage else { return }
                            focusField = field
                            fixing = true
                        }
                    )
                    .padding(.top, 8)
                }
                if let bridge = port.bridge_number_e164 {
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "settingsMore.bridgeNumber",
                            ["number": formatPhone(bridge)]
                        )
                    )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                }
                if port.assignment_blocked {
                    Text(AppStrings.translate(appLocale, "settingsMore.registrationHeld"))
                    .font(.footnote)
                    .padding(.top, 6)
                }
            }
            if isPreCutover {
                // Last of the informational block, above the actions: where the
                // transfer is, then the facts about it, then what to do about
                // them while there is still time.
                PreCutoverChecklist()
            }

            // Documents: needed while draft (first submit) or exception (resubmit).
            if canManage && (port.status == PortStatus.draft || port.status == PortStatus.exception) {
                Spacer().frame(height: 8)
                PortDocumentsRow(scope: scope, port: port, onChanged: onChanged)
            }

            InlineError(actionError)
            HStack(spacing: 8) {
                if canManage && port.status == PortStatus.draft && port.has_loa && port.has_invoice {
                    Button(
                        AppStrings.translate(
                            appLocale,
                            busy ? "settingsMore.submitting" : "settingsMore.submitTransfer"
                        )
                    ) { submit() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(busy)
                }
                if canManage && port.status == PortStatus.exception {
                    Button(AppStrings.translate(appLocale, "settingsMore.fixResubmit")) {
                        focusField = nil
                        fixing = true
                    }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(busy)
                }
                if canCancel && port.status != PortStatus.ported && port.status != PortStatus.cancelPending {
                    Button(AppStrings.translate(appLocale, "settingsMore.cancelTransfer")) {
                        cancelling = true
                    }
                        .font(.subheadline)
                        .foregroundStyle(BrandColor.destructive)
                        .buttonStyle(.borderless)
                        .disabled(busy)
                }
            }
            .padding(.top, 6)
        }
        .sheet(isPresented: $fixing) {
            FixPortSheet(scope: scope, port: port, focusField: focusField) {
                fixing = false
                onChanged()
            } onDismiss: {
                fixing = false
            }
        }
        .sheet(isPresented: $cancelling) {
            ConfirmSheet(
                title: AppStrings.translate(appLocale, "settingsMore.cancelTransferTitle"),
                message: AppStrings.translate(appLocale, "settingsMore.cancelTransferBody"),
                confirmLabel: AppStrings.translate(appLocale, "settingsMore.cancelTransfer"),
                destructive: true,
                pending: busy,
                error: actionError,
                dismissLabel: AppStrings.translate(appLocale, "settingsMore.keepItGoing"),
                onConfirm: { cancel() },
                onDismiss: { cancelling = false }
            )
        }
    }

    @ViewBuilder
    private var statusPill: some View {
        if onHold {
            // #523: FIRST, so it can only ever replace the completed "Ported"
            // pill — `portedLineIsOnHold` is false for every other status.
            //
            // "On hold" in the amber tone, the same three words and the same
            // tone the number card's pill uses for this row: one line, one
            // status word, whichever of its two cards the owner looks at. The
            // pill it displaces was "Ported" in the POSITIVE (lime) tone, which
            // is the loudest claim on the card and reads as "all done" — over a
            // number that can neither send nor answer. The sentence under the
            // stepper says which of the transfer and the line is held, so the
            // shorter label cannot be read as the transfer stalling.
            StatusPill(
                label: AppStrings.translate(appLocale, "settingsMore.portOnHold"),
                tone: .warn
            )
        } else {
            switch port.status {
            case PortStatus.cancelPending:
                StatusPill(
                    label: AppStrings.translate(appLocale, "settingsMore.portCancelling"),
                    tone: .neutral
                )
            case PortStatus.exception:
                StatusPill(
                    label: AppStrings.translate(
                        appLocale, "settingsMore.portNeedsAttention"
                    ),
                    tone: .warn
                )
            case PortStatus.ported:
                StatusPill(
                    label: AppStrings.translate(appLocale, "settingsMore.portStepPorted"),
                    tone: .positive
                )
            default:
                let index = portStepIndex(port.status)
                // The carrier's own status word is the last resort, and it is
                // deliberately NOT translated: it is theirs, and a guess at what
                // a token we have never seen means would be worse than showing
                // it. Same rule as the rejection reason two cards down.
                StatusPill(
                    label: portStepKeys.indices.contains(index)
                        ? AppStrings.translate(appLocale, portStepKeys[index])
                        : port.status,
                    tone: .warn
                )
            }
        }
    }

    private func submit() {
        busy = true
        actionError = nil
        Task {
            do {
                _ = try await scope.repo.submitPort(scope.companyId, portId: port.id)
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.transferSubmitted")
                )
                onChanged()
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }

    private func cancel() {
        busy = true
        actionError = nil
        Task {
            do {
                _ = try await scope.repo.cancelPort(scope.companyId, portId: port.id)
                cancelling = false
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.transferCancelled")
                )
                onChanged()
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }
}

/// The calm 4-step tracker: Draft → Submitted → In progress → Ported.
private struct PortStepper: View {
    let status: String

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        let index = portStepIndex(status)
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(portStepKeys.enumerated()), id: \.offset) { i, step in
                VStack(spacing: 2) {
                    Circle()
                        .fill(index >= i ? BrandColor.olive : Color(.secondarySystemFill))
                        .frame(width: 10, height: 10)
                    Text(AppStrings.translate(appLocale, step))
                        .font(.caption2)
                        .foregroundStyle(index >= i ? Color.primary : Color.secondary)
                }
                if i < portStepKeys.count - 1 {
                    Rectangle()
                        .fill(index > i ? BrandColor.olive : Color(.separator).opacity(0.5))
                        .frame(height: 2)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 4)
                        .padding(.top, 4)
                }
            }
        }
    }
}

/// #319 — the four things to do BEFORE the switch, shown only while a transfer
/// is in flight (`PortCard.isPreCutover`).
///
/// All four lines already existed, in a marketing blog post, which is the one
/// place a customer who is already mid-port never looks: until now this card
/// told somebody who had just handed over the line their business runs on that
/// a transfer was in progress, and nothing else. Two of them are why it earns
/// the space — cancelling the old service early can release the number back
/// into the carrier pool, and that is the one way to genuinely lose it; and the
/// number moves but the conversations do not, so exporting is only possible
/// before the cutover, which makes saying it afterwards worthless.
///
/// The order is by what it costs to get wrong, not by chronology: the item that
/// can lose them the number goes first, because a skim reads the bold leads
/// top-down and stops early. Fixed copy, fixed order, byte-identical on web and
/// Android, and nothing is added after the fourth.
///
/// Deliberately quieter than the status pill above it. Nothing has gone wrong
/// here, so it borrows ``ReachNote``'s neutral shell — the same inset well and
/// radius — rather than the amber or destructive containers: a
/// warning panel under a healthy transfer reads as a transfer that is not
/// healthy, and it would out-shout the one line that reports where the transfer
/// actually is. Hierarchy is carried by size and weight alone, no tint and no
/// icons.
private struct PreCutoverChecklist: View {
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(AppStrings.translate(appLocale, "settingsMore.beforeSwitch"))
                .font(.footnote.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            ForEach(preCutoverSteps, id: \.lead) { step in
                item(step.lead, step.detail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.top, 8)
    }

    /// The lead, then the sentence it owns. The pair is tighter (2) than the gap
    /// between items (10) so the sentence reads as belonging to the lead above
    /// it; at even spacing four pairs collapse into one paragraph and the order
    /// stops meaning anything. `fixedSize` on both is this app's standing fix
    /// for multi-line text truncating to one line inside a stack.
    private func item(_ lead: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(lead)
                .font(.caption.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct PortDocumentsRow: View {
    let scope: SettingsScope
    let port: PortRequest
    let onChanged: @MainActor () -> Void

    @State private var uploading = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Text(AppStrings.translate(appLocale, "settingsMore.portDocsNote"))
        .font(.footnote)
        .foregroundStyle(.secondary)
        HStack(spacing: 8) {
            DocumentPickButton(
                label: AppStrings.translate(
                    appLocale,
                    port.has_loa ? "settingsMore.replaceLoa" : "settingsMore.uploadLoa"
                ),
                fieldName: "loa",
                disabled: uploading,
                onPicked: { upload($0) },
                onError: { error = $0 }
            )
            DocumentPickButton(
                label: AppStrings.translate(
                    appLocale,
                    port.has_invoice ? "settingsMore.replaceBill" : "settingsMore.uploadBill"
                ),
                fieldName: "invoice",
                disabled: uploading,
                onPicked: { upload($0) },
                onError: { error = $0 }
            )
        }
        .padding(.top, 6)
        if uploading {
            Text(AppStrings.translate(appLocale, "settingsMore.uploading"))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        }
        InlineError(error)
    }

    private func upload(_ document: DocumentUpload) {
        uploading = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.uploadPortDocuments(
                    scope.companyId,
                    portId: port.id,
                    parts: [document]
                )
                scope.showMessage(
                    AppStrings.translate(
                        appLocale,
                        document.fieldName == "loa"
                            ? "settingsMore.loaUploaded"
                            : "settingsMore.billUploaded"
                    )
                )
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            uploading = false
        }
    }
}

// MARK: - Start-a-port sheet: portability check first, then the full account form

private struct StartPortSheet: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCreated: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var phoneInput = ""
    @State private var check: PortabilityCheck?
    @State private var checkedE164: String?
    @State private var form = PortForm()
    @State private var wantsBridge = false
    @State private var pending = false
    @State private var error: String?
    @State private var idempotencyKey = UUID().uuidString

    @Environment(\.appLocale) private var appLocale

    private var wireless: Bool { check?.is_wireless == true }
    private var readyForForm: Bool { check?.portable == true }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !readyForForm {
                        TextField(
                            AppStrings.translate(appLocale, "settingsMore.phoneSample"),
                            text: $phoneInput
                        )
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.phonePad)
                            .disabled(pending)
                        Text(AppStrings.translate(appLocale, "settingsMore.numberToTransfer"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.top, 2)
                        if let verdict = check, !verdict.portable {
                            // The carrier's own refusal wins when there is one;
                            // ours is only the fallback.
                            Text(
                                verdict.reason
                                    ?? AppStrings.translate(
                                        appLocale, "settingsMore.notPortable"
                                    )
                            )
                                .font(.footnote)
                                .padding(.top, 8)
                        }
                    } else if let verdict = check {
                        Text(
                            AppStrings.translate(
                                appLocale,
                                "settingsMore.canBeTransferred",
                                ["number": formatPhone(checkedE164)]
                            )
                                + (wireless
                                    ? AppStrings.translate(
                                        appLocale, "settingsMore.wirelessRequires"
                                    )
                                    : "")
                        )
                        .font(.callout)
                        if !verdict.messaging_capable {
                            Text(AppStrings.translate(appLocale, "settingsMore.mayNotText"))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.top, 4)
                        }
                        Spacer().frame(height: 10)
                        PortFormFields(
                            form: $form,
                            wireless: wireless,
                            country: verdict.country ?? company.country,
                            enabled: !pending
                        )
                        LabeledToggleRow(
                            label: AppStrings.translate(
                                appLocale, "settingsMore.wantBridge"
                            ),
                            supporting: AppStrings.translate(
                                appLocale, "settingsMore.wantBridgeSupporting"
                            ),
                            isOn: wantsBridge,
                            enabled: !pending
                        ) { wantsBridge = $0 }
                    }
                    InlineError(error)
                    Spacer().frame(height: 16)
                    if !readyForForm {
                        Button(
                            AppStrings.translate(
                                appLocale,
                                pending ? "settingsMore.checking" : "settingsMore.checkNumber"
                            )
                        ) { checkNumber() }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandColor.olive)
                            .disabled(pending || phoneInput.isBlank)
                    } else {
                        Button(
                            AppStrings.translate(
                                appLocale,
                                pending
                                    ? "settingsMore.creating"
                                    : "settingsMore.createTransfer"
                            )
                        ) { create() }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandColor.olive)
                            .disabled(pending || !form.isComplete(wireless: wireless))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle(AppStrings.translate(appLocale, "settingsMore.bringNumber"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) { onDismiss() }
                        .disabled(pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
    }

    private func checkNumber() {
        guard let e164 = normalizeNanpInput(phoneInput) else {
            error = AppStrings.translate(appLocale, "settingsMore.enterFullNanp")
            return
        }
        pending = true
        error = nil
        Task {
            do {
                check = try await scope.repo.checkPortability(scope.companyId, phoneE164: e164)
                checkedE164 = e164
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }

    private func create() {
        guard let e164 = checkedE164 else { return }
        pending = true
        error = nil
        var body = form.fieldsJson(wireless: wireless)
        body["phone_e164"] = .string(e164)
        body["wants_bridge_number"] = .bool(wantsBridge)
        let key = idempotencyKey
        let payload = JSONValue.object(body)
        Task {
            do {
                _ = try await scope.repo.createPort(scope.companyId, idempotencyKey: key, body: payload)
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.transferCreated")
                )
                onCreated()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

// MARK: - Fix-and-resubmit sheet (exception → PUT, then POST /resubmit)

private struct FixPortSheet: View {
    let scope: SettingsScope
    let port: PortRequest
    let onDone: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var form: PortForm
    @State private var pending = false
    @State private var error: String?
    /// #319: which field to put the cursor in — seeded by the notice on the
    /// card, and reset by the notice in here.
    @State private var focusTarget: String?

    @Environment(\.appLocale) private var appLocale

    init(
        scope: SettingsScope,
        port: PortRequest,
        focusField: String? = nil,
        onDone: @escaping @MainActor () -> Void,
        onDismiss: @escaping @MainActor () -> Void
    ) {
        self.scope = scope
        self.port = port
        self.onDone = onDone
        self.onDismiss = onDismiss
        _focusTarget = State(initialValue: focusField)
        _form = State(initialValue: PortForm(
            entityName: port.entity_name,
            authPersonName: port.auth_person_name,
            accountNumber: "",
            street: port.service_street,
            locality: port.service_locality,
            adminArea: port.service_admin_area,
            postalCode: port.service_postal_code
        ))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // #319: the same translation the card carries, kept in front
                    // of the customer while they retype the fields it names.
                    // Only a rejected transfer can open this sheet, so there is
                    // always something to explain.
                    RejectionNotice(
                        domain: .port,
                        reason: port.rejection_reason,
                        submissionCount: port.submission_count,
                        onGoToField: { focusTarget = $0 }
                    )
                    .padding(.bottom, 8)
                    Text(AppStrings.translate(appLocale, "settingsMore.reenterSecrets"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 6)
                    PortFormFields(
                        form: $form,
                        wireless: port.is_wireless,
                        country: port.country,
                        enabled: !pending,
                        focusField: $focusTarget
                    )
                    InlineError(error)
                    Spacer().frame(height: 16)
                    Button(
                        AppStrings.translate(
                            appLocale,
                            pending ? "settingsMore.resubmitting" : "settingsMore.resubmit"
                        )
                    ) { resubmit() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(pending || !form.isComplete(wireless: port.is_wireless))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle(AppStrings.translate(appLocale, "settingsMore.fixResubmit"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) { onDismiss() }
                        .disabled(pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
    }

    private func resubmit() {
        pending = true
        error = nil
        let payload = JSONValue.object(form.fieldsJson(wireless: port.is_wireless))
        Task {
            do {
                _ = try await scope.repo.updatePort(scope.companyId, portId: port.id, body: payload)
                _ = try await scope.repo.resubmitPort(scope.companyId, portId: port.id)
                scope.showMessage(
                    AppStrings.translate(appLocale, "settingsMore.transferResubmitted")
                )
                onDone()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

/// One row of the pre-cutover list: a bold lead a skim can stop at, and the
/// sentence it owns.
struct PortPreCutoverStep {
    let lead: String
    let detail: String
}

/// #248: the guidance as DATA, so a test can hold it against
/// `packages/shared/src/porting.ts` rather than a person holding it in their head.
///
/// It was written inline in the view here, which is why nothing could check it.
/// The shared module has said from the start that these four strings exist as data
/// precisely so they can be asserted across web, Android and iOS, "and it drifts
/// silently if hand-kept" — and then two of the three kept them by hand anyway.
///
/// The first line is the whole reason: cancelling the old service before the
/// transfer completes can release the number back to the carrier pool, which is
/// the one way a business genuinely loses the number on its trucks.
let preCutoverSteps: [PortPreCutoverStep] = [
    PortPreCutoverStep(
        lead: "Keep your old service active.",
        detail: "Cancelling before the transfer finishes can release the number back "
            + "to the carrier, and that is the one way to genuinely lose it."
    ),
    PortPreCutoverStep(
        lead: "Export your message history.",
        detail: "The number moves, your old conversations do not."
    ),
    PortPreCutoverStep(
        lead: "Tell the crew the switch date.",
        detail: "From that morning, calls and texts arrive in this inbox instead of "
            + "the old one."
    ),
    PortPreCutoverStep(
        lead: "Expect texting to trail calls.",
        detail: "Voice and texting can finish on different clocks, so texts may take "
            + "an extra day. We will tell you when both are live."
    ),
]

/// The four statuses a transfer is in flight for, and the list is shown for.
///
/// Excluded on purpose: `draft` (nothing in flight yet), `exception` (the rejection
/// notice owns that screen), and `ported` onwards (too late to export, moot once
/// the switch has happened). An allowlist, so a status the carrier adds later
/// starts silent and gets considered.
let preCutoverStatuses: Set<String> = [
    PortStatus.submitted,
    PortStatus.inProcess,
    PortStatus.focDateConfirmed,
    PortStatus.activationInProgress,
]
