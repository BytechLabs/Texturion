import SwiftUI
// #277: the export offer on the cancel screen hands a real file to the real
// system share sheet, which is UIKit's.
import UIKit

private let fairUseUrl = "https://loonext.com/legal/fair-use"

/// #490: "today" / "yesterday" / "on 12 July".
///
/// A relative day rather than a timestamp: the reader's question is "is this
/// still happening?", and "yesterday" answers it where an ISO string makes them
/// work it out. Past a couple of days the date is the more useful answer,
/// because by then the question has become "how long has this been going on".
private func relativeDay(_ iso: String?, locale: String? = nil) -> String? {
    guard let iso, let when = parseWireTimestamp(iso) else { return nil }
    let cal = Calendar.current
    if cal.isDateInToday(when) { return AppStrings.translate(locale, "settings.dayToday") }
    if cal.isDateInYesterday(when) {
        return AppStrings.translate(locale, "settings.dayYesterday")
    }
    let fmt = DateFormatter()
    fmt.locale = Locale(identifier: "en_US_POSIX")
    fmt.dateFormat = "d MMMM"
    // "on 12 July" in English, "le 12 juillet" in French — the preposition is
    // part of the phrase, so it travels with it rather than being prefixed here.
    return AppStrings.translate(locale, "settings.dayOn", ["date": fmt.string(from: when)])
}

private func fullDate(_ iso: String?) -> String? {
    guard let iso, let date = parseWireTimestamp(iso) else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "MMMM d, yyyy"
    return formatter.string(from: date)
}

/// The day this workspace's number goes back to the carrier — "August 14,
/// 2026" — or nil when nothing has been cancelled.
///
/// ONE FUNCTION, because three surfaces on this screen name this same date: the
/// off-ramp card, the canceled-state Subscription card, and the win-back note
/// inside it. Three of them disagreeing about when somebody loses their
/// business number is worse than none of them saying it.
///
/// WITH THE YEAR, and in the same shape the mail uses. The day-27 grace email
/// prints "August 4, 2026" through `releaseDateLabel` in grace.ts and sends the
/// reader to this screen, which printed "4 August" — the same deadline in two
/// formats, one of them undated. The branch that suffers is the expired one
/// ("the hold ended on 3 September"), which is read by definition after the
/// deadline and can be read a year later by somebody signing back in to find
/// out what happened.
///
/// UTC, because that is the clock `runGraceJob` runs on and the zone
/// `releaseDateLabel` prints in. Rendering it in the reader's zone would show a
/// date a day either side of the one the job acts on — which is why this stays
/// separate from `fullDate` above despite the identical format string: that one
/// prints a billing period end, which is a moment in the reader's own life.
private func numberReleaseDay(_ canceledAt: String?) -> String? {
    guard let release = numberReleaseAt(canceledAt) else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "UTC")
    formatter.dateFormat = "MMMM d, yyyy"
    return formatter.string(from: release)
}

/// Billing (#163): plan card (calling is INCLUDED on every plan — never an
/// add-on), honest status banners, in-app plan change, the add-on modules
/// card, and hosted Stripe surfaces which ALWAYS open in the external browser
/// (App Store rules — never a webview, never Apple IAP language).
///
/// `billing_writes_enabled` (#163) is the server's store-rules kill-switch:
/// when false, every in-app billing WRITE (plan change, module toggles) is
/// hidden and the card points at the external-browser Stripe portal instead —
/// reads and the always-external portal/checkout links are untouched.
@MainActor
struct BillingSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onRefreshCompany: @MainActor () -> Void

    /// #277 — the paid pause, read ONCE for this whole screen and handed to the
    /// two surfaces that speak about it.
    ///
    /// ONE READ, for two reasons. `GET /v1/billing/pause` round-trips to Stripe
    /// on every visit here; and two independent fetches could land out of step,
    /// which on this screen means an offer to pause on the cancel card while the
    /// plan card an inch above says the workspace is already paused.
    ///
    /// `PlanCard` owns the request rather than this view. It renders in every
    /// state, it needs the answer before anything below it does, and it is the
    /// card the answer is ABOUT — the alternative was wrapping this body in a
    /// container purely to hang a `.task` on, which moves the cards for no
    /// reason on a screen whose layout is load-bearing.
    ///
    /// A READ STATE AND NOT A `BillingPause?`. The optional collapsed "not asked
    /// yet", "asked and it failed" and "there is no pause" into one nil, and the
    /// plan card read all three as the last one — so a paused workspace whose
    /// cold-start read failed was shown its plan's price beside a green Active
    /// pill. `PauseRead` is that distinction; `planCardShape` is what the cards
    /// are allowed to conclude from it.
    ///
    /// `PauseFetch` AND NOT `PauseRead`, which is the narrower half of the same
    /// idea. This state describes the REQUEST, and a request cannot become
    /// "unaskable" — that is a fact about the reader, applied once below. While
    /// this line held a `PauseRead`, `= .loading` could be edited to
    /// `= .unaskable` and every test in the suite stayed green while the whole
    /// defect came back, because `planCardShape(.unaskable)` is `.active` by
    /// design for a reader who can never get an answer.
    @State private var pauseFetch: PauseFetch = .loading
    /// Bumped by a pause, a resume, or a retry, so the read runs again.
    @State private var pauseRefresh = 0

    @Environment(\.appLocale) private var appLocale

    private var canManage: Bool { SettingsRoleGate.canManageBilling(scope.role) }

    /// The read as every card on this screen must see it, derived in ONE place.
    ///
    /// Without `billing.manage` there is no answer to be had — the whole
    /// `/v1/billing` router 403s — so the state is not "loading forever", it is
    /// `unaskable`, and `planCardShape` says what that is allowed to render.
    private var pauseKnown: PauseRead {
        pauseReadFor(canManageBilling: canManage, fetch: pauseFetch)
    }

    var body: some View {
        StatusNotices(scope: scope, company: company, canManage: canManage)
        // #490: directly under the notice that says the line is off, because it
        // is the consequence of that sentence rather than a separate topic.
        MissedWhileOffNote(scope: scope, company: company)
        // #481: only for a workspace on its way out. Directly under the count
        // of customers who rang into nothing, because this is what to DO.
        OffRampCard(scope: scope, company: company)
        PlanCard(
            scope: scope,
            company: company,
            canManage: canManage,
            read: pauseKnown,
            pauseRefresh: pauseRefresh,
            onRead: { pauseFetch = $0 },
            // A retry re-runs the read WITHOUT discarding an answer we already
            // have: there is nothing stale about it, the request simply did not
            // come back.
            onRetryPause: { pauseRefresh += 1 },
            onPauseChanged: {
                // A pause or a resume changes the shape of the subscription, so
                // the answer in hand is known-stale — unlike a retry, this one
                // throws it away rather than rendering it while the re-read runs.
                pauseFetch = .loading
                pauseRefresh += 1
                onRefreshCompany()
            },
            onRefreshCompany: onRefreshCompany
        )
        // #523 — directly under the plan card, because it finishes that card's
        // sentence: "your plan covers 1 phone number", then "and you have more
        // than that". The upgrade route it names is the control on the card
        // immediately above, which is the one place a plan change is offered in
        // every state this screen has — a second button here would be a copy to
        // keep in step with that one.
        //
        // THE PAUSE READ IS HANDED DOWN, not re-fetched. A paused workspace
        // cannot be sold an extra number (`POST …/reinstate` refuses it by
        // design), and neither may one whose read has not landed — the same
        // rule, from the same one read, as the add-ons card below.
        HeldNumbersCard(
            scope: scope,
            company: company,
            read: pauseKnown,
            onRefreshCompany: onRefreshCompany
        )
        // #277 — a module toggle INVOICES IMMEDIATELY, and
        // `POST /v1/billing/modules` refuses a paused workspace, so the card is
        // offered only on an answer that came back and said "not paused".
        // `mayBuyAddOns` is false while the read is in flight, which costs
        // nothing visible: this card already draws nothing until its own catalog
        // fetch returns.
        if canManage && company.billing_writes_enabled
            && company.plan != nil && company.subscriptionActive
            && mayBuyAddOns(pauseKnown) {
            ModulesCard(scope: scope)
        }
        if canManage {
            SettingsCard(
                title: AppStrings.translate(appLocale, "settings.billingPortalTitle"),
                description: AppStrings.translate(appLocale, "settings.billingPortalIntro")
            ) {
                PortalButton(
                    scope: scope,
                    label: AppStrings.translate(appLocale, "settings.billingPortalAction")
                )
            }
            if company.subscriptionActive {
                CancelCard(
                    scope: scope,
                    company: company,
                    // THE READ, not just the answer it may or may not hold.
                    //
                    // It used to be `pauseKnown.answer` — nil for loading, for
                    // failed and for unaskable alike — and nil is indeed what
                    // this card renders as "no pause to offer". But the ANSWER
                    // it falls through to has to tell "not paused" apart from
                    // "not read yet": a paused workspace answering
                    // `too_expensive` was handed "Switch to Starter", whose POST
                    // 409s by design while the plan is paused.
                    //
                    // Handing the whole read down changes nothing about the way
                    // out. Every state of it renders the same exit, in the same
                    // place, enabled by the same one flag — `CancelOneActionTests`
                    // reads this file to say so.
                    read: pauseKnown,
                    onPauseChanged: {
                        pauseFetch = .loading
                        pauseRefresh += 1
                        onRefreshCompany()
                    },
                    onRefreshCompany: onRefreshCompany
                )
            }
            // #288/#399: the referral link, on the billing screen because the
            // reward is a month off the invoice, and behind the same
            // billing.manage gate for the same reason. Only on a plan we are told
            // is running — a workspace with nothing to discount cannot be paid,
            // and offering the month anyway would be an offer we already know we
            // will not keep.
            //
            // BELOW THE CANCEL CARD, matching Android, where PauseOfferTest says
            // why in as many words: nothing new may render above the way out,
            // because every card added there is height between a thumb and that
            // button. An invitation to go and recommend us is the last thing that
            // should stand between an owner and leaving.
            if company.plan != nil && company.subscriptionActive {
                ReferralCardSection(scope: scope)
            }
        } else {
            SettingsCard(title: AppStrings.translate(appLocale, "settings.billingTitle")) {
                ReadOnlyLine(AppStrings.translate(appLocale, "settings.billingReadOnly"))
            }
        }
    }
}

// MARK: - Portal button

/// Open the hosted Stripe Billing Portal in the EXTERNAL browser.
private struct PortalButton: View {
    let scope: SettingsScope
    let label: String
    var solid: Bool = false

