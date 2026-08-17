import SwiftUI

/// #245 — your scheduled work, in the calendar you already use.
///
/// The twin of the web's `calendar-feed-card.tsx`. Same three decisions, made
/// with this platform's controls rather than transliterated from that one's.
///
/// # Evaluation
///
/// A per-member subscription URL: created, rotated, revoked. The whole card is
/// one decision ("do I want this?") and one irreversible moment ("here is the
/// URL, it will not be shown again"). *Applying: Prioritize Intent* — somebody
/// arriving here either has no feed and wants one, or has one and wants it
/// gone, and nothing else is offered.
///
/// # The three that matter, and what each is made of here
///
/// **The URL is shown ONCE, then it is gone.** An amber panel inside the card
/// rather than a sheet or a toast, which is the argument `ApiKeysSection` next
/// door already made and is more true here: this is the only moment the string
/// exists, and a toast on a phone is four seconds long — usually spent
/// switching to the calendar app the person meant to paste it into. Dismissing
/// it clears `url`, and nothing anywhere holds it afterwards. The server keeps
/// a hash, so no screen could show it again even if one wanted to.
/// *Applying: Zen of Clarity* — a live credential parked in a settings screen
/// is a hazard with no upside.
///
/// **Revoking takes a second press, and the second press says WHAT BREAKS.**
/// A `confirmationDialog` is this platform's second press, and it is used with
/// its title HIDDEN: the web deliberately does not ask "are you sure", and a
/// dialog that put a question above the button would smuggle one back in. The
/// destructive button carries the consequence instead — "my calendar stops
/// updating" — because from the member's side this fails silently: their
/// calendar simply stops. *Applying: Ethical Friction.*
///
/// **"Your calendar last checked 6m" is on screen whenever a feed is live.**
/// A feed nothing has ever polled looks identical to a working one without it,
/// and the commonest way this fails is somebody copying the URL and never
/// finishing in their calendar app. *Applying: Meaningful Highlights.*
///
/// # The one thing this client decides that web did not have to
///
/// It is gated on `conversations.read`, the capability the API's routes ask
/// for. Web reaches this card from a settings page a bookkeeper does not open;
/// on a phone the bookkeeper's ENTIRE app is `SettingsHome` (see `ShellView`),
/// so Profile is a screen they land on. Ungated, the one role that has no
/// scheduled work would be offered a feed of it, and every button would answer
/// 403. Visibility, not authorization — the server's gates are what protect
/// anything.
@MainActor
struct CalendarFeedCard: View {
    let scope: SettingsScope

