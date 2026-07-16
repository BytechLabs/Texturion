import SwiftUI

/// US 10DLC registration (#163): brand + campaign status with honest dates,
/// rejection reason + resubmit (POST /v1/registration/submit), and the
/// sole-proprietor SMS OTP verify/resend step. The full wizard form stays on
/// the web — this surface tracks and unblocks.
@MainActor
struct RegistrationBlock: View {
    let scope: SettingsScope
    let company: CompanyView
    let registration: RegistrationDetailPair
    let onChanged: @MainActor () -> Void

    @State private var submitting = false
    @State private var error: String?

    private var canManage: Bool { SettingsRoleGate.canManageNumbers(scope.role) }

    var body: some View {
        // CA without US texting has nothing to register — say so once, plainly.
        if company.country == "CA" && !company.us_texting_enabled {
            SettingsCard(title: "Texting registration") {
                Text(
                    "No registration needed. Canadian texting works without one. "
                        + "Enabling US texting (from the web app) adds it."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        } else {
            SettingsCard(
                title: "Texting registration",
                description: "US carriers require every business texter to register (10DLC). "
                    + "Approval usually takes a few days; texting US numbers starts once both "
                    + "steps are approved."
            ) {
                let brand = registration.brand
                let campaign = registration.campaign
                if brand == nil && campaign == nil {
                    Text(
                        "Registration hasn't started yet. It's created automatically when "
                            + "your subscription starts."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                } else {
                    RegistrationRow(label: "Business identity", detail: brand)
                    Spacer().frame(height: 8)
                    RegistrationRow(label: "Messaging campaign", detail: campaign)

                    let rejected = [brand, campaign]
                        .compactMap { $0 }
                        .first { $0.status == RegistrationStatus.rejected }
                    if let rejected {
                        Spacer().frame(height: 8)
                        Text(
                            "The carrier registry rejected this"
                                + (rejected.rejection_reason.map { ": \($0)" } ?? ".")
                                + " Fix your details in the web app's registration wizard, then "
                                + "resubmit here."
                        )
                        .font(.footnote)
                        if canManage {
                            InlineError(error)
                            Button(submitting ? "Resubmitting…" : "Resubmit registration") { resubmit() }
                                .buttonStyle(.borderedProminent)
                                .tint(BrandColor.petrol)
                                .disabled(submitting)
                                .padding(.top, 8)
                        }
                    }

                    // Sole-proprietor brands verify ownership with an SMS PIN to
                    // the registered mobile — the one in-app unblock the registry
                    // needs.
                    if canManage, let brand, brand.sole_proprietor,
                       brand.status != RegistrationStatus.approved,
                       brand.status != RegistrationStatus.draft,
                       brand.status != RegistrationStatus.rejected {
                        Spacer().frame(height: 10)
                        SolePropOtpRow(scope: scope, onChanged: onChanged)
                    }

                    if !canManage {
                        Spacer().frame(height: 6)
                        ReadOnlyLine("Only owners and admins can change registration.")
                    }
                }
            }
        }
    }

    private func resubmit() {
        submitting = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.submitRegistration(scope.companyId)
                scope.showMessage("Registration resubmitted.")
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            submitting = false
        }
    }
}

private struct RegistrationRow: View {
    let label: String
    let detail: RegistrationDetail?

    private var line: String {
        guard let detail else { return "Not started" }
        switch detail.status {
        case RegistrationStatus.approved:
            return "Approved" + (detail.approved_at.map { " \(relativeTime($0)) ago" } ?? "")
        case RegistrationStatus.rejected:
            return "Rejected" + (detail.rejected_at.map { " \(relativeTime($0)) ago" } ?? "")
        case RegistrationStatus.submitted, RegistrationStatus.pending:
            return "In review" + (detail.submitted_at.map { " · submitted \(relativeTime($0)) ago" } ?? "")
        default:
            return "Draft — finish the wizard in the web app"
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.body)
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            pill
        }
    }

    @ViewBuilder
    private var pill: some View {
        switch detail?.status {
        case nil:
            StatusPill(label: "Not started", tone: .neutral)
        case RegistrationStatus.approved:
            StatusPill(label: "Approved", tone: .positive)
        case RegistrationStatus.rejected:
            StatusPill(label: "Rejected", tone: .bad)
        case RegistrationStatus.submitted, RegistrationStatus.pending:
            StatusPill(label: "In review", tone: .warn)
        default:
            StatusPill(label: "Draft", tone: .neutral)
        }
    }
}

private struct SolePropOtpRow: View {
    let scope: SettingsScope
    let onChanged: @MainActor () -> Void

    @State private var code = ""
    @State private var verifying = false
    @State private var resending = false
    @State private var error: String?

    var body: some View {
        Text(
            "One more step: the registry texted a 6-digit PIN to your registered mobile "
                + "to confirm it's really you."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        HStack(spacing: 8) {
            TextField("6-digit PIN", text: Binding(
                get: { code },
                set: { next in
                    if next.count <= 6 && next.allSatisfy(\.isNumber) {
                        code = next
                    }
                }
            ))
            .textFieldStyle(.roundedBorder)
            .keyboardType(.numberPad)
            .disabled(verifying || resending)
            Button(verifying ? "Checking…" : "Verify") { verify() }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.petrol)
                .disabled(verifying || resending || code.count != 6)
        }
        .padding(.top, 6)
        Button(resending ? "Sending…" : "Resend the PIN") { resend() }
            .buttonStyle(.bordered)
            .disabled(verifying || resending)
            .padding(.top, 6)
        InlineError(error)
    }

    private func verify() {
        verifying = true
        error = nil
        Task {
            do {
                _ = try await scope.repo.verifyRegistrationOtp(scope.companyId, code: code)
                scope.showMessage("Verified — the registry review continues.")
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            verifying = false
        }
    }

    private func resend() {
        resending = true
        error = nil
        Task {
            do {
                try await scope.repo.resendRegistrationOtp(scope.companyId)
                scope.showMessage("A new PIN is on its way.")
            } catch {
                self.error = error.userMessage
            }
            resending = false
        }
    }
}