    @State private var opening = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private var caption: String {
        opening ? AppStrings.translate(appLocale, "settings.billingOpening") : label
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if solid {
                Button(caption) { open() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(opening)
            } else {
                Button(caption) { open() }
                    .buttonStyle(.bordered)
                    .disabled(opening)
            }
            InlineError(error)
        }
    }

    private func open() {
        opening = true
        error = nil
        Task {
            do {
                let hosted = try await scope.repo.billingPortal(scope.companyId)
                openExternal(hosted.url)
            } catch {
                self.error = error.userMessage
            }
            opening = false
        }
    }
}

// MARK: - Status notices

/// #288/#399 — the referral card and the read behind it.
///
/// Its own read rather than a field on the billing payload: `ensureReferralCode`
/// MINTS a code the first time it is asked for, and putting that behind the boot
/// read would mint one for every workspace that has ever opened settings. The
/// first person who looks at this card gets one.
///
/// Silent on failure, like the other conditional cards here. This is an offer, and
/// a settings screen showing a broken panel looks like the settings are broken.
private struct ReferralCardSection: View {
    let scope: SettingsScope

    @State private var view: ReferralsView?

    var body: some View {
        Group {
            if let view {
                ReferralCard(view: view)
            }
        }
        .task(id: scope.companyId) {
            view = try? await scope.graph.forYouApi.referrals(companyId: scope.companyId)
        }
    }
}

private struct StatusNotices: View {
    let scope: SettingsScope
    let company: CompanyView
    let canManage: Bool

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    private var notice: (String, String)? {
        if company.subscription_status == SubscriptionStatus.pastDue {
            return (t("settings.noticePastDue"), t("settings.noticeUpdatePayment"))
        }
        if company.subscription_status == SubscriptionStatus.unpaid {
            return (t("settings.noticeUnpaid"), t("settings.noticeUpdatePayment"))
        }
        if company.subscriptionActive && company.cancel_at_period_end {
            let date = fullDate(company.current_period_end)
            // The hold is counted from the day cancelling was REQUESTED, not
            // from the day texting stops — `canceled_at` comes off Stripe's own
            // `subscription.canceled_at`. This notice used to read "texting
            // stops then; we hold your number for 30 days", which invites the
            // reader to count from the period end and can overstate the real
            // deadline by most of a month. The exact date cannot be shown here
            // (nothing has stamped `canceled_at` yet), so the anchor is named.
            //
            // TWO WHOLE SENTENCES rather than one with a date spliced into it:
            // "on {date}" and "at the end of this period" land in different
            // places in French, and a concatenation nails them to the English.
            return (
                date.map {
                    t(
                        "settings.noticeCancellingOn",
                        ["date": $0, "days": "\(cancellationGraceDays)"]
                    )
                } ?? t("settings.noticeCancelling", ["days": "\(cancellationGraceDays)"]),
                t("settings.noticeKeepMyPlan")
            )
        }
        return nil
    }

