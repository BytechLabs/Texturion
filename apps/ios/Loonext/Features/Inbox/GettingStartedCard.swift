import SwiftUI

/**
 #476 — first-run guidance, on the client the crew actually uses.

 # Why the phone needed this more than the web did

 Plans allow 3 seats on Starter and 15 on Pro, so most people in this product
 are members rather than owners, and a member did not choose the tool — they
 were told to use it. That person is in a truck, not at a desk. The only client
 that had first-run guidance was the one serving the owner who had just walked
 a five-step wizard and picked the product deliberately.

 The copy is web's, verbatim; `packages/shared/src/first-run-copy.test.ts` reads
 all three client sources and fails when one drifts.

 *Applying: the Goal Gradient Effect — the bar is visible and neither list
 starts at zero for somebody who has already done something. Zen of Clarity —
 no card at all once there is nothing left to say.*
 */

// MARK: - Derivations (pure, mirrored by GettingStartedLogicTest.kt)

/// One row of the checklist.
struct StartedStep: Identifiable, Sendable, Equatable {
    let key: String
    let done: Bool
    let label: String
    var hint: String?

    var id: String { key }
}

/// Which of the two cards this person should see, or neither.
enum StartedAudience: Sendable {
    case setup
    case doingTheJob
    case none
}

/// Whether the workspace has paid, hand-ported from web's `hasPaid`.
///
/// NOT `subscription_status == active` alone, which is strictly narrower than
/// web and would hide the card from a past_due workspace that web shows it to —
/// the card would vanish at the exact moment somebody is most likely to be
/// confused about the state of their account.
func hasPaidStatus(_ status: String?) -> Bool {
    status == SubscriptionStatus.active
        || status == SubscriptionStatus.pastDue
        || status == SubscriptionStatus.unpaid
}

/// #315: capability sets, not ranks.
///
/// Web branches on `role === "owner" || role === "admin"` and everybody else
/// falls through to the member card. That leaves `read_only` reading a
/// checklist whose three items — reply, note, mark done — are all things the
/// role provably cannot do. So the member card asks for the axis its items
/// actually need, and a read-only observer sees no card rather than a list of
/// instructions they cannot follow.
func startedAudience(_ role: String?) -> StartedAudience {
    if MemberRole.has(role, Capability.settingsManage) { return .setup }
    if MemberRole.has(role, Capability.conversationsSend) { return .doingTheJob }
    return .none
}

/// Active members, the API's own filter (`deactivated_at IS NULL`).
func countActiveStartedMembers(_ members: [Member]) -> Int {
    members.filter { $0.deactivated_at == nil }.count
}

/// The setup list, for whoever can actually do the setup.
///
/// `signup` is credited done on purpose: this list only renders after payment,
/// so the reader picked a plan and paid before ever seeing it. A setup list
/// that starts at zero for somebody who has already done something reads as
/// "none of that counted".
func ownerSteps(
    numbers: [PhoneNumberSummary],
    hasConversation: Bool,
    usedSegments: Int,
    activeMemberCount: Int
) -> [StartedStep] {
    let numberDone = numbers.contains { $0.status == NumberStatus.active }
    let numberStalled =
        !numberDone && numbers.contains { $0.status == NumberStatus.provisionFailed }

    let numberHint: String? = {
        if numberDone { return nil }
        // Don't promise "under a minute" once a purchase has actually stalled:
        // the honest delayed line matches the app-wide status banner.
        if numberStalled {
            return "Taking a little longer than usual. You don't need to do anything."
        }
        return "It's on its way, usually under a minute."
    }()

    return [
        StartedStep(key: "signup", done: true, label: "Set your workspace up", hint: nil),
        StartedStep(
            key: "number",
            done: numberDone,
            label: "Get your business number",
            hint: numberHint
        ),
        StartedStep(
            key: "inbound",
            done: hasConversation,
            label: "Receive your first text",
            hint: hasConversation
                ? nil
                : "Text your number from your phone, and it lands right here."
        ),
        StartedStep(
            key: "reply",
            done: usedSegments > 0,
            label: "Send your first reply",
            hint: usedSegments > 0
                ? nil
                : "Open a conversation and answer like you would from your cell."
        ),
        StartedStep(
            key: "teammate",
            done: activeMemberCount > 1,
            label: "Invite a teammate",
            hint: nil
        ),
    ]
}

/// What changes about a crew member's day, derived from what they have done.
///
/// NOTHING ABOUT SETUP. The workspace already works, they were invited into a
/// running one. The one genuinely dangerous thing to get wrong is the note: a
/// note is not a text, and learning that by accident means a customer received
/// something meant for a colleague.
/// *Applying: Chunking — three things, which is what a person holds.*
func memberSteps(_ firsts: MemberFirsts) -> [StartedStep] {
    [
        StartedStep(
            key: "reply",
            done: firsts.replied,
            label: "Answer a customer",
            hint: firsts.replied
                ? nil
                : "Open a thread and reply. It goes out from the business number, and the whole crew can see it."
        ),
        StartedStep(
            key: "note",
            done: firsts.noted,
            label: "Leave a note for the crew",
            hint: firsts.noted
                ? nil
                : "Switch the composer to Note. Notes stay inside the app — the customer never sees them."
        ),
        StartedStep(
            key: "done",
            done: firsts.marked_done,
            label: "Mark something done",
            hint: firsts.marked_done
                ? nil
                : "Tick a message off when it is handled, so the rest of the crew knows nobody needs to chase it."
        ),
    ]
}

/// A finished list has nothing left to say, so it stops saying it.
func stepsComplete(_ steps: [StartedStep]) -> Bool {
    !steps.isEmpty && steps.allSatisfy { $0.done }
}

