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

private struct PortFormFields: View {
    @Binding var form: PortForm
    let wireless: Bool
    let country: String
    let enabled: Bool

    private var ssnLabel: String { country == "US" ? "SSN" : "SIN" }
    private var regionLabel: String { country == "US" ? "State" : "Province" }
    private var postalLabel: String { country == "US" ? "ZIP code" : "Postal code" }

    var body: some View {
        Text(
            "Enter these exactly as they appear on your current carrier's bill — "
                + "mismatches are the top cause of rejections."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        field("Account holder", text: $form.entityName)
        field("Authorized person", text: $form.authPersonName)
        field("Account number", text: $form.accountNumber)
        if wireless {
            Text(
                "This is a mobile number. Enter the transfer PIN and the last 4 of the "
                    + "account holder's \(ssnLabel). We store only the last 4."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.top, 4)
            field("Transfer PIN", text: $form.pinPasscode)
            TextField("Last 4 of \(ssnLabel)", text: Binding(
                get: { form.ssnSinLast4 },
                set: { next in
                    if next.count <= 4 && next.allSatisfy(\.isNumber) {
                        form.ssnSinLast4 = next
                    }
                }
            ))
            .textFieldStyle(.roundedBorder)
            .keyboardType(.numberPad)
            .disabled(!enabled)
            .padding(.vertical, 4)
        }
        field("Street address", text: $form.street)
        field("City", text: $form.locality)
        field(regionLabel, text: $form.adminArea)
        field(postalLabel, text: $form.postalCode)
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        TextField(label, text: text)
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
    let onChanged: @MainActor () -> Void

    @State private var starting = false

    var body: some View {
        ForEach(ports.filter { $0.status != PortStatus.cancelled }, id: \.id) { port in
            PortCard(scope: scope, port: port, onChanged: onChanged)
        }

        if SettingsRoleGate.canManageNumbers(scope.role) && company.subscriptionActive {
            SettingsCard(
                title: "Bring your existing number",
                description: "Transfer a number you already own. It keeps working with "
                    + "your current carrier until the switch completes — usually a few "
                    + "business days. Transfers are free."
            ) {
                Button("Start a transfer") { starting = true }
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
    let onChanged: @MainActor () -> Void

    @State private var fixing = false
    @State private var cancelling = false
    @State private var busy = false
    @State private var actionError: String?

    private var canManage: Bool { SettingsRoleGate.canManageNumbers(scope.role) }
    private var canCancel: Bool { SettingsRoleGate.canCancelPort(scope.role) }

    var body: some View {
        SettingsCard(title: "Transfer: \(formatPhone(port.phone_e164))") {
            statusPill
            Spacer().frame(height: 8)
            PortStepper(status: port.status)

            if let foc = port.foc_date {
                Text("The carriers agreed on a switch date: \(foc).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }
            if port.status == PortStatus.exception {
                Text(
                    "Your current carrier rejected the transfer"
                        + (port.rejection_reason.map { ": \($0)" } ?? ".")
                        + " Fix the details and resubmit — nothing is lost."
                )
                .font(.footnote)
                .padding(.top, 6)
            }
            if let bridge = port.bridge_number_e164 {
                Text("Temporary number while you wait: \(formatPhone(bridge)).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }
            if port.assignment_blocked {
                Text(
                    "Your number arrived, but its texting registration is still held by "
                        + "your previous texting provider. Ask them to release it, and "
                        + "texting switches on automatically."
                )
                .font(.footnote)
                .padding(.top, 6)
            }

            // Documents: needed while draft (first submit) or exception (resubmit).
            if canManage && (port.status == PortStatus.draft || port.status == PortStatus.exception) {
                Spacer().frame(height: 8)
                PortDocumentsRow(scope: scope, port: port, onChanged: onChanged)
            }

            InlineError(actionError)
            HStack(spacing: 8) {
                if canManage && port.status == PortStatus.draft && port.has_loa && port.has_invoice {
                    Button(busy ? "Submitting…" : "Submit transfer") { submit() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(busy)
                }
                if canManage && port.status == PortStatus.exception {
                    Button("Fix and resubmit") { fixing = true }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(busy)
                }
                if canCancel && port.status != PortStatus.ported && port.status != PortStatus.cancelPending {
                    Button("Cancel transfer") { cancelling = true }
                        .font(.subheadline)
                        .foregroundStyle(BrandColor.destructive)
                        .buttonStyle(.borderless)
                        .disabled(busy)
                }
            }
            .padding(.top, 6)
        }
        .sheet(isPresented: $fixing) {
            FixPortSheet(scope: scope, port: port) {
                fixing = false
                onChanged()
            } onDismiss: {
                fixing = false
            }
        }
        .sheet(isPresented: $cancelling) {
            ConfirmSheet(
                title: "Cancel this transfer?",
                message: "Your number stays with your current carrier and nothing changes "
                    + "there. You can start a new transfer any time.",
                confirmLabel: "Cancel transfer",
                destructive: true,
                pending: busy,
                error: actionError,
                dismissLabel: "Keep it going",
                onConfirm: { cancel() },
                onDismiss: { cancelling = false }
            )
        }
    }

    @ViewBuilder
    private var statusPill: some View {
        switch port.status {
        case PortStatus.cancelPending:
            StatusPill(label: "Cancelling", tone: .neutral)
        case PortStatus.exception:
            StatusPill(label: "Needs attention", tone: .warn)
        case PortStatus.ported:
            StatusPill(label: "Ported", tone: .positive)
        default:
            let index = portStepIndex(port.status)
            StatusPill(
                label: (portSteps.indices.contains(index) ? portSteps[index] : port.status),
                tone: .warn
            )
        }
    }

    private func submit() {
        busy = true
        actionError = nil
        Task {
            do {
                _ = try await scope.repo.submitPort(scope.companyId, portId: port.id)
                scope.showMessage("Transfer submitted to the carriers.")
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
                scope.showMessage("Transfer cancelled.")
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

    var body: some View {
        let index = portStepIndex(status)
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(portSteps.enumerated()), id: \.offset) { i, step in
                VStack(spacing: 2) {
                    Circle()
                        .fill(index >= i ? BrandColor.olive : Color(.secondarySystemFill))
                        .frame(width: 10, height: 10)
                    Text(step)
                        .font(.caption2)
                        .foregroundStyle(index >= i ? Color.primary : Color.secondary)
                }
                if i < portSteps.count - 1 {
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

private struct PortDocumentsRow: View {
    let scope: SettingsScope
    let port: PortRequest
    let onChanged: @MainActor () -> Void

    @State private var uploading = false
    @State private var error: String?

    var body: some View {
        Text(
            "Two documents are needed: a signed letter of authorization and a recent "
                + "bill from your current carrier (PDF, PNG, or JPEG)."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        HStack(spacing: 8) {
            DocumentPickButton(
                label: port.has_loa ? "Replace LOA ✓" : "Upload LOA",
                fieldName: "loa",
                disabled: uploading,
                onPicked: { upload($0) },
                onError: { error = $0 }
            )
            DocumentPickButton(
                label: port.has_invoice ? "Replace bill ✓" : "Upload bill",
                fieldName: "invoice",
                disabled: uploading,
                onPicked: { upload($0) },
                onError: { error = $0 }
            )
        }
        .padding(.top, 6)
        if uploading {
            Text("Uploading…")
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
                    document.fieldName == "loa"
                        ? "Letter of authorization uploaded."
                        : "Carrier bill uploaded."
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

    private var wireless: Bool { check?.is_wireless == true }
    private var readyForForm: Bool { check?.portable == true }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !readyForForm {
                        TextField("(416) 555-0182", text: $phoneInput)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.phonePad)
                            .disabled(pending)
                        Text("Number to transfer")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.top, 2)
                        if let verdict = check, !verdict.portable {
                            Text(verdict.reason ?? "That number can't be transferred automatically.")
                                .font(.footnote)
                                .padding(.top, 8)
                        }
                    } else if let verdict = check {
                        Text(
                            formatPhone(checkedE164) + " can be transferred."
                                + (wireless
                                    ? " It's a mobile number, so a transfer PIN and ID check are required."
                                    : "")
                        )
                        .font(.callout)
                        if !verdict.messaging_capable {
                            Text(
                                "Heads up: this number may not support texting after the "
                                    + "transfer — calls will still work."
                            )
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
                            label: "Give me a temporary number while it transfers",
                            supporting: "Optional. Texting starts right away on the "
                                + "temporary number; your own number takes over when the "
                                + "transfer completes.",
                            isOn: wantsBridge,
                            enabled: !pending
                        ) { wantsBridge = $0 }
                    }
                    InlineError(error)
                    Spacer().frame(height: 16)
                    if !readyForForm {
                        Button(pending ? "Checking…" : "Check the number") { checkNumber() }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandColor.olive)
                            .disabled(pending || phoneInput.isBlank)
                    } else {
                        Button(pending ? "Creating…" : "Create the transfer") { create() }
                            .buttonStyle(.borderedProminent)
                            .tint(BrandColor.olive)
                            .disabled(pending || !form.isComplete(wireless: wireless))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle("Bring your existing number")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
                        .disabled(pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
    }

    private func checkNumber() {
        guard let e164 = normalizeNanpInput(phoneInput) else {
            error = "Enter a full 10-digit US or Canadian number."
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
                scope.showMessage("Transfer created. Upload the two documents to submit it.")
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

    init(
        scope: SettingsScope,
        port: PortRequest,
        onDone: @escaping @MainActor () -> Void,
        onDismiss: @escaping @MainActor () -> Void
    ) {
        self.scope = scope
        self.port = port
        self.onDone = onDone
        self.onDismiss = onDismiss
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
                    if let reason = port.rejection_reason {
                        Text("Rejection reason: \(reason)")
                            .font(.footnote)
                            .padding(.bottom, 8)
                    }
                    Text("The account number and PIN are never shown back for security — re-enter them.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 6)
                    PortFormFields(
                        form: $form,
                        wireless: port.is_wireless,
                        country: port.country,
                        enabled: !pending
                    )
                    InlineError(error)
                    Spacer().frame(height: 16)
                    Button(pending ? "Resubmitting…" : "Resubmit") { resubmit() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(pending || !form.isComplete(wireless: port.is_wireless))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle("Fix and resubmit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
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
                scope.showMessage("Transfer resubmitted.")
                onDone()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}
