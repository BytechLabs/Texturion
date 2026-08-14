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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        ForEach(orders.filter { $0.status != TextEnablementStatus.cancelled }, id: \.id) { order in
            TextEnableCard(scope: scope, order: order, onChanged: onChanged)
        }

        if SettingsRoleGate.canManageNumbers(scope.role) && company.subscriptionActive {
            SettingsCard(
                title: t("settingsMore.textEnableTitle"),
                description: t("settingsMore.textEnableDesc")
            ) {
                Button(t("settingsMore.textEnableAction")) { starting = true }
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    private var canManage: Bool { SettingsRoleGate.canManageNumbers(scope.role) }
    private var canCancel: Bool { SettingsRoleGate.canCancelTextEnablement(scope.role) }

    private var open: Bool {
        order.status != TextEnablementStatus.completed && order.status != TextEnablementStatus.cancelled
    }

    var body: some View {
        SettingsCard(
            title: t(
                "settingsMore.textEnableCardTitle",
                ["number": formatPhone(order.phone_e164)]
            )
        ) {
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
                    Button(
                        busy ? t("settingsMore.resubmitting") : t("settingsMore.resubmit")
                    ) { resubmit() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(busy)
                }
                if canCancel && open {
                    Button(t("settingsMore.cancelOrder")) { cancelling = true }
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
                title: t("settingsMore.cancelTextEnableTitle"),
                message: t("settingsMore.cancelTextEnableBody"),
                confirmLabel: t("settingsMore.cancelOrder"),
                destructive: true,
                pending: busy,
                error: actionError,
                dismissLabel: t("settingsMore.keepItGoing"),
                onConfirm: { cancel() },
                onDismiss: { cancelling = false }
            )
        }
    }

    @ViewBuilder
    private var statusPill: some View {
        switch order.status {
        case TextEnablementStatus.completed:
            StatusPill(label: t("settingsMore.teLive"), tone: .positive)
        case TextEnablementStatus.failed:
            StatusPill(label: t("settingsMore.teFailed"), tone: .bad)
        case TextEnablementStatus.actionRequired:
            StatusPill(label: t("settingsMore.statusActionNeeded"), tone: .warn)
        case TextEnablementStatus.inProgress:
            StatusPill(label: t("settingsMore.teReviewing"), tone: .warn)
        case TextEnablementStatus.pending:
            StatusPill(label: t("settingsMore.teReceived"), tone: .warn)
        default:
            // The wire's own word for a status this build has never heard of.
            // Not translated, deliberately: inventing French for a state we
            // cannot name would be making something up about an order.
            StatusPill(label: order.status, tone: .neutral)
        }
    }

    private var statusCopy: String {
        // The carrier's own sentence, appended where there is one — a colon and
        // the reason, or a full stop. Both are catalogue entries because French
        // puts a space before a colon and English does not.
        let carrierSays = order.last_error.map {
            t("settingsMore.colonReason", ["reason": $0])
        } ?? t("settingsMore.fullStop")
        switch order.status {
        case TextEnablementStatus.completed:
            return t("settingsMore.teLiveBody")
        case TextEnablementStatus.failed:
            return t("settingsMore.teFailedBody")
                + carrierSays
                + t("settingsMore.teFixAndResubmit")
        case TextEnablementStatus.actionRequired:
            return t("settingsMore.teActionBody") + carrierSays
        default:
            return t("settingsMore.teReviewingBody")
        }
    }

    private func resubmit() {
        busy = true
        actionError = nil
        Task {
            do {
                _ = try await scope.repo.resubmitTextEnablement(scope.companyId, orderId: order.id)
                scope.showMessage(t("settingsMore.orderResubmitted"))
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
                scope.showMessage(t("settingsMore.textEnableCancelled"))
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        Text(t("settingsMore.teDocsNote"))
            .font(.footnote)
            .foregroundStyle(.secondary)
        HStack(spacing: 8) {
            DocumentPickButton(
                label: t(
                    order.has_loa ? "settingsMore.replaceLoa" : "settingsMore.uploadLoa"
                ),
                fieldName: "loa",
                disabled: uploading,
                onPicked: { upload($0) },
                onError: { error = $0 }
            )
            DocumentPickButton(
                label: t(
                    order.has_bill ? "settingsMore.replaceBill" : "settingsMore.uploadBill"
                ),
                fieldName: "bill",
                disabled: uploading,
                onPicked: { upload($0) },
                onError: { error = $0 }
            )
        }
        .padding(.top, 6)
        if uploading {
            Text(t("settingsMore.uploading"))
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
                    t(
                        document.fieldName == "loa"
                            ? "settingsMore.loaUploaded"
                            : "settingsMore.plainBillUploaded"
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

private struct VerificationRow: View {
    let scope: SettingsScope
    let order: TextEnablementOrder
    let onChanged: @MainActor () -> Void

    @State private var code = ""
    @State private var requesting = false
    @State private var verifying = false
    @State private var error: String?
    @State private var codeSent = false

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        Text(t("settingsMore.ownershipCheckNote"))
            .font(.footnote)
            .foregroundStyle(.secondary)
        HStack(spacing: 8) {
            Button(t("settingsMore.textMeTheCode")) { requestCode("sms") }
                .buttonStyle(.bordered)
                .disabled(requesting || verifying)
            Button(t("settingsMore.callMeInstead")) { requestCode("call") }
                .buttonStyle(.bordered)
                .disabled(requesting || verifying)
        }
        .padding(.top, 6)
        if codeSent {
            HStack(spacing: 8) {
                TextField(t("settingsMore.verificationCode"), text: Binding(
                    get: { code },
                    set: { next in
                        if next.count <= 16 { code = next }
                    }
                ))
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .disabled(verifying)
                Button(
                    verifying ? t("settingsMore.checking") : t("settingsMore.verify")
                ) { verify() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
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
                    t(
                        method == "sms"
                            ? "settingsMore.codeSentBySms"
                            : "settingsMore.codeComingByCall"
                    )
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
                scope.showMessage(t("settingsMore.numberVerified"))
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        ConfirmSheet(
            title: t("settingsMore.textEnableTitle"),
            message: t("settingsMore.startTextEnableBody"),
            confirmLabel: t("settingsMore.start"),
            pending: pending,
            error: error,
            onConfirm: { create() },
            onDismiss: { onDismiss() }
        ) {
            TextField(t("settingsMore.phoneSample"), text: $phoneInput)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.phonePad)
                .disabled(pending)
                .padding(.top, 10)
            Text(t("settingsMore.landlineNumberLabel"))
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
        }
    }

    private func create() {
        guard let e164 = normalizeNanpInput(phoneInput) else {
            error = t("settingsMore.enterFullNanp")
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
                scope.showMessage(t("settingsMore.teOrderCreated"))
                onCreated()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}