    @State private var state: LoadState<CalendarFeedStatus> = .loading
    /// Shown once, then gone. Never persisted, never re-fetchable.
    @State private var url: String?
    @State private var copied = false
    @State private var confirmingRevoke = false
    /// One flag for both writes: they are mutually exclusive and each disables
    /// the other's button, so a double tap cannot mint a second URL over the
    /// one still being read off the screen.
    @State private var working = false

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        if MemberRole.canReadConversations(scope.role) {
            card
        }
    }

    private var card: some View {
        SettingsCard(
            title: t("calendarFeed.title"),
            description: t("calendarFeed.description")
        ) {
            if let url {
                shownOnce(url)
            } else {
                switch state {
                case .loading:
                    ProgressView().controlSize(.small)
                case .failed(let message):
                    loadFailed(message)
                case .ready(let status):
                    if status.active {
                        live(status)
                    } else {
                        setUpButton
                    }
                }
            }
        }
        .task { await load() }
    }

    // MARK: - The irreversible moment

    /// Amber rather than red: nothing has gone wrong. But this is the only time
    /// the URL exists, and dismissing without copying means rotating to get
    /// another — which breaks the calendar they may have just set up.
    private func shownOnce(_ link: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(BrandColor.overdueAmber)
                    // Decorative: the sentence beside it says everything the
                    // glyph does, and VoiceOver reading "triangle" adds nothing.
                    .accessibilityHidden(true)
                Text(t("calendarFeed.shownOnceTitle"))
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
            }
            Text(t("calendarFeed.shownOnceDetail"))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
            // Selectable, so a refused or emptied pasteboard still leaves a way
            // through — this string cannot be asked for a second time.
            Text(link)
                .font(.caption.monospaced())
                .foregroundStyle(BrandColor.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(
                    BrandColor.paper,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
            HStack(spacing: 12) {
                Button(copied ? t("calendarFeed.copied") : t("calendarFeed.copy")) {
                    copyToClipboard(link)
                    copied = true
                    Haptics.confirm()
                }
                .buttonStyle(.bordered)
                Button(t("calendarFeed.done")) {
                    url = nil
                    copied = false
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(
            BrandColor.amberBg,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }

    // MARK: - A feed that is on

    private func live(_ status: CalendarFeedStatus) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "calendar.badge.clock")
                    .foregroundStyle(BrandColor.muted600)
                    .accessibilityHidden(true)
                Text(lastChecked(status))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 16) {
                Button(t("calendarFeed.rotate")) { Task { await mint() } }
                    .buttonStyle(.bordered)
                    .disabled(working)
                // Plain rather than bordered: turning it off is the quiet
                // option on a card whose subject is having one.
                Button(t("calendarFeed.revoke"), role: .destructive) {
                    confirmingRevoke = true
                }
                .font(.golos(13))
                .disabled(working)
            }
        }
        // Ethical Friction, with the title hidden on purpose. The second press
        // states the consequence; a visible "Turn it off?" above it would be
        // the "are you sure" the web card deliberately refuses to ask.
        .confirmationDialog(
            t("calendarFeed.revoke"),
            isPresented: $confirmingRevoke,
            titleVisibility: .hidden
        ) {
            Button(t("calendarFeed.revokeConfirm"), role: .destructive) {
                // The feel carries the meaning: this is not undoable from the
                // member's side, and their calendar will go quiet without
                // telling them.
                Haptics.reject()
                Task { await revoke() }
            }
            Button(t("common.cancel"), role: .cancel) {}
        }
    }

    /// The fact that answers "did this work?".
    private func lastChecked(_ status: CalendarFeedStatus) -> String {
        guard let when = status.last_read_at, !when.isEmpty else {
            return t("calendarFeed.neverRead")
        }
        // `relativeTime` renders "" for a stamp it cannot parse, which would
        // leave the sentence trailing off mid-air. `absoluteTime` hands back the
        // raw value in that case — ugly, but it never claims a feed that HAS
        // been polled was not, which is the one thing this line must not do.
        let stamp = relativeTime(when)
        return t(
            "calendarFeed.lastRead",
            ["when": stamp.isEmpty ? absoluteTime(when) : stamp]
        )
    }

    // MARK: - A feed that is off, and a status that would not load

    private var setUpButton: some View {
        Button { Task { await mint() } } label: {
            Label(t("calendarFeed.create"), systemImage: "calendar.badge.plus")
        }
        .buttonStyle(.borderedProminent)
        .tint(BrandColor.olive)
        .disabled(working)
    }

    /// The status call failed — so whether a feed exists is unknown, and the
    /// card offers a retry rather than a Set up button. Minting from here would
    /// silently REPLACE a live feed on somebody whose network dropped for a
    /// second, and they would never learn why their calendar went quiet.
    private func loadFailed(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(message)
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
                .fixedSize(horizontal: false, vertical: true)
            Button(t("common.retry")) { Task { await load() } }
                .buttonStyle(.bordered)
        }
    }

    // MARK: - Calls

    private func load() async {
        do {
            let status = try await scope.repo.calendarFeed(scope.companyId)
            state = .ready(status)
        } catch {
            state = .failed(error.userMessage(appLocale))
        }
    }

    /// Mint, replacing whatever was there.
    private func mint() async {
        working = true
        defer { working = false }
        do {
            let minted = try await scope.repo.createCalendarFeed(scope.companyId)
            copied = false
            url = minted.url
            // Re-read behind the panel, so the "last checked" line is already
            // right — and already reset — the moment the panel is dismissed.
            await load()
        } catch {
            scope.showMessage(t("calendarFeed.failed"))
        }
    }

    private func revoke() async {
        working = true
        defer { working = false }
        do {
            _ = try await scope.repo.revokeCalendarFeed(scope.companyId)
            // The route answers `revoked: false` only when there was nothing
            // live to switch off, which is the same place the caller wanted to
            // end up. Either way the truth comes from re-reading, never from
            // assuming the local state.
            await load()
        } catch {
            scope.showMessage(t("calendarFeed.failed"))
        }
    }
}
