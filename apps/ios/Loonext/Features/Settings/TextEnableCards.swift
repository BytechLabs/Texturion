import SwiftUI

/// Text-enablement (#163): "keep your number" — hosted SMS on an existing
/// landline/VoIP number while calls stay with the current carrier. Orders are
/// carrier-reviewed over days; the cards say so plainly and texting is live
/// only at `completed`.
@MainActor
struct TextEnableBlock: View {
    let scope: SettingsScope
    let company: CompanyView
    let orders: [TextEnablementOrder]
    let onChanged: @MainActor () -> Void

    @State private var starting = false

    var body: some View {
        ForEach(orders.filter { $0.status != TextEnablementStatus.cancelled }, id: \.id) { order in
            TextEnableCard(scope: scope, order: order, onChanged: onChanged)
        }

        if SettingsRoleGate.canManageNumbers(scope.role) && company.subscriptionActive {
            SettingsCard(
                title: "Text-enable your landline",
                description: "Keep your number: texting runs through Loonext while calls "
                    + "stay exactly where they are today. The carrier review takes a few "
                    + "business days."
            ) {
                Button("Text-enable a number") { starting = true }
                    .buttonStyle(.bordered)
            }
            .sheet(isPresented: $starting) {
                StartTextEnableSheet(scope: scope) {
                    starting = false
                    onChanged()
                } onDismiss: {
                    starting = false
                }
            }
        }
    }
}

private struct TextEnableCard: View {
    let scope: SettingsScope
    let order: TextEnablementOrder
    let onChanged: @MainActor () -> Void

    @State private var busy = false
    @State private var cancelling = false
    @State private var actionError: String?

    private var canManage: Bool { SettingsRoleGate.canManageNumbers(scope.role) }
    private var canCancel: Bool { SettingsRoleGate.canCancelTextEnablement(scope.role) }

    private var open: Bool {
        order.status != TextEnablementStatus.completed && order.status != TextEnablementStatus.cancelled
    }