// MARK: - Dismissal

/// Dismissal is per company AND per card kind: dismissing one must not hide the
/// other, exactly as on web. `UserDefaults` is injectable so the store is
/// testable — the pattern `ComposerDrafts` established.
@MainActor
struct StartedDismissals {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func key(_ companyId: String, _ kind: StartedAudience) -> String {
        kind == .setup
            ? "loonext.getting-started-dismissed:\(companyId)"
            : "loonext.member-started-dismissed:\(companyId)"
    }

    func isDismissed(_ companyId: String, _ kind: StartedAudience) -> Bool {
        defaults.bool(forKey: key(companyId, kind))
    }

    func dismiss(_ companyId: String, _ kind: StartedAudience) {
        defaults.set(true, forKey: key(companyId, kind))
    }
}

// MARK: - The card

@MainActor
struct GettingStartedCard: View {
    let graph: AppGraph
    let companyId: String
    let me: Me

    @State private var steps: [StartedStep] = []
    @State private var dismissed = false

    private var audience: StartedAudience {
        startedAudience(me.memberships.first { $0.company_id == companyId }?.role)
    }

    private var title: String {
        audience == .setup ? "Getting started" : "Getting the hang of it"
    }

    var body: some View {
        // A VStack rather than a Group so the container is in the hierarchy
        // even with nothing to show — the fetch below hangs off it, and a
        // modifier on a view that resolved to EmptyView is not reliably run.
        VStack(spacing: 0) {
            if !dismissed, !steps.isEmpty, !stepsComplete(steps) {
                PaperCard {
                    VStack(alignment: .leading, spacing: 0) {
                        header
                        progressBar
                        ForEach(steps) { step in
                            row(step)
                        }
                        if audience == .doingTheJob {
                            Text(
                                "Your notification settings are yours alone. "
                                    + "Change when we buzz you in Settings."
                            )
                            .font(.golos(11.5))
                            .foregroundStyle(BrandColor.muted500)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 15)
                            .padding(.bottom, 13)
                        }
                    }
                }
                .padding(.top, 6)
                .padding(.bottom, 10)
            }
        }
        .onAppear {
            dismissed = StartedDismissals().isDismissed(companyId, audience)
        }
        .task(id: "\(companyId)|\(me.company?.subscription_status ?? "")") {
            steps = await loadSteps()
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Text("\(steps.filter(\.done).count) of \(steps.count) done")
                    .font(.golos(11.5))
                    .monospacedDigit()
                    .foregroundStyle(BrandColor.muted500)
            }
            Spacer(minLength: 8)
            Button {
                StartedDismissals().dismiss(companyId, audience)
                dismissed = true
            } label: {
                Image(systemName: "xmark")
                    .font(.scaled(13, weight: .medium))
                    .foregroundStyle(BrandColor.muted500)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss \(title.lowercased())")
        }
        .padding(.horizontal, 15)
        .padding(.top, 13)
    }

    /// Progress you can see, not only count. The bar is the momentum; the
    /// numbers above are the detail.
    private var progressBar: some View {
        let done = steps.filter(\.done).count
        return ProgressView(value: Double(done), total: Double(max(steps.count, 1)))
            .tint(BrandColor.olive)
            .padding(.horizontal, 15)
            .padding(.top, 10)
            .accessibilityLabel("\(done) of \(steps.count) steps done")
    }

    private func row(_ step: StartedStep) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: step.done ? "checkmark.circle.fill" : "circle")
                .font(.scaled(15, weight: .regular))
                .foregroundStyle(step.done ? BrandColor.olive : BrandColor.muted300)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.label)
                    .font(.golos(13))
                    .foregroundStyle(step.done ? BrandColor.muted500 : BrandColor.ink)
                    .strikethrough(step.done, color: BrandColor.muted500)
                    .accessibilityLabel(step.label + (step.done ? ", done" : ", not done yet"))
                if !step.done, let hint = step.hint {
                    Text(hint)
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted500)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 15)
        .padding(.top, 10)
        .padding(.bottom, step.key == steps.last?.key && audience == .setup ? 13 : 0)
    }

    /// Returns an empty list for every "say nothing" case — not this audience,
    /// not paid yet, company not hydrated, or any failure at all. A checklist
    /// nobody asked for must never become an error somebody has to dismiss.
    private func loadSteps() async -> [StartedStep] {
        do {
            switch audience {
            case .none:
                return []
            case .doingTheJob:
                return memberSteps(try await graph.meApi.firsts(companyId: companyId))
            case .setup:
                // G7 step 7 is the POST-payment first inbox visit. Before that,
                // "Get your business number, it's on its way" would be a lie.
                // `me.company` is nil until the hydrated /me lands, which reads
                // as "nothing to say yet" rather than as an unpaid workspace.
                guard let company = me.company,
                      hasPaidStatus(company.subscription_status)
                else { return [] }
                let repo = MessagingRepository(api: graph.api)
                // Unfiltered page 1: the controller's rows are scoped to the
                // active tab and chips, so deriving "any conversation exists"
                // from them would flip false on the Closed tab or any filter.
                async let conversations = graph.inboxApi.conversations(
                    companyId: companyId,
                    limit: 1
                )
                async let usage = repo.usage(companyId: companyId)
                async let members = repo.members(companyId: companyId)
                return ownerSteps(
                    numbers: company.numbers,
                    hasConversation: !(try await conversations.data.isEmpty),
                    usedSegments: try await usage.used_segments,
                    activeMemberCount: countActiveStartedMembers(try await members.data)
                )
            }
        } catch {
            return []
        }
    }
}