    var body: some View {
        if let notice {
            VStack(alignment: .leading, spacing: 8) {
                Text(notice.0)
                    .font(.callout)
                    .foregroundStyle(BrandColor.ink)
                if canManage {
                    PortalButton(scope: scope, label: notice.1, solid: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(BrandColor.amberBg, in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
        }
    }
}

// MARK: - Plan card

@MainActor
private struct PlanCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let canManage: Bool
    /// #277 — what the screen KNOWS about the pause, derived once by the section
    /// above and written by this card's own read.
    let read: PauseRead
    /// Changes when a pause, a resume or a retry asks for the read again.
    let pauseRefresh: Int
    /// What the REQUEST did. The role is applied by the section above, so this
    /// card cannot report a state that says "nobody may ask".
    let onRead: @MainActor (PauseFetch) -> Void
    let onRetryPause: @MainActor () -> Void
    let onPauseChanged: @MainActor () -> Void
    let onRefreshCompany: @MainActor () -> Void

    @State private var opening = false
    @State private var error: String?
    @State private var changingPlan = false
    @State private var resuming = false
    @State private var resumeError: String?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    /// #277 — the pause read, hung on the whole if/else chain below.
    ///
    /// ON THE CHAIN AND NOT ON A `Group` AROUND IT: a Group wrapping several
    /// SIBLING views applies its modifiers to each of them, so a `.task` there
    /// would hit Stripe once per card on every visit. One conditional, one
    /// child, one request.
    ///
    /// Only for somebody who can act on the answer. The whole /v1/billing router
    /// is behind `billing.manage`, so asking on anybody else's behalf would be a
    /// guaranteed 403 every time this screen opens.
    var body: some View {
        cards.task(id: "\(scope.companyId)|\(pauseRefresh)") {
            guard canManage else { return }
            // THE FAILURE IS RECORDED, NOT SWALLOWED. `try?` here was the whole
            // of the defect this replaces: `GET /v1/billing/pause` deliberately
            // THROWS rather than degrading to a null — the route would rather
            // fail than let the offer render with no price beside it — and a
            // `try?` on this line quietly undid that decision on the client, so
            // a paused workspace whose read failed printed its plan's price
            // beside a green Active pill.
            do {
                let fresh = try await scope.repo.pauseOffer(scope.companyId)
                onRead(.ready(fresh))
            } catch {
                // A cancelled task is not a failed read. `.task(id:)` cancels the
                // outgoing request whenever the id changes or the screen goes
                // away, and reporting that as a failure would flash "we couldn't
                // check" over a read that is being replaced by a fresher one.
                guard !Task.isCancelled else { return }
                // NO "KEEP THE LAST ANSWER" BRANCH, on purpose. It reads like
                // caution — a stale truth beats a fresh lie — but there is no
                // case on this screen where it applies and one where it is
                // wrong. The two in-place re-reads are a pause/resume, which
                // discards the held answer before asking BECAUSE the
                // subscription just changed shape, and the retry below, which is
                // only offered from a state that has no answer to keep. What is
                // left is a change of `scope.companyId`, where holding the last
                // answer means describing one workspace's pause on another's
                // billing screen.
                onRead(.failed)
            }
        }
    }

    @ViewBuilder
    private var cards: some View {
        // Read once. The three branches below must agree about which shape they
        // are in, and a chain that recomputed it per branch could disagree with
        // itself mid-render.
        let shape = planCardShape(read)
        if company.subscription_status == SubscriptionStatus.canceled {
            SettingsCard(title: t("settings.subscriptionTitle")) {
                Text(t("settings.subscriptionCanceled"))
                    .font(.callout)
                // #277 follow-up: the answer to what they told us on the way
                // out, said once more while the number can still be saved.
                // ABOVE the hold sentence on purpose — the shared seasonal copy
                // points at "the date below", and that date is the next thing
                // in this card. Draws nothing for the four reasons we have
                // nothing honest to add to, once it has been waved away, and
                // once the hold has expired.
                if canManage {
                    WinbackNote(scope: scope, company: company)
                }
                Text(holdSentence)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                InlineError(error)
                if canManage {
                    // Unchanged, and still the loud one: "come back on exactly
                    // what you had". The win-back's own control is quieter,
                    // because steering somebody who has already left toward the
                    // cheaper plan is a decision that should be theirs.
                    Button(
                        opening
                            ? t("settings.billingOpening")
                            : t("settings.resubscribe")
                    ) {
                        resubscribe(plan: company.plan ?? "starter")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(opening)
                    .padding(.top, 10)
                }
            }
        } else if shape == .paused {
            pausedPlan
        } else if let facts = planFacts(company.plan, company.billedIn),
                  case .unconfirmed(let checking) = shape {
            // BEFORE the ordinary plan card, not after it: this branch exists
            // precisely to stop that one rendering on a fact nobody has read.
            unconfirmedPlan(facts: facts, checking: checking)
        } else if let facts = planFacts(company.plan, company.billedIn) {
            SettingsCard(title: t("settings.planTitle")) {
                HStack(spacing: 10) {
                    // #328: priced in what this workspace's card is actually
                    // charged, not a hardcoded dollar sign. A Canadian owner
                    // read "Pro · $79/mo" here and "Starter is $39 a month
                    // instead of $109" in the cancel answer an inch below —
                    // two prices for the same plan, on one screen, one of them
                    // provably wrong, at the moment they are deciding whether
                    // to leave.
                    Text(
                        t(
                            "settings.planNameAndPrice",
                            ["name": facts.name, "price": facts.price]
                        )
                    )
                    .font(.title3.weight(.semibold))
                    if company.subscriptionActive && !company.cancel_at_period_end {
                        StatusPill(label: t("settings.planPillActive"), tone: .positive)
                    }
                }
                Spacer().frame(height: 8)
                // The bullet is its own key so the marker can differ; the lines
                // are keys rather than sentences so the seat and number counts
                // land inside a translated phrase instead of in front of one.
                ForEach(allowanceLines(facts), id: \.self) { line in
                    Text(t("settings.planAllowanceLine", ["line": line]))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 1)
                }
                Spacer().frame(height: 6)
                Button(t("settings.planFairUse")) {
                    openExternal(fairUseUrl)
                }
                .font(.subheadline)
                .buttonStyle(.borderless)
                if let date = fullDate(company.current_period_end) {
                    Text(t("settings.planPeriodEnds", ["date": date]))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if canManage && company.subscriptionActive {
                    if company.billing_writes_enabled {
                        Button(
                            t(
                                company.plan == "pro"
                                    ? "settings.planSwitchToStarter"
                                    : "settings.planUpgradeToPro"
                            )
                        ) {
                            changingPlan = true
                        }
                        .buttonStyle(.bordered)
                        .padding(.top, 10)
                    } else {
                        // #163 kill-switch: the in-app plan change is hidden;
                        // plan management rides the existing external-browser
                        // Stripe portal path (store-rules posture).
                        Spacer().frame(height: 10)
                        PortalButton(
                            scope: scope,
                            label: t("settings.planManageInBrowser")
                        )
                    }
                }
            }
            .sheet(isPresented: $changingPlan) {
                ChangePlanSheet(scope: scope, company: company) {
                    changingPlan = false
                    onRefreshCompany()
                } onDismiss: {
                    changingPlan = false
                }
            }
        } else {
            SettingsCard(title: t("settings.planTitle")) {
                Text(t("settings.planNone"))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// The five allowance lines, translated, with the two counted ones counted.
    ///
    /// The singular number line is a SEPARATE KEY rather than an "s" appended
    /// when the count is not one: French pluralises the noun AND its article,
    /// and there is no suffix that does that. Android's twin splits the same
    /// pair.
    private func allowanceLines(_ facts: PlanFacts) -> [String] {
        [
            t("settings.planLineTexting"),
            t("settings.planLineCalling"),
            t("settings.planLineExtraTexts"),
            t("settings.planLineSeats", ["seats": "\(facts.seats)"]),
            facts.numbers == 1
                ? t("settings.planLineNumberOne")
                : t("settings.planLineNumbers", ["numbers": "\(facts.numbers)"]),
        ]
    }

    /// #277 — the plan, with every part that depends on an unread fact left out.
    ///
    /// # What this branch is for
    ///
    /// A paused subscription is still `active` in Stripe, so the ordinary plan
    /// card renders straight through a pause and is confidently wrong about
    /// three things at once: the PRICE (the licensed line during a pause IS the
    /// holding fee, so the plan's own price overstates the charge many times
    /// over), the green `Active` PILL, and the five allowance lines describing a
    /// plan that is not running. Before `pauseIsActive` can answer, and again if
    /// the read fails, none of those has been read — so none of them is printed.
    ///
    /// The plan NAME stays. It comes from `GET /v1/company`, which this screen
    /// did read, and it is true on either footing.
    ///
    /// # No plan switch here either
    ///
    /// `POST /v1/billing/change-plan` refuses a paused workspace outright. A
    /// button whose outcome might be a 409 by design is not a button, and
    /// offering it on a maybe is how somebody finds out they are paused from an
    /// error message.
    ///
    /// # It cannot touch the way out
    ///
    /// This card sits ABOVE the cancel card and changes nothing about it.
    /// Reaching Stripe while answering nothing stays one press, in every one of
    /// these states — `CancelOneActionTests` is what says so out loud.
    @ViewBuilder
    private func unconfirmedPlan(facts: PlanFacts, checking: Bool) -> some View {
        SettingsCard(title: t("settings.planTitle")) {
            Text(facts.name)
                .font(.title3.weight(.semibold))
            Spacer().frame(height: 8)
            Text(planUnconfirmedLine(checking: checking, locale: appLocale))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            // Read from the company and true either way, so it stays: it is the
            // one fact that keeps this from looking like a card that lost its
            // contents.
            if let date = fullDate(company.current_period_end) {
                Text(t("settings.planPeriodEnds", ["date": date]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }
            // Only once it has actually failed. A retry offered against a request
            // still in flight is a button that races itself.
            if !checking && canManage {
                Button(t("common.retry")) { onRetryPause() }
                    .buttonStyle(.bordered)
                    .padding(.top, 10)
            }
        }
    }

    /// #277 — the pause as a STATE, in the card that would otherwise be wrong
    /// about it.
    ///
    /// # Why it lives inside the plan card and not above the screen
    ///
    /// A paused subscription is still `active` in Stripe — the pause is a price
    /// swap on the licensed line, deliberately, so status, reconciliation and
    /// usage all keep working on real data. Which means the ordinary plan card
    /// renders happily straight through a pause and prints the PLAN's price over
    /// a workspace being charged a holding fee. The place that cannot be allowed
    /// to be wrong is the place this belongs, and a banner bolted above it would
    /// have left the wrong number on screen underneath.
    ///
    /// # It is shorter than what it replaces
    ///
    /// Deliberately. The cancel card sits below this one, and a paused workspace
    /// must not have to scroll further to leave than an unpaused one does. Four
    /// lines and one button, against five bullets, a policy link, a period-end
    /// line and a plan-change button.
    ///
    /// # No plan-change control here
    ///
    /// `POST /v1/billing/change-plan` refuses outright while paused ("Resume it
    /// first, then switch plans"), because a plan change during a pause is
    /// ambiguous in a way only the customer can settle. A button whose only
    /// outcome is that sentence is a button that does not work.
    @ViewBuilder
    private var pausedPlan: some View {
        // `resume_plan` first: it is the API's own answer to "what do they come
        // back to", and it survives months of pause because the pause never
        // touches `plan`. The company view is the fallback for a response that
        // did not name one.
        //
        // `read.answer` and not a stored optional: this branch is only reachable
        // from `.ready`, so the answer is present by construction, and reading it
        // back off the same value that decided the branch keeps the two from
        // ever describing different pauses.
        let paused = read.answer
        let facts = planFacts(paused?.resume_plan ?? company.plan, company.billedIn)
        SettingsCard(title: t("settings.planTitle")) {
            HStack(spacing: 10) {
                Text(
                    facts.map { t("settings.planNamePausedLine", ["name": $0.name]) }
                        ?? t("settings.planPillPaused")
                )
                .font(.title3.weight(.semibold))
                StatusPill(label: t("settings.planPillPaused"), tone: .neutral)
            }
            Spacer().frame(height: 8)
            // The price line is inside this list and only when the API sent a
            // figure — see `pausedStateLines`. Nothing here falls back to the
            // plan price.
            ForEach(
                pausedStateLines(price: pausedMonthlyPrice(paused), locale: appLocale),
                id: \.self
            ) { line in
                Text(t("settings.planAllowanceLine", ["line": line]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 1)
            }
            if canManage {
                Button(
                    resuming
                        ? t("settings.pauseResuming")
                        : pauseResumeLabel(planName: facts?.name, locale: appLocale)
                ) {
                    resume()
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
                .disabled(resuming)
                .padding(.top, 10)
                InlineError(resumeError)
            }
        }
    }

    /// Come back, and believe the RESPONSE rather than the request.
    ///
    /// The route swaps the price back at Stripe, re-reads its own mirror and
    /// answers 409 when the two disagree — so there is no such thing here as "it
    /// probably worked". The 409's sentence is written for the customer ("give
    /// it a minute and try again — you won't be charged twice for resuming"), so
    /// it is shown exactly as it arrives: this client has nothing truer to say
    /// about a swap it cannot see.
    ///
    /// The plan named in the confirmation comes from the response too, not from
    /// the company view this screen was holding.
    private func resume() {
        resuming = true
        resumeError = nil
        let locale = appLocale
        Task {
            do {
                let resumed = try await scope.repo.resumePlan(scope.companyId)
                scope.showMessage(
                    planFacts(resumed.plan, company.billedIn)
                        .map {
                            AppStrings.translate(
                                locale,
                                "settings.pauseResumedOn",
                                ["name": $0.name]
                            )
                        }
                        ?? AppStrings.translate(locale, "settings.pauseResumedPlain")
                )
                onPauseChanged()
            } catch {
                resumeError = error.userMessage
            }
            resuming = false
        }
    }

    /// What is true about the number on a workspace that has already left.
    ///
    /// Three states, because the hold really does have three and the sentence
    /// this replaced ("30 days after your last period") described none of them:
    ///
    ///   inside the hold   the date it goes, which is the only actionable fact.
    ///   past the hold     the hold ENDED. Deliberately not "your number has
    ///                     been released": the release job runs daily, so
    ///                     between the deadline and the next run the number may
    ///                     still be ours, and the honest claim at that boundary
    ///                     is about the hold rather than about the carrier.
    ///   no `canceled_at`  the general rule, with no date invented for it.
    ///
    /// THE EXPIRED BRANCH MAY NOT SPEAK IN THE PAST TENSE EITHER. It used to
    /// end "resubscribing now sets you up with a new number", which is the same
    /// claim in different words: this sentence flips on the DEVICE clock at
    /// `canceled_at + 30d`, while the release runs on a once-daily cron
    /// (`0 14 * * *`) that can also fail and retry. For up to a day the number
    /// is still suspended-not-released, and `runGraceJob` only ever looks at
    /// companies whose `subscription_status` is still `canceled` — so somebody
    /// who came back inside that window would keep the number we had just told
    /// them was gone. What is certain at that boundary is that we can no longer
    /// PROMISE it, and that is what it says. It does not promise the reverse
    /// either: inviting somebody to race a cron is not an offer.
    /// #228 — THE THREE SENTENCES THAT STAY ENGLISH, AND A GUARD SAYS WHY.
    ///
    /// `settings.holdRule`, `settings.holdUntil` and `settings.holdEndedOn`
    /// exist in the catalogue in both languages and this branch is one edit from
    /// reading them. It does not, because two assertions in `SettingsLogicTests`
    /// read THIS FILE'S string literals and require these exact words to be
    /// here: `testEverySentenceOnTheBillingScreenCountsTheHoldFromTheCancellation`
    /// counts every "{days} days" on the screen and fails when there are none,
    /// and `testTheScreenSaysTheHoldEndedRatherThanThatTheNumberIsGone` looks
    /// for "hold on your number ended on" and "can't promise it any more".
    ///
    /// Those two guards are worth more than these three translations. Between
    /// them they hold the anchor of the hold (counted from the cancellation, not
    /// from the period end — a miscount that costs somebody the number on their
    /// van) and the tense of the expired branch (the release is a once-daily
    /// cron, so "your number is gone" can be false for a day). Moving the words
    /// out silently blinds both, and neither failure would show up anywhere but
    /// on a customer.
    ///
    /// Finishing this means re-pointing those two at
    /// `AppStrings.en["settings.hold*"]`, which is where the sentences now live
    /// as well. That is a test-file change, not this file's, and it is reported
    /// rather than done here.
    private var holdSentence: String {
        guard let day = numberReleaseDay(company.canceled_at) else {
            return "We hold your number for \(cancellationGraceDays) days from the day "
                + "you cancel. Resubscribe before then and everything picks up where it "
                + "left off."
        }
        if !isWithinCancellationGrace(company.canceled_at) {
            return "The \(cancellationGraceDays)-day hold on your number ended on \(day). "
                + "We can't promise it any more — once it goes back to the phone company, "
                + "resubscribing sets you up with a new number. Your message history is "
                + "still here either way."
        }
        return "We hold your number until \(day). Resubscribe before then and everything "
            + "picks up where it left off."
    }

    private func resubscribe(plan: String) {
        opening = true
        error = nil
        Task {
            do {
                let hosted = try await scope.repo.checkout(scope.companyId, plan: plan)
                openExternal(hosted.url)
            } catch {
                self.error = error.userMessage
            }
            opening = false
        }
    }
}

// MARK: - Change plan

private struct ChangePlanSheet: View {
    let scope: SettingsScope
    let company: CompanyView
    let onChanged: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void

    @State private var pending = false
    @State private var error: String?
    // Downgrade requirements from LIVE counts: numbers from the company view,
    // active members fetched fresh.
    @State private var activeMembers: Int?
    @State private var membersFailed = false
    /// #583 — a prepaid year running underneath this switch.
    ///
    /// Read here rather than with the screen: it costs a Stripe round trip on the
    /// server, and it only changes a decision at the moment somebody is about to
    /// make one. A failure leaves it nil, which shows no panel and sends no consent
    /// — the server then refuses with the arithmetic in the message, the same answer
    /// this sheet would have given, one tap later.
    @State private var prepaid: OpenPrepaidYear?
    @State private var endPrepaid = false

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    private var upgrading: Bool { company.plan != "pro" }
    private var targetPlan: String { upgrading ? "pro" : "starter" }

    private var activeNumbers: Int {
        company.numbers.filter { $0.status != NumberStatus.released }.count
    }

    // #392's rule, applied to the half it missed: the Starter allowance, not a
    // literal. A downgrade gate that disagrees with the API blocks a plan
    // change the server would allow. The API counts the same rows — every
    // non-released number, held ones included — in `countNonReleasedNumbers`.
    private var numbersOk: Bool { activeNumbers <= starterNumbers }
    private var seatsOk: Bool { (activeMembers ?? Int.max) <= starterSeats }
    private var downgradeBlocked: Bool { !upgrading && (!numbersOk || !seatsOk || membersFailed) }

    /// The numbers row of the fit checklist.
    ///
    /// Four whole sentences rather than a tick glued to a phrase glued to a
    /// count: the singular and plural forms of "phone number" differ by more
    /// than an "s" in French, and the ✓/✗ marker is part of each sentence in the
    /// catalogue so a translator can see what it is agreeing with.
    private var checklistNumbersLine: String {
        if numbersOk {
            return starterNumbers == 1
                ? t("settings.downgradeNumbersOkOne")
                : t("settings.downgradeNumbersOk", ["numbers": "\(starterNumbers)"])
        }
        return starterNumbers == 1
            ? t("settings.downgradeNumbersBlockedOne", ["have": "\(activeNumbers)"])
            : t(
                "settings.downgradeNumbersBlocked",
                ["numbers": "\(starterNumbers)", "have": "\(activeNumbers)"]
            )
    }

    var body: some View {
        ConfirmSheet(
            title: t(
                upgrading
                    ? "settings.changePlanUpgradeTitle"
                    : "settings.changePlanDowngradeTitle"
            ),
            message: t(
                upgrading
                    ? "settings.changePlanUpgradeBody"
                    : "settings.changePlanDowngradeBody"
            ),
            confirmLabel: t(
                upgrading
                    ? "settings.changePlanUpgradeAction"
                    : "settings.changePlanDowngradeAction"
            ),
            pending: pending,
            error: error,
            // #583: and never while a prepaid year is running and unacknowledged.
            confirmEnabled: !downgradeBlocked && (prepaid == nil || endPrepaid),
            dismissLabel: t("common.cancel"),
            onConfirm: { change() },
            onDismiss: { onDismiss() }
        ) {
            prepaidYearPanel
            if !upgrading {
                VStack(alignment: .leading, spacing: 6) {
                    Spacer().frame(height: 10)
                    Text(checklistNumbersLine)
                        .font(.footnote)
                    Text(checklistMembersLine)
                        .font(.footnote)
                    Spacer().frame(height: 8)
                    Text(t("settings.downgradeTiming"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .task {
                    do {
                        activeMembers = try await scope.repo.members(scope.companyId)
                            .data.filter { $0.deactivated_at == nil }.count
                    } catch {
                        membersFailed = true
                    }
                }
            }
        }
        .task {
            prepaid = try? await scope.repo.prepayOffer(scope.companyId).open
        }
    }

    /// #583 — what this switch does to a prepaid year, before it happens.
    ///
    /// The reader's actual question is one sentence: "I paid for a year, do I lose
    /// it?" Until this shipped the answer arrived as a refusal AFTER the tap, which
    /// is the worst possible order — a refusal reads as "you cannot", to the one
    /// customer who both can and wants to pay us more.
    ///
    /// Three facts and no more: what the year cost, how much is used, what comes
    /// back. Three is what somebody holds at once on a phone; a fourth would be
    /// arithmetic they did not ask for. The sentences come from the shared rule, so
    /// the promise is the same one web and Android make.
    ///
    /// The toggle is deliberately off. Everywhere else this app fills a form in
    /// advance to save work; here the tick IS the consent, and a consent already
    /// given is not one.
    ///
    /// Renders nothing for the workspaces with no prepaid year, which is almost all
    /// of them — a panel for a rare state must not become furniture on the common
    /// one.
    @ViewBuilder
    private var prepaidYearPanel: some View {
        if let prepaid {
            // The currency the year was COLLECTED in, printed as its own money.
            let paid = BillingCurrency(rawValue: prepaid.currency) ?? .usd
            let credit = prepaid.conversion.map {
                formatMoneyIn($0.credit_cents, paid, audience: paid)
            }
            let copy = prepaidConversionCopy(
                from: prepaid.plan, to: targetPlan, credit: credit, locale: appLocale
            )
            VStack(alignment: .leading, spacing: 6) {
                Spacer().frame(height: 10)
                Text(copy.heading).font(.subheadline.weight(.medium))
                Text(
                    t(
                        "settings.prepaidPaidUpFront",
                        ["amount": formatMoneyIn(prepaid.amount_cents, paid, audience: paid)]
                    )
                )
                .font(.footnote)
                if let conversion = prepaid.conversion {
                    Text(
                        t(
                            "settings.prepaidMonthsUsed",
                            ["months": "\(conversion.consumed_months)"]
                        )
                    )
                    .font(.footnote)
                    if let credit {
                        Text(t("settings.prepaidCredit", ["amount": credit]))
                            .font(.footnote.weight(.medium))
                    }
                }
                Text(copy.explanation)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Toggle(copy.acknowledgement, isOn: $endPrepaid)
                    .font(.footnote)
            }
        }
    }

    /// The members row of the fit checklist.
    ///
    /// `starterSeats` rather than the literal 3 the sentence used to carry: a
    /// checklist that disagrees with the allowance it is checking against is the
    /// same defect `numbersOk` was fixed for.
    private var checklistMembersLine: String {
        if membersFailed { return t("settings.downgradeSeatsUnknown") }
        guard let activeMembers else { return t("settings.downgradeSeatsChecking") }
        if activeMembers <= starterSeats {
            return t(
                "settings.downgradeSeatsOk",
                ["seats": "\(starterSeats)", "have": "\(activeMembers)"]
            )
        }
        return t(
            "settings.downgradeSeatsBlocked",
            [
                "seats": "\(starterSeats)",
                "have": "\(activeMembers)",
                "excess": "\(activeMembers - starterSeats)",
            ]
        )
    }

    private func change() {
        pending = true
        error = nil
        let locale = appLocale
        Task {
            do {
                let result = try await scope.repo.changePlan(
                    scope.companyId,
                    plan: targetPlan,
                    convertPrepaid: prepaid != nil && endPrepaid
                )
                // #523: through the shared copy, because an upgrade now has a
                // second effect — the bigger allowance can bring held numbers
                // back — and the sentence has to read it off the RESPONSE
                // rather than assume it from the plan.
                scope.showMessage(changePlanMessage(result, locale: locale))
                onChanged()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

// MARK: - Modules

private struct ModulesCard: View {
    let scope: SettingsScope

    @State private var state: LoadState<[BillingModule]> = .loading
    @State private var refreshKey = 0
    @State private var confirming: BillingModule?
    @State private var pending = false
    @State private var dialogError: String?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        Group {
            switch state {
            // Loading quietly and hiding an empty catalog are both correct: the
            // card only exists when there is something sellable (web parity).
            case .loading, .failed:
                EmptyView()
            case .ready(let modules):
                if !modules.isEmpty {
                    SettingsCard(
                        title: t("settings.modulesTitle"),
                        description: t("settings.modulesIntro")
                    ) {
                        ForEach(modules, id: \.id) { module in
                            // `module.label` and `module.blurb` are the SERVER's
                            // words for the add-on and stay as they arrive, the
                            // same way every client renders `cause.message`: a
                            // catalogue copy of a catalog the API owns goes stale
                            // the first time a module is added.
                            LabeledToggleRow(
                                label: t(
                                    "settings.moduleRow",
                                    [
                                        "name": module.label,
                                        "price": formatMonthlyCents(module.monthly_cents),
                                    ]
                                ),
                                supporting: module.blurb,
                                isOn: module.enabled,
                                enabled: module.available || module.enabled
                            ) { _ in
                                dialogError = nil
                                confirming = module
                            }
                        }
                    }
                }
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") {
            do {
                state = .ready(
                    try await scope.repo.modules(scope.companyId)
                        .modules.filter { $0.available || $0.enabled }
                )
            } catch {
                state = .failed(error.userMessage)
            }
        }
        .sheet(isPresented: Binding(
            get: { confirming != nil },
            set: { open in
                if !open { confirming = nil }
            }
        )) {
            if let module = confirming {
                let enabling = !module.enabled
                ConfirmSheet(
                    title: t(
                        enabling ? "settings.moduleAddTitle" : "settings.moduleRemoveTitle",
                        ["name": module.label]
                    ),
                    message: enabling
                        ? t(
                            "settings.moduleAddBody",
                            ["price": formatMonthlyCents(module.monthly_cents)]
                        )
                        : t("settings.moduleRemoveBody", ["name": module.label]),
                    confirmLabel: t(
                        enabling ? "settings.moduleAddAction" : "settings.moduleRemoveAction"
                    ),
                    pending: pending,
                    error: dialogError,
                    dismissLabel: t("common.cancel"),
                    onConfirm: { toggle(module, enabling: enabling) },
                    onDismiss: { confirming = nil }
                )
            }
        }
    }

    private func toggle(_ module: BillingModule, enabling: Bool) {
        pending = true
        dialogError = nil
        let locale = appLocale
        Task {
            do {
                try await scope.repo.setModule(scope.companyId, module: module.id, enabled: enabling)
                confirming = nil
                scope.showMessage(
                    AppStrings.translate(
                        locale,
                        enabling ? "settings.moduleAdded" : "settings.moduleRemoved",
                        ["name": module.label]
                    )
                )
                refreshKey += 1
            } catch {
                dialogError = error.userMessage
            }
            pending = false
        }
    }
}

/// #490 — how many customers rang while the line could not take them.
///
/// Shown only on a workspace whose subscription is not active, and only when
/// the number is greater than zero. It is the argument for coming back with
/// evidence attached: before this the business was never told those calls had
/// happened at all.
///
/// WHAT THIS IS NOT: a scare banner. It does not use the word "lost". The
/// reader has almost certainly stopped paying because money is tight, and a
/// product that shouts about what their lapse cost them is kicking somebody
/// already down. The bare number is more persuasive than any sentence we could
/// write about it.
///
/// Zero renders NOTHING — an empty state here would be an argument AGAINST
/// reinstating. A failed read renders nothing too: this is a supporting fact on
/// somebody else's screen, and a billing page showing a broken box looks like
/// the billing itself is broken.
@MainActor
private struct MissedWhileOffNote: View {
    let scope: SettingsScope
    let company: CompanyView

    @State private var missed: MissedWhileOff?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    private var show: Bool { !company.subscriptionActive }

    var body: some View {
        Group {
            if let missed, missed.total > 0 {
                VStack(alignment: .leading, spacing: 3) {
                    Text(
                        missed.total == 1
                            ? t("settings.missedWhileOffOne")
                            : t("settings.missedWhileOff", ["count": "\(missed.total)"])
                    )
                    .font(.golos(13, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    Text(
                        relativeDay(missed.last_at, locale: appLocale).map {
                            t("settings.missedWhileOffNoteDated", ["day": $0])
                        } ?? t("settings.missedWhileOffNote")
                    )
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(
                    BrandColor.inset,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
            }
        }
        .task(id: show) {
            guard show else { return }
            missed = try? await scope.repo.missedWhileOff(scope.companyId)
        }
    }
}

/// #481 — what a departing crew's customers are told, while we still hold the
/// number.
///
/// THE DEADLINE IS THE FEATURE. After release the number belongs to somebody
/// else and nothing can answer from it, so this is not forwarding — it is
/// "tell the people who text you, while we still can". The copy leads with when
/// it stops, because an owner who believes this outlives their account has been
/// misled at the worst possible moment.
///
/// THE WORDS ARE THEIRS: an empty box with an example placeholder, never a
/// draft. Writing the message IS the opt-in, so there is no separate switch to
/// leave somebody unsure whether they set this up.
///
/// NO PERSUASION. A business is winding down, and how we behave on the way out
/// is the referral channel (#399).
@MainActor
private struct OffRampCard: View {
    let scope: SettingsScope
    let company: CompanyView

    private static let maxCharacters = 320

    @State private var draft = ""
    @State private var busy = false

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    private var saved: String? { company.offramp_message }
    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Group {
            if company.subscription_status == SubscriptionStatus.canceled,
               SettingsRoleGate.canManageBilling(scope.role) {
                SettingsCard(title: t("settings.offRampTitle")) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(blurb)
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.muted600)
                            .fixedSize(horizontal: false, vertical: true)

                        TextField(
                            t("settings.offRampPlaceholder"),
                            text: $draft,
                            axis: .vertical
                        )
                        .lineLimit(3...6)
                        .font(.golos(13))
                        .disabled(busy)
                        .onChange(of: draft) { _, next in
                            if next.count > Self.maxCharacters {
                                draft = String(next.prefix(Self.maxCharacters))
                            }
                        }

                        Text(
                            trimmed.isEmpty
                                ? t("settings.offRampEmpty")
                                : t(
                                    "settings.offRampCount",
                                    ["count": "\(trimmed.count)", "max": "\(Self.maxCharacters)"]
                                )
                        )
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted600)

                        HStack(spacing: 12) {
                            Button(
                                saved == nil ? t("settings.offRampStart") : t("common.save")
                            ) {
                                Task { await save(trimmed) }
                            }
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                            .buttonStyle(.plain)
                            .disabled(busy || trimmed.isEmpty || trimmed == (saved ?? ""))

                            if saved != nil {
                                Button(t("settings.offRampTurnOff")) {
                                    draft = ""
                                    Task { await save(nil) }
                                }
                                .font(.golos(13, weight: .semibold))
                                .foregroundStyle(BrandColor.muted600)
                                .buttonStyle(.plain)
                                .disabled(busy)
                            }
                        }
                    }
                }
                .task(id: saved) { draft = saved ?? "" }
            }
        }
    }

    /// Through `numberReleaseDay`, which is the one place on this screen the
    /// release date is computed. This card used to add its own 30 days in its own
    /// arithmetic; the Subscription card above it now names the same day, and two
    /// independently-derived deadlines is one drift away from telling an owner
    /// two different days they lose their number.
    ///
    /// Two whole paragraphs rather than one with a clause spliced into its
    /// middle: the dated and undated readings put the date in different places in
    /// French, and a splice fixes it where English wants it.
    private var blurb: String {
        numberReleaseDay(company.canceled_at)
            .map { t("settings.offRampIntroDated", ["date": $0]) }
            ?? t("settings.offRampIntro")
    }

    private func save(_ message: String?) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await scope.repo.updateCompany(
                scope.companyId,
                patch: .object(["offramp_message": message.map { .string($0) } ?? .null])
            )
            scope.showMessage(
                t(message == nil ? "settings.offRampTurnedOff" : "settings.offRampSaved")
            )
        } catch {
            scope.showMessage(t("settings.offRampSaveFailed"))
        }
    }
}

// MARK: - Cancelling (#277)

/// The whole cancellation, rendered OPEN on the billing screen.
///
/// WHY IT EXISTS. Ten cancellations for ten different reasons are noise; ten for
/// the same reason are a roadmap, and until this card both looked identical from
/// here, because the only thing that ever reached us was a webhook. The question
/// has to be asked BEFORE the handoff: afterwards the person is gone, and nobody
/// answers a survey about a product they have just left.
///
/// WHY IT IS NOT A TRIGGER. There is no expand, no sheet, no "are you sure". A
/// control that reveals the screen holding the cancel button is itself a step,
/// and it makes leaving cost two taps where "Manage payment & invoices" directly
/// above costs one. Deliberate friction belongs on deleting an account, which
/// cannot be undone; a subscription can be restarted in a minute, and friction
/// there is a regulatory problem in several of the markets this sells into
/// rather than a kindness. Do not copy the collapse from a destructive control
/// into this card: they are opposite cases.
///
/// ONE TAP THROUGH. From landing on the billing screen, somebody who answers
/// nothing reaches Stripe with a single press of "Continue to cancel". Nothing
/// is pre-selected, and the ONLY thing that may ever disable that button is the
/// request already in flight: never the reason, never the note. A default answer
/// would be a reason nobody gave, and every count built on it would be wrong in
/// the direction we chose.
///
/// THE QUESTION IS QUIET. It sits under the consequence copy in the same muted
/// voice as the rest of the supporting text here. A billing screen should not
/// shout "why are you leaving?" at somebody who came to check their plan, and it
/// must not hide the exit either.
///
/// NO "NEVER MIND" BESIDE IT. With nothing expanded there is nothing to back out
/// of, and a second button next to the confirm is where the asymmetry creeps in:
/// a loud stay and a quiet leave is the pattern this card exists to avoid.
///
/// NOTHING WAITS ON US. The reason is posted on its own task that is never
/// awaited, so a slow, failing or entirely dead endpoint of ours cannot stop
/// somebody cancelling.
///
/// OWNER ONLY, SAID OUT LOUD. POST /v1/billing/portal mints the full portal for
/// an owner and a `payment_method_update` session for everybody else, and that
/// Stripe flow carries no cancellation surface at all. An admin or a bookkeeper
/// offered this button would be walked to a page where the promised thing does
/// not exist, and the reason they typed on the way would be filed against a
/// cancellation that could never be confirmed. They are told who can instead,
/// and nothing is recorded for them.
///
/// The export offer is here because somebody leaving still needs their customer
/// list, and "they made it hard to leave with our data" is a story a trade tells
/// about a supplier for years.
///
/// THE ANSWER SITS BELOW THE BUTTON THAT LEAVES (#277 follow-up), and that is
/// arithmetic rather than taste. Picking a reason can produce a true and useful
/// thing to say back, but it is four or five lines plus a control. This card is
/// the LAST thing on the billing screen, so somebody who has scrolled to it is
/// at the bottom of a scroll view with "Continue to cancel" near the foot of
/// the viewport. Inserting the answer above that button pushes it off the
/// bottom of the screen and asks for another scroll — in direct response to
/// having answered an OPTIONAL question. Answering must never cost more than
/// skipping. So the answer renders last, the exit does not move, and a plain
/// arrival on this screen is byte-for-byte the screen it was before.
@MainActor
private struct CancelCard: View {
    let scope: SettingsScope
    let company: CompanyView
    /// #277 — read by `PlanCard` above and handed down WHOLE.
    ///
    /// Two things below need different halves of it. The pause OFFER needs the
    /// answer alone (`read.answer`), where a nil renders exactly what "not
    /// eligible" renders: the answer this card already gave. The written answer
    /// under it needs the read STATE, because "not paused" and "not read yet"
    /// have to produce different screens — the first may print the plan switch,
    /// the second may not.
    ///
    /// It gates nothing. Every state of it renders the same exit, in the same
    /// place, enabled by the same one flag.
    let read: PauseRead
    let onPauseChanged: @MainActor () -> Void
    let onRefreshCompany: @MainActor () -> Void

    @State private var chosen: String?
    @State private var detail = ""
    @State private var opening = false
    @State private var error: String?
    @State private var exporting = false
    @State private var exportError: String?
    @State private var exported: StagedContactsCsv?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    private var canCancel: Bool { SettingsRoleGate.canCancelSubscription(scope.role) }

    /// Already scheduled to end. The notice at the top of this screen says so
    /// and offers the way back, so a second set of controls starting the same
    /// journey would read as though the first one had not worked.
    private var alreadyEnding: Bool { company.cancel_at_period_end }

    /// What is true FOR THE READER, which is not the same sentence for
    /// everybody. "Cancel anytime" is a promise an admin or a bookkeeper cannot
    /// keep, and making it and then withdrawing it one line later reads as a
    /// runaround. The facts are identical either way; only the person they
    /// happen to changes.
    ///
    /// THE HOLD IS ANCHORED TO THE CANCELLATION, and this is the sentence that
    /// got it wrong. It read "texting stops at the end of your billing period,
    /// and we hold your number for 30 days" — two clauses in one breath, which
    /// invites the reader to count the 30 from the period end. The clock does
    /// not start there: `runGraceJob` measures `now - canceled_at`, and
    /// `startCancellationLifecycle` stamps that column from Stripe's
    /// `canceled_at`, which on a `cancel_at_period_end` cancellation is the
    /// time of the REQUEST. Somebody cancelling on day 2 of a month counted
    /// about 59 days and had about 30, and what they lose at the end of the
    /// miscount is the number on the side of the van and on their invoices.
    ///
    /// The wrong anchor is named in order to deny it, because the reader
    /// already has it in their head — it is the date in the sentence before.
    /// The same correction is made in the scheduled-cancellation notice at the
    /// top of this screen and in the shared seasonal answer, and all three now
    /// say it the same way round.
    ///
    /// # IT MAY NOT DATE A STOP THAT HAS ALREADY HAPPENED (#524)
    ///
    /// This is STANDING copy: it renders in every state of the pause read, for
    /// every reader, above everything else on the card. It used to open
    /// "Texting stops at the end of your billing period", which is false for
    /// somebody already paused — their texting stopped the day they paused — and
    /// it sat one card below the paused plan card saying texting is already off.
    /// Two sentences on one screen, and the false one was addressed to exactly
    /// the reader the true one was written for.
    ///
    /// # Why it is fixed by rewriting rather than by branching
    ///
    /// A pause-aware sentence here would have to consult the pause read, and
    /// there is no other source: `paused_at` is deliberately kept off
    /// `CompanyView` (see `BillingPause` in Core.swift), so the only answer on
    /// this client comes from `GET /v1/billing/pause`. Two things forbid that.
    /// It is on the way to "Continue to cancel" — this string is an argument to
    /// the card that holds the exit — and nothing on that path may depend on a
    /// read that can be slow or fail. And a branch would still be WRONG in the
    /// two states it cannot reach: while the read is in flight and after it has
    /// failed, a branched sentence prints whichever claim was chosen as the
    /// default, at which point a paused reader is reading the old defect again.
    ///
    /// So the clause is written to be true in all four states instead. "Nothing
    /// changes until the end of your billing period" holds for a paused
    /// workspace (the hold and the holding fee both continue) and for an
    /// unpaused one; and the reader's real question — do I lose service the
    /// moment I press this — is answered by a condition they resolve
    /// themselves rather than by one we have to read. The hold's anchor moves
    /// with it, from "the day texting stops" to the day the plan ends, which is
    /// the date the sentence before actually put in their head.
    private var consequence: String {
        t(
            canCancel ? "settings.cancelConsequence" : "settings.cancelOwnerOnly",
            ["days": "\(cancellationGraceDays)"]
        )
    }

    var body: some View {
        SettingsCard(title: t("settings.cancelTitle"), description: consequence) {
            if !canCancel {
                // Said out loud rather than by omission: being sent to hunt for
                // a button that is not on that page is worse than being told.
                // "above", not "an admin reaches": a bookkeeper reads this line
                // too, and lands on the same card-only portal an admin does.
                ReadOnlyLine(t("settings.cancelNotInPortal"))
            } else if alreadyEnding {
                EmptyView()
            } else {
                leaving
            }
        }
        .sheet(item: $exported) { file in
            ContactsCsvShareSheet(url: file.url) { exported = nil }
        }
    }

    /// The question, the export offer and the way out, all visible at once and
    /// in that order, because the half that serves us comes after the halves
    /// that serve them.
    private var leaving: some View {
        VStack(alignment: .leading, spacing: 0) {
            reasonQuestion
            Spacer().frame(height: 20)
            exportOffer
            Spacer().frame(height: 20)
            Text(t("settings.cancelHandoffNote"))
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
            // #228 — THE ONE LITERAL LEFT ON THIS SCREEN, AND IT IS PINNED HERE
            // BY A GUARD RATHER THAN BY AN OVERSIGHT.
            //
            // `CancelOneActionTests` anchors its entire one-press property on
            // finding the exact phrase "Continue to cancel" on a CODE line
            // inside `leaving` (`exitLabel`, and `code()` blanks whole-line
            // comments so it cannot be satisfied by one). From that anchor it
            // derives the modifier chain, the allowlist of what may touch this
            // button, and the walk that proves nothing branches in front of it.
            // Swapping the label for `t("settings.cancelExitAction")` removes
            // the anchor and every one of those assertions fails with "the way
            // out moved or was renamed" — trading a guard on the control
            // somebody presses to stop paying us for one translated word.
            //
            // The key EXISTS and holds both languages; finishing this is a
            // one-line change in that test (anchor on the key rather than on
            // the English), which is not this pass's file to touch. Left
            // English, on purpose, and reported.
            Button(opening ? "Opening…" : "Continue to cancel") { handOff() }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
                // The request already in flight, and nothing else, ever.
                .disabled(opening)
                .padding(.top, 10)
            InlineError(error)
            // LAST, and after the exit on purpose — see the card's docblock.
            // Computed from the LOCAL selection rather than read back from the
            // server: the answer belongs to the tap, and a round trip would put
            // a spinner in the middle of a cancel screen.
            //
            // #277 — THE PAUSE TAKES THE SEASONAL SLOT, it does not add a slot.
            // The shared seasonal answer has to end by admitting that a quiet
            // season longer than the hold outruns it and the number goes back to
            // the phone company; a real pause is simply a better answer to the
            // same sentence, so it renders in the same place, in the same muted
            // box, with the same one outline control under it. The exit above is
            // untouched by either: same position, same enabledness, and nothing
            // new between the consequence copy and the button.
            if let price = pauseAnswerPrice(reason: chosen, pause: read.answer) {
                PauseOfferNote(
                    scope: scope,
                    price: price,
                    resumePlanName: planFacts(
                        read.answer?.resume_plan ?? company.plan,
                        company.billedIn
                    )?.name,
                    onPaused: onPauseChanged
                )
                .padding(.top, 20)
            } else if let offer = cancellationOffer(
                // THE READ, and not a Bool derived from it at this call site. A
                // paused workspace must not be handed "Switch to Starter" (that
                // POST answers 409 until they resume), and neither must one whose
                // read has not landed: we do not know yet, and `false` would be a
                // claim rather than a fact.
                read: read,
                reason: chosen,
                plan: company.plan,
                billingCurrency: company.billing_currency,
                country: company.country,
                registrationFeePaidAt: company.registration_fee_paid_at,
                locale: appLocale
            ) {
                CancellationAnswerNote(
                    offer: offer,
                    scope: scope,
                    company: company,
                    onRefreshCompany: onRefreshCompany
                )
                .padding(.top, 20)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Asked in the supporting voice rather than as a heading. This card is on
    /// the screen somebody opens to look at their plan, so the question is the
    /// quietest thing on it; a bold "Why are you leaving?" printed above a
    /// button reads as a gate until it says otherwise, and it says otherwise
    /// on the very next line.
    private var reasonQuestion: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 12, not larger: SettingsCard renders its description at 12, and a
            // question subordinate to that copy cannot be set above it. Colour
            // alone was carrying the hierarchy while the type contradicted it.
            Text(t("settings.cancelWhyAsk"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
            Text(t("settings.cancelWhyAskOptional"))
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted500)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            Spacer().frame(height: 4)
            ForEach(cancellationReasons) { reason in
                CancellationReasonRow(reason: reason, selected: chosen == reason.code) {
                    // Tapping the chosen one CLEARS it. An answer given by a
                    // stray thumb has to be removable, or "optional" stops
                    // being true the moment the list is touched.
                    chosen = chosen == reason.code ? nil : reason.code
                }
                .disabled(opening)
            }
            Spacer().frame(height: 8)
            TextField(
                t("settings.cancelDetailLabel"),
                text: Binding(
                    get: { detail },
                    // Capped where the server caps it, the same way the invite
                    // note is: an over-long paste stops taking characters
                    // rather than coming back as a 422 with the words lost.
                    set: { detail = truncatedCancellationDetail($0) }
                ),
                axis: .vertical
            )
            .textFieldStyle(.roundedBorder)
            .lineLimit(2 ... 4)
            .font(.golos(13))
            .disabled(opening)
        }
    }

    private var exportOffer: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(t("settings.cancelExportHeading"))
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            // The columns are named because this is a promise to somebody who is
            // leaving and cannot come back to check it. GET /v1/contacts/export
            // carries name, phone, tags, consent source and dates. Custom fields
            // are not in it, so nothing here may imply they are.
            Text(t("settings.cancelExportIntro"))
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
            Button(
                exporting
                    ? t("settings.cancelExporting")
                    : t("settings.cancelExportAction")
            ) { exportContacts() }
                .buttonStyle(.bordered)
                .disabled(exporting)
                .padding(.top, 10)
            InlineError(exportError)
        }
    }

    /// Record what they said, then go, in that order and without ever waiting
    /// for the first to finish.
    ///
    /// The reason rides an UNSTRUCTURED task deliberately: `.task` would be
    /// cancelled the moment the browser comes forward and takes this screen
    /// with it, which is the very next thing that happens. Its failure is
    /// swallowed for the same reason the caller does not wait on it: there is
    /// nothing a person cancelling their subscription can usefully do about our
    /// own bookkeeping being down.
    ///
    /// A retry after a failed handoff posts again. The route upserts the open
    /// row, so that stays one statement rather than becoming three.
    ///
    /// Nothing is recorded for somebody who cannot cancel. The button is not
    /// rendered for them, and the guard says so here as well, because a row
    /// written for a walk that ends on a Stripe page with no cancel button on
    /// it can never be confirmed, and it would sit in the report as somebody
    /// who said why and stayed.
    private func handOff() {
        guard canCancel else { return }
        opening = true
        error = nil
        let saidReason = chosen
        let saidDetail = detail
        Task {
            try? await scope.repo.recordCancellationReason(
                scope.companyId,
                reason: saidReason,
                detail: saidDetail
            )
        }
        Task {
            do {
                let hosted = try await scope.repo.billingPortal(scope.companyId)
                openExternal(hosted.url)
            } catch {
                self.error = error.userMessage
            }
            opening = false
        }
    }

    private func exportContacts() {
        exporting = true
        exportError = nil
        Task {
            do {
                let csv = try await scope.repo.contactsCsvExport(scope.companyId)
                exported = StagedContactsCsv(url: try stageContactsCsv(csv))
            } catch {
                exportError = error.userMessage
            }
            exporting = false
        }
    }
}

/// One reason, offered as a radio row: the shape the after-hours and voicemail
/// pickers already use on this screen, so a choice looks like a choice.
private struct CancellationReasonRow: View {
    let reason: CancellationReason
    let selected: Bool
    let onTap: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Button {
            onTap()
        } label: {
            HStack(alignment: .center, spacing: 10) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? BrandColor.olive : Color.secondary)
                Text(AppStrings.translate(appLocale, reason.labelKey))
                    .font(.body)
                    .foregroundStyle(Color.primary)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // SwiftUI reads a plain Button as a button, which says nothing about
        // whether this one is currently the answer.
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// MARK: - Answering that reason (#277 follow-up)

/// The muted note box the two answers share.
///
/// The same one `MissedWhileOffNote` uses at the top of this screen, and a NOTE
/// rather than a card on purpose: the cards here are the workspace's own state,
/// and these are things we know that the reader does not. A second SettingsCard
/// would read as a competing offer on a screen somebody came to leave from.
private extension View {
    func cancellationNoteBox() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                BrandColor.inset,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
    }
}

/// The words of one offer: heading and body, tight together because they are
/// one thought. Every sentence comes from `cancellationOffer`, which reads the
/// price book and the plan limits rather than restating them — there is no
/// fallback string anywhere in this file, because a client that substituted its
/// own copy for a nil would be inventing the retention offer the shared module
/// exists to prevent.
private struct CancellationAnswerText: View {
    let offer: CancellationOffer

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(offer.heading)
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(offer.body)
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The answer to the reason just picked, on the cancel card.
///
/// IT ADDS NOTHING TO LEAVING. No confirmation, no disabled state, and nothing
/// on the exit above it changes because this appeared — the one control here is
/// an outline button under a paragraph. The sheet below belongs to "Switch to
/// Starter" and sits nowhere near the path to Stripe; it is the same
/// `ChangePlanSheet` the plan card already opens, so the downgrade checklist
/// (numbers, seats) is the one that already tells the truth about what fits.
///
/// The button is deliberately NOT the prominent olive. That is reserved for
/// "Continue to cancel" on this card: a loud stay above a quiet leave is the
/// asymmetry the card's own docblock exists to avoid.
@MainActor
private struct CancellationAnswerNote: View {
    let offer: CancellationOffer
    let scope: SettingsScope
    let company: CompanyView
    let onRefreshCompany: @MainActor () -> Void

    @State private var changingPlan = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CancellationAnswerText(offer: offer)
            if let action = offer.action, let label = offer.actionLabel {
                control(action, label: label)
                    .padding(.top, 10)
            }
        }
        .cancellationNoteBox()
        .sheet(isPresented: $changingPlan) {
            ChangePlanSheet(scope: scope, company: company) {
                changingPlan = false
                onRefreshCompany()
            } onDismiss: {
                changingPlan = false
            }
        }
    }

    /// The control the offer NAMES, with the offer's own words on it. An
    /// unhandled action renders nothing rather than guessing: a fallback
    /// control would be a button that does something other than its label says.
    @ViewBuilder
    private func control(_ action: CancellationOfferAction, label: String) -> some View {
        switch action {
        case .changePlan:
            Button(label) { changingPlan = true }
                .buttonStyle(.bordered)
        case .openHelp:
            NavigationLink(label, value: SettingsSection.help)
                .buttonStyle(.bordered)
        // `resubscribeStarter` cannot reach this phase — the subscription is
        // still live here, so there is nothing to come back from.
        case .resubscribeStarter:
            EmptyView()
        }
    }
}

// MARK: - Pausing instead (#277)

/// The answer to "quiet season, I'll be back", when there is a real pause to
/// offer instead of a 30-day hold.
///
/// # It replaces an answer; it does not add a step
///
/// This is the constraint that outranks everything else on this card, and it is
/// arithmetic rather than taste. Reaching Stripe while answering nothing is ONE
/// action from landing on the billing screen, and it stays one: this note lives
/// in the slot the shared seasonal answer already occupied, which is BELOW
/// "Continue to cancel". Nothing new appears above that button, it does not
/// move, and nothing here can disable it — the only thing that ever may is the
/// handoff already in flight.
///
/// A pause offer is an offer. It is never a confirmation in front of the exit,
/// and never a reason the exit is unavailable.
///
/// # The price is on the control
///
/// `monthly_cents` is read from Stripe before this ever renders, and the button
/// says it out loud. Nobody agrees to a recurring charge from a button labelled
/// "Pause", and this file has no fallback price to put there if the API sends
/// none — in that case `pauseAnswerPrice` returns nil and this does not render.
///
/// # Why there is a sheet on the way in
///
/// Pausing stops a live business texting and starts a monthly charge. Both of
/// the other controls on this screen that do either — the module toggles and the
/// plan switch — confirm first, and this is the larger of the two. The step is
/// in front of the PAUSE and nowhere near the exit: somebody who came here to
/// leave never opens it, and their path is the same length it was yesterday.
@MainActor
private struct PauseOfferNote: View {
    let scope: SettingsScope
    let price: String
    let resumePlanName: String?
    let onPaused: @MainActor () -> Void

    @State private var confirming = false
    @State private var pending = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(t("settings.pauseOfferHeading"))
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(
                pauseOfferBody(
                    price: price,
                    resumePlanName: resumePlanName,
                    locale: appLocale
                )
            )
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted600)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 3)
            // Outline, never the prominent olive. That is reserved for "Continue
            // to cancel" on this card: a loud stay above a quiet leave is the
            // asymmetry the card's own docblock exists to avoid.
            Button(t("settings.pauseOfferAction", ["price": price])) { confirming = true }
                .buttonStyle(.bordered)
                .disabled(pending)
                .padding(.top, 10)
        }
        .cancellationNoteBox()
        // ON THE MODIFIER, not in the sheet's own Cancel button. A failure left
        // in `error` reappears the next time this sheet opens, so somebody who
        // hit a 409, backed out and came back would read last time's refusal
        // above a button they have not pressed yet — and a stale refusal about a
        // recurring charge is read as this attempt's. `.sheet`'s `onDismiss`
        // fires however the sheet closes, including the interactive swipe, which
        // is the case a Cancel-button reset would miss.
        .sheet(isPresented: $confirming, onDismiss: { error = nil }) {
            ConfirmSheet(
                title: t("settings.pauseConfirmTitle"),
                message: pauseConfirmMessage(price: price, locale: appLocale),
                confirmLabel: t("settings.pauseConfirmAction"),
                pending: pending,
                // The failure is shown INSIDE the sheet, which is the only place
                // it can be read: the sheet stays open on an error, and a 409
                // here carries a sentence written for the customer.
                error: error,
                dismissLabel: t("common.cancel"),
                onConfirm: { pauseNow() },
                onDismiss: { confirming = false }
            )
        }
    }

    /// Pause, and believe the RESPONSE.
    ///
    /// The route re-reads its own mirror after the Stripe swap and answers 409
    /// when the two disagree rather than reporting a success it cannot see — so
    /// the confirmation is composed from what came back, and a failure shows the
    /// API's own words. Nothing here assumes the request worked.
    private func pauseNow() {
        pending = true
        error = nil
        let locale = appLocale
        Task {
            do {
                let paused = try await scope.repo.pausePlan(scope.companyId)
                confirming = false
                scope.showMessage(
                    pausedConfirmationMessage(
                        monthlyCents: paused.monthly_cents,
                        locale: locale
                    )
                )
                onPaused()
            } catch {
                self.error = error.userMessage
            }
            pending = false
        }
    }
}

/// The same answer again, while the number can still be saved.
///
/// # Why here and not in the mail
///
/// The day 1/15/27 grace emails already point at this screen, so it receives
/// win-back traffic on a cadence and had nothing to say when they arrived. It
/// stays IN THE APP for reasons that are legal rather than tasteful:
/// `MAILING_ADDRESS` is null in business-identity.ts and our one commercial
/// sender refuses on that basis; the grace emails ride the critical reputation
/// stream and carry no unsubscribe by design; and the only opt-out list is
/// global, so declining a win-back by email would also silence that workspace's
/// payment-failure and security mail. A card is not an electronic message and
/// carries none of that.
///
/// # Why not in OffRampCard
///
/// That card's docblock forbids persuasion in as many words — "a screen that
/// argues with them about leaving... is the last thing they will remember about
/// us" — and it is right. This sits in the Subscription card beside
/// Resubscribe, which is the control it is about.
///
/// # The three gates, in the order they cost something
///
///   1. dismissed        a press this session, or a stored stamp NEWER than
///                       this cancellation. The comparison is what makes a
///                       dismissal belong to ONE cancellation.
///   2. within grace     past the release the number is back in carrier
///                       inventory and reassignable to another business (#413),
///                       so "come back and keep your number" stops being true
///                       at exactly that boundary.
///   3. a stated reason  asked only once gates 1 and 2 have passed, so a
///                       healthy workspace never asks and a dismissed one stops
///                       asking. Nil renders nothing: they said "switched", or
///                       "not using it", or they are already on the cheapest
///                       plan, and there is nothing honest to add.
///
/// NO SPINNER AND NO ERROR BOX around the read, for the reason
/// `MissedWhileOffNote` gives: this is a supporting note on somebody else's
/// screen, and a broken box where a sentence should be makes the billing itself
/// look broken.
@MainActor
private struct WinbackNote: View {
    let scope: SettingsScope
    let company: CompanyView

    @State private var stated: String?
    @State private var dismissed = false
    @State private var opening = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    /// Worth asking the server anything about.
    private var open: Bool {
        !dismissed
            && !winbackIsDismissed(
                canceledAt: company.canceled_at,
                dismissedAt: company.winback_dismissed_at
            )
            && isWithinCancellationGrace(company.canceled_at)
    }

    private var offer: CancellationOffer? {
        guard open else { return nil }
        return cancellationOffer(
            reason: stated,
            plan: company.plan,
            phase: .grace,
            billingCurrency: company.billing_currency,
            country: company.country,
            registrationFeePaidAt: company.registration_fee_paid_at,
            locale: appLocale
        )
    }

    var body: some View {
        Group {
            if let offer {
                VStack(alignment: .leading, spacing: 0) {
                    CancellationAnswerText(offer: offer)
                    HStack(spacing: 16) {
                        if let action = offer.action, let label = offer.actionLabel {
                            control(action, label: label)
                        }
                        Button {
                            waveAway()
                        } label: {
                            Text(t("settings.winbackNoThanks"))
                                .font(.golos(13, weight: .semibold))
                                .foregroundStyle(BrandColor.muted600)
                                .padding(.vertical, 8)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.top, 6)
                    InlineError(error)
                }
                .cancellationNoteBox()
                .padding(.top, 12)
            }
        }
        .task(id: open) {
            guard open else { return }
            stated = try? await scope.repo.cancellationReason(scope.companyId).reason
        }
    }

    @ViewBuilder
    private func control(_ action: CancellationOfferAction, label: String) -> some View {
        switch action {
        // STARTER, not `company.plan`. They left because Pro was too expensive,
        // and the one control that answers that must not put them back on Pro.
        //
        // THIS BUTTON ENFORCES NOTHING, and the copy above it is written to
        // that. It opens Stripe checkout, whose only gates are "one live
        // subscription" and the US registration draft — no seat count, no
        // number count. Coming back is never refused, and #523 did not change
        // that: what changed is what happens AFTERWARDS. The completion handler
        // now claims the allowance, so a Pro workspace with two numbers lands on
        // Starter with one active and one HELD — not released, still receiving,
        // named on the billing screen with two priced routes back. Seats are
        // still not enforced anywhere but the invite and its acceptance, so
        // eight members stay eight.
        //
        // The shared grace copy therefore still names the PRICE and nothing
        // else. A caption promising "3 people and 1 business number" here would
        // be false about the seats in either direction, and about the numbers it
        // would describe a refusal that does not happen — the second number is
        // held rather than turned away. Whether that copy should now mention the
        // hold is a decision for the shared module, not for this file: the same
        // sentence is hand-ported to three clients and one of them editing it
        // alone is the drift the module exists to prevent.
        //
        // The button stays regardless: change-plan 409s a canceled subscription
        // outright, so checkout is the only way back, and removing this would
        // leave the win-back with nothing to press at the one moment it is
        // worth anything.
        case .resubscribeStarter:
            Button(opening ? t("settings.billingOpening") : label) {
                comeBack(on: "starter")
            }
            .buttonStyle(.bordered)
            .disabled(opening)
        case .openHelp:
            NavigationLink(label, value: SettingsSection.help)
                .buttonStyle(.bordered)
        // `changePlan` cannot reach this phase — there is no live subscription
        // to switch, so nothing is rendered rather than a guessed control.
        case .changePlan:
            EmptyView()
        }
    }

    /// "Stop showing me this."
    ///
    /// HIDDEN FIRST, SENT SECOND — the same order the cancel card uses for the
    /// reason, and for the same reason: a press must never wait on a round
    /// trip. A failed dismissal is said quietly rather than as an alert telling
    /// somebody who has already left that our server would not take their "no
    /// thanks".
    ///
    /// IT CAN COME BACK BEFORE THE APP IS CLOSED, and saying otherwise would be
    /// a promise about a flag that cannot keep it. `dismissed` is `@State`, so
    /// it dies with this view: leaving the billing screen and returning inside
    /// the same session rebuilds `WinbackNote` with `dismissed == false`, and
    /// the cached `CompanyView` still carries the `winback_dismissed_at` it was
    /// fetched with — nothing refetches the company on a dismissal, and the
    /// only write is the POST. So the second gate has not learned about the
    /// press either, and the note draws again.
    ///
    /// Left as it is rather than fixed, because every fix is worse than the
    /// symptom. Refetching the company would put a load on the press this
    /// docblock exists to keep instant; hoisting the flag into a session-scoped
    /// store would make one workspace's "no thanks" outlive the cancellation it
    /// was made on, which is the exact thing `winbackIsDismissed` compares
    /// timestamps to prevent. A note seen twice in one sitting is a small cost;
    /// it is honest about being one, and it stops for good on the next launch.
    private func waveAway() {
        dismissed = true
        let locale = appLocale
        Task {
            do {
                try await scope.repo.dismissWinback(scope.companyId)
            } catch {
                scope.showMessage(
                    AppStrings.translate(locale, "settings.winbackDismissFailed")
                )
            }
        }
    }

    private func comeBack(on plan: String) {
        opening = true
        error = nil
        Task {
            do {
                let hosted = try await scope.repo.checkout(scope.companyId, plan: plan)
                openExternal(hosted.url)
            } catch {
                self.error = error.userMessage
            }
            opening = false
        }
    }
}

// MARK: - Handing the export to the phone

/// One finished export, staged on disk for the share sheet.
private struct StagedContactsCsv: Identifiable {
    let id = UUID()
    let url: URL
}

/// Stage the CSV as `contacts.csv` in a unique temp folder so the share sheet
/// offers a well-named file rather than a wall of text.
///
/// The server emits a UTF-8 BOM so Excel round-trips accents; it is re-attached
/// defensively here in case a transport layer stripped it, which is the same
/// thing the contacts screen does with the same bytes.
private func stageContactsCsv(_ text: String) throws -> URL {
    let data = csvExportData(text)

    let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appendingPathComponent("contacts.csv")
    try data.write(to: url)
    return url
}

/// The real system share sheet (AirDrop, Messages, Mail, Save to Files), where
/// a file exporter could only save.
private struct ContactsCsvShareSheet: UIViewControllerRepresentable {
    let url: URL
    let onFinish: @MainActor () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        let onFinish = onFinish
        controller.completionWithItemsHandler = { _, _, _, _ in
            // UIKit calls this on the main thread.
            MainActor.assumeIsolated { onFinish() }
        }
        return controller
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

// MARK: - Previews

/// The reason list as it is first seen: six choices, NOTHING pre-selected.
/// A default here would be a reason we invented on somebody's behalf and then
/// counted, so the empty state is the one worth being able to look at.
#Preview("Cancellation reasons · nothing chosen") {
    VStack(alignment: .leading, spacing: 0) {
        ForEach(cancellationReasons) { reason in
            CancellationReasonRow(reason: reason, selected: false) {}
        }
    }
    .padding(20)
    .frame(width: 390)
    .background(BrandColor.paper)
}

#Preview("Cancellation reasons · one chosen") {
    VStack(alignment: .leading, spacing: 0) {
        ForEach(cancellationReasons) { reason in
            CancellationReasonRow(
                reason: reason,
                selected: reason.code == cancellationReasonSeasonal
            ) {}
        }
    }
    .padding(20)
    .frame(width: 390)
    .background(BrandColor.paper)
}

/// Every answer that exists, on the cancel card. Three of the six reasons are
/// missing from this preview and that is the point: `switched`, `not_using` and
/// `other` have nothing honest to add, so they draw nothing at all.
#Preview("Cancellation answers · before leaving") {
    ScrollView {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(cancellationReasons) { reason in
                if let offer = cancellationOffer(
                    reason: reason.code,
                    plan: "pro",
                    billingCurrency: "usd",
                    country: "US",
                    registrationFeePaidAt: "2026-01-05T00:00:00Z"
                ) {
                    CancellationAnswerText(offer: offer)
                        .cancellationNoteBox()
                }
            }
        }
        .padding(20)
    }
    .frame(width: 390)
    .background(BrandColor.paper)
}

/// #277 — the two answers `seasonal` can get, one above the other.
///
/// The point of reading them together: the shared answer has to end by admitting
/// that a season longer than the hold outruns it and the number goes to somebody
/// else, and the pause is the same paragraph with that sentence deleted. Only
/// one of them is ever on screen.
///
/// THE FIXTURE IS A RESPONSE, NOT A PRICE. A preview has no API, and the pause
/// price does not exist in this repository at all — the founder provisions a
/// Stripe price and the API reads it back. So the amount enters as CENTS, in the
/// shape the route sends, and the string on screen comes out of the very
/// `pauseOfferPrice` the screen calls. Every other preview in this file derives
/// its prices the same way, through `planFacts` and `cancellationOffer`, and the
/// file carried no formatted price literal before the pause existed. A typed
/// "$5" here would be a recurring charge this repository invented, sitting one
/// copy-paste away from the code path that renders the real one.
///
/// AND NOT A ROUND ONE. 500 cents renders "$5", which is exactly what a hardcode
/// renders, so a preview built on it looks identical whether the price came from
/// the response or from somebody's fingers. 1275 cents renders "$12.75", which
/// nothing types by accident.
#Preview("Seasonal · the pause and the answer it replaces") {
    let offered = BillingPause(
        eligible: true,
        reason: nil,
        paused_at: nil,
        monthly_cents: 1275,
        resume_plan: "pro"
    )
    ScrollView {
        VStack(alignment: .leading, spacing: 14) {
            // Absent without a quotable price, exactly as the card behaves: the
            // preview cannot render a state the screen refuses to render.
            if let price = pauseOfferPrice(offered) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Pause instead — the number stays, the texting stops")
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(
                        pauseOfferBody(
                            price: price,
                            resumePlanName: planFacts(offered.resume_plan, .usd)?.name
                        )
                    )
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 3)
                    Button("Pause for \(price)/mo") {}
                        .buttonStyle(.bordered)
                        .padding(.top, 10)
                }
                .cancellationNoteBox()
            }

            if let offer = cancellationOffer(
                reason: cancellationReasonSeasonal,
                plan: "pro",
                billingCurrency: "usd",
                country: "US",
                registrationFeePaidAt: "2026-01-05T00:00:00Z"
            ) {
                CancellationAnswerText(offer: offer)
                    .cancellationNoteBox()
            }
        }
        .padding(20)
    }
    .frame(width: 390)
    .background(BrandColor.paper)
}

/// #277 — the paused state, with and without a figure from the server.
///
/// The second one is the case worth being able to look at: no price came back,
/// so no price is printed, and the card says nothing about money rather than
/// falling back to the plan's own price over a workspace paying a holding fee.
///
/// CENTS IN, AND THE ROW RUNS THE REAL FUNCTIONS. `nil` cents is a response that
/// quoted nothing, and what it renders is decided by `pausedMonthlyPrice` rather
/// than by this preview — so the empty case cannot be drawn as passing while the
/// shipped one prints a plan price. Same reason as the offer preview above: no
/// formatted price is typed anywhere in this file.
///
/// A DIFFERENT AMOUNT FROM THE OFFER PREVIEW, on purpose: 940 renders "$9.40"
/// where that one renders "$12.75", so no single typed string could stand in for
/// both and the two surfaces are visibly reading their own responses.
#Preview("Paused · with and without a quoted price") {
    ScrollView {
        VStack(alignment: .leading, spacing: 14) {
            ForEach([940, nil] as [Int?], id: \.self) { cents in
                let paused = BillingPause(
                    eligible: false,
                    reason: "already_paused",
                    paused_at: "2026-01-05T00:00:00Z",
                    monthly_cents: cents,
                    resume_plan: "pro"
                )
                let facts = planFacts(paused.resume_plan, .usd)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 10) {
                        Text(facts.map { "\($0.name) · paused" } ?? "Paused")
                            .font(.title3.weight(.semibold))
                        StatusPill(label: "Paused", tone: .neutral)
                    }
                    Spacer().frame(height: 8)
                    ForEach(
                        pausedStateLines(price: pausedMonthlyPrice(paused)), id: \.self
                    ) { line in
                        Text("· \(line)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.vertical, 1)
                    }
                    Text(pauseResumeLabel(planName: facts?.name))
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                        .padding(.top, 10)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(
                    BrandColor.paper,
                    in: RoundedRectangle(cornerRadius: 22, style: .continuous)
                )
            }
        }
        .padding(20)
    }
    .frame(width: 390)
    .background(BrandColor.inset)
}

/// The same answers during the grace window, where the verb changes from
/// "switch" to "come back". A Canadian workspace, so the prices in the first
/// one are the ones that workspace is actually charged.
#Preview("Cancellation answers · during the grace window") {
    ScrollView {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(cancellationReasons) { reason in
                if let offer = cancellationOffer(
                    reason: reason.code,
                    plan: "pro",
                    phase: .grace,
                    billingCurrency: "cad",
                    country: "CA",
                    registrationFeePaidAt: nil
                ) {
                    CancellationAnswerText(offer: offer)
                        .cancellationNoteBox()
                }
            }
        }
        .padding(20)
    }
    .frame(width: 390)
    .background(BrandColor.paper)
}