    var body: some View {
        SettingsCard(title: "Text-enable: \(formatPhone(order.phone_e164))") {
            statusPill
            Spacer().frame(height: 6)
            Text(statusCopy)
                .font(.footnote)
                .foregroundStyle(.secondary)

            if canManage && open {
                Spacer().frame(height: 8)
                TextEnableDocumentsRow(scope: scope, order: order, onChanged: onChanged)
                Spacer().frame(height: 8)
                VerificationRow(scope: scope, order: order, onChanged: onChanged)
            }

            InlineError(actionError)
            HStack(spacing: 8) {
                if canManage && order.status == TextEnablementStatus.failed {
                    Button(busy ? "Resubmitting…" : "Resubmit") { resubmit() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.petrol)
                        .disabled(busy)
                }
                if canCancel && open {
                    Button("Cancel order") { cancelling = true }
                        .font(.subheadline)
                        .foregroundStyle(BrandColor.destructive)
                        .buttonStyle(.borderless)
                        .disabled(busy)
                }
            }
            .padding(.top, 6)
        }
        .sheet(isPresented: $cancelling) {
            ConfirmSheet(
                title: "Cancel text-enablement?",
                message: "Nothing changes with your current carrier — the number keeps "
                    + "working exactly as it does today. You can start again any time.",
                confirmLabel: "Cancel order",
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
        switch order.status {
        case TextEnablementStatus.completed:
            StatusPill(label: "Texting live", tone: .positive)
        case TextEnablementStatus.failed:
            StatusPill(label: "Didn't go through", tone: .bad)
        case TextEnablementStatus.actionRequired:
            StatusPill(label: "Action needed", tone: .warn)
        case TextEnablementStatus.inProgress:
            StatusPill(label: "Carrier reviewing", tone: .warn)
        case TextEnablementStatus.pending:
            StatusPill(label: "Order received", tone: .warn)
        default:
            StatusPill(label: order.status, tone: .neutral)
        }
    }

    private var statusCopy: String {
        switch order.status {
        case TextEnablementStatus.completed:
            "Texting is live on this number. Calls stay with your current carrier."
        case TextEnablementStatus.failed:
            "The order didn't go through"
                + (order.last_error.map { ": \($0)" } ?? ".")
                + " Fix what's named and resubmit."
        case TextEnablementStatus.actionRequired:
            "The carrier needs something from you"
                + (order.last_error.map { ": \($0)" } ?? ".")
        default:
            "The carrier reviews text-enablement over a few business days. "
                + "Texting goes live only when the review completes — we'll "
                + "keep this card honest in the meantime."
        }
    }

    private func resubmit() {
        busy = true
        actionError = nil
        Task {
            do {
                _ = try await scope.repo.resubmitTextEnablement(scope.companyId, orderId: order.id)
                scope.showMessage("Order resubmitted.")
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
                _ = try await scope.repo.cancelTextEnablement(scope.companyId, orderId: order.id)
                cancelling = false
                scope.showMessage("Text-enablement cancelled.")
                onChanged()
            } catch {
                actionError = error.userMessage
            }
            busy = false
        }
    }
}

private struct TextEnableDocumentsRow: View {
    let scope: SettingsScope
    let order: TextEnablementOrder
    let onChanged: @MainActor () -> Void

    @State private var uploading = false
    @State private var error: String?

    var body: some View {
        Text(
            "Ownership proof: a signed letter of authorization and a recent bill for "
                + "the number (PDF, PNG, or JPEG)."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        HStack(spacing: 8) {
            DocumentPickButton(
                label: order.has_loa ? "Replace LOA ✓" : "Upload LOA",
                fieldName: "loa",
                disabled: uploading,
                onPicked: { upload($0) },
                onError: { error = $0 }
            )
            DocumentPickButton(
                label: order.has_bill ? "Replace bill ✓" : "Upload bill",
                fieldName: "bill",
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
                _ = try await scope.repo.uploadTextEnablementDocuments(
                    scope.companyId,
                    orderId: order.id,
                    parts: [document]
                )
                scope.showMessage(
                    document.fieldName == "loa" ? "Letter of authorization uploaded." : "Bill uploaded."
                )
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            uploading = false
        }
    }
}

private struct VerificationRow: View {
    let scope: SettingsScope
    let order: TextEnablementOrder
    let onChanged: @MainActor () -> Void

    @State private var code = ""
    @State private var requesting = false
    @State private var verifying = false
    @State private var error: String?
    @State private var codeSent = false

    var body: some View {
        Text("Number ownership check: the carrier sends a code to the number itself.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        HStack(spacing: 8) {
            Button("Text me the code") { requestCode("sms") }
                .buttonStyle(.bordered)
                .disabled(requesting || verifying)
            Button("Call me instead") { requestCode("call") }
                .buttonStyle(.bordered)
                .disabled(requesting || verifying)
        }
        .padding(.top, 6)
        if codeSent {
            HStack(spacing: 8) {
                TextField("Verification code", text: Binding(
                    get: { code },
                    set: { next in
                        if next.count <= 16 { code = next }
                    }
                ))
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .disabled(verifying)
                Button(verifying ? "Checking…" : "Verify") { verify() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.petrol)
                    .disabled(verifying || code.isBlank)
            }
            .padding(.top, 6)
        }
        InlineError(error)
    }

    private func requestCode(_ method: String) {
        requesting = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.requestVerificationCode(
                    scope.companyId,
                    orderId: order.id,
                    method: method
                )
                codeSent = true
                scope.showMessage(
                    method == "sms"
                        ? "Code sent by text to your number."
                        : "You'll get a call at your number with the code."
                )
            } catch {
                self.error = error.userMessage
            }
            requesting = false
        }
    }

    private func verify() {
        verifying = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.submitVerificationCode(
                    scope.companyId,
                    orderId: order.id,
                    code: code.trimmingCharacters(in: .whitespaces)
                )
                scope.showMessage("Number verified.")
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            verifying = false
        }
    }
}

private struct StartTextEnableSheet: View {
    let scope: SettingsScope
    let onCreated: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var phoneInput = ""
    @State private var pending = false
    @State private var error: String?
    @State private var idempotencyKey = UUID().uuidString

    var body: some View {
        ConfirmSheet(
            title: "Text-enable your landline",
            message: "Texting for this number runs through Loonext; calls stay with your "
                + "current carrier, nothing changes there. The carrier reviews the order "
                + "over a few business days, and you'll upload proof you own the number.",
            confirmLabel: "Start",
            pending: pending,
            error: error,
            onConfirm: { create() },
            onDismiss: { onDismiss() }
        ) {
            TextField("(416) 555-0182", text: $phoneInput)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.phonePad)
                .disabled(pending)
                .padding(.top, 10)
            Text("Your landline or VoIP number")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
        }
    }

    private func create() {
        guard let e164 = normalizeNanpInput(phoneInput) else {
            error = "Enter a full 10-digit US or Canadian number."
            return
        }
        pending = true
        error = nil
        let key = idempotencyKey
        Task {
            do {
                _ = try await scope.repo.createTextEnablement(
                    scope.companyId,
                    idempotencyKey: key,
                    phoneE164: e164
                )
                scope.showMessage("Order created. Upload the documents to move it along.")
                onCreated()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}
