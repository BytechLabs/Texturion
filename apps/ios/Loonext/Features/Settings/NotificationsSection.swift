import SwiftUI

/// #388: the wording is deliberately the SAME sentence as web and Android.
/// Three hand-written descriptions of one behaviour is how three clients end
/// up explaining a feature three different ways, and this one is about when a
/// customer's phone is answered — the copy has to be exact.
///
/// Five mirrors LEAD_CHASE_WIDEN_MINUTES in packages/shared/src/lead-chase.ts,
/// which the server reads. Swift cannot import it; if it ever changes, this
/// string and the Kotlin one change with it.
private let widenMinutes = 5

/// Notifications (#163): hosts #162's embeddable card — per-user email/push
/// toggles plus this device's push-permission state (system prompt /
/// settings deep-link / honest "unavailable in this build" arm, with the
/// #143 self-healing token re-upsert) — and states the one exception
/// plainly: billing and registration emails always reach owners and admins.
///
/// #463 folded the lead-chasing card INTO that one as a single row. It used to
/// be a titled card of its own holding two switches, and the owner's objection
/// was that all of it was special treatment for what is just another
/// notification setting. The second switch was also unreachable in practice —
/// see 01209b5.
@MainActor
struct NotificationsSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    var body: some View {
        // #386. ABOVE the toggles, because it contradicts the one directly
        // below it: an Email switch reading ON while every message bounces is
        // the screen telling a comfortable lie. Renders nothing when email is
        // working.
        EmailReachabilityCardView(scope: scope)

        VStack(alignment: .leading, spacing: 0) {
            NotificationPrefsCard(graph: scope.graph, companyId: scope.companyId) {
                LeadChaseRowView(
                    scope: scope,
                    company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                // #430: directly below the push settings it qualifies, because
                // an owner looking for it is thinking "what do my
                // notifications show", not "what is my data-protection
                // posture".
                PushContentRowView(
                    scope: scope,
                    company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.vertical, 6)

        Text(
            "Billing, usage, and registration emails always go to owners and admins — "
                + "they can't be turned off."
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
    }
}

/// #463 — one switch, sitting among the other notification settings.
///
/// WHAT THE OLD CARD GOT RIGHT AND THIS KEEPS. Everything else in that card is
/// per-person; this is workspace-wide, and the card's header said so. Silently
/// mixing the two scopes would let a member think they had muted something for
/// themselves when they had changed it for everyone. That warning is not
/// dropped — it moved into this row's own description, which is where somebody
/// looks before touching a switch.
///
/// The business-hours limit moved with it, for the same reason: it is not a
/// setting, it is the difference between silence at 7pm being expected and
/// silence at 7pm being a bug worth reporting.
///
/// Same sentence as web and Android, deliberately — see the note on
/// widenMinutes.
@MainActor
private struct LeadChaseRowView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    var body: some View {
        LabeledToggleRow(
            label: "Tell the whole crew after \(widenMinutes) minutes",
            supporting: "When a conversation is assigned to one person and they still "
                + "haven't replied, notify everyone who can see it. Business hours only, "
                + "and never someone who has turned their own notifications off. This one "
                + "is for the whole workspace, not just you"
                + (canEdit ? "." : " — only owners and admins can change it."),
            isOn: company.lead_chase_crew_enabled,
            enabled: canEdit && !saving
        ) { save(crew: $0) }

        InlineError(error)
    }

    // Saves on toggle rather than behind a Save button, unlike the away
    // message next door: there is no text to get wrong and no preview to
    // check, so a two-step commit would be ceremony around a switch.
    private func save(crew: Bool) {
        error = nil
        saving = true
        let body = JSONValue.object(["lead_chase_crew_enabled": .bool(crew)])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// #430 — whether a customer's words may ride a push notification.
///
/// PHRASED POSITIVELY, and on by default, so the toggle's "on" position is the
/// behaviour every workspace already has. A negative toggle ("hide message
/// content") makes the safe-looking position the one that changes things, and
/// an owner reading quickly cannot tell which way is the status quo.
///
/// The description leads with the ROOM rather than the feature: an owner does
/// not think about push payloads, they think about the phone on a workbench in
/// a customer's kitchen. Same sentence as web and Android, deliberately.
@MainActor
private struct PushContentRowView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    var body: some View {
        LabeledToggleRow(
            label: "Show message text on lock screens",
            supporting: "Notifications show who texted and the first line of what they "
                + "said, so the crew can tell a lead from a \"thanks\" without unlocking. "
                + "Turn this off and they'll still see who it was, but never what a "
                + "customer wrote — useful if phones are out on the job, in other "
                + "people's homes. This one is for the whole workspace, not just you"
                + (canEdit ? "." : " — only owners and admins can change it."),
            isOn: company.push_include_content,
            enabled: canEdit && !saving
        ) { save(include: $0) }

        InlineError(error)
    }

    private func save(include: Bool) {
        error = nil
        saving = true
        let body = JSONValue.object(["push_include_content": .bool(include)])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// #386 — "we can't reach this address."
///
/// A hard-bounced address is otherwise completely invisible to the person it
/// belongs to: their notifications simply stop, which is indistinguishable
/// from a quiet week. The point of this surface is that the failure becomes
/// FIXABLE rather than merely broken.
///
/// Renders nothing when email is working. A false "we can't reach you" is
/// worse than none — it sends somebody to fix an address that was never
/// broken.
///
/// Same words as web and Android, deliberately: this one explains why a person
/// is not hearing from us, and three wordings would be three different stories.
@MainActor
private struct EmailReachabilityCardView: View {
    let scope: SettingsScope

    @State private var cleared = false
    @State private var retrying = false
    @State private var error: String?

    var body: some View {
        // Driven by the `me` loaded when settings opened, so after a
        // successful retry it hides itself rather than waiting for a refetch
        // this screen has no trigger for. The server has already cleared it.
        if let state = scope.me.email_state, !cleared {
            SettingsCard(title: "We can't email you at \(state.email)") {
                if state.fixable {
                    Text(
                        "Emails to this address are bouncing, so we've stopped sending "
                            + "them. Push notifications still work. If the address was "
                            + "mistyped, fix it in your account first, then tell us to "
                            + "try again."
                    )
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)

                    InlineError(error)

                    Button(retrying ? "Trying…" : "Try this address again") { retry() }
                        .disabled(retrying)
                        .padding(.top, 10)
                } else {
                    // No button, on purpose. The address reported us as spam,
                    // and one tap in our own app is not that person's consent
                    // to start again.
                    Text(
                        "This address reported our email as spam, so we've stopped "
                            + "sending to it for good. Push notifications still work. To "
                            + "get email again, change your account to a different address."
                    )
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                }
            }
        }
    }

    private func retry() {
        error = nil
        retrying = true
        Task {
            do {
                _ = try await scope.repo.retryOwnEmail()
                cleared = true
                scope.showMessage("We'll try that address again on your next notification.")
            } catch {
                self.error = error.userMessage
            }
            retrying = false
        }
    }
}
