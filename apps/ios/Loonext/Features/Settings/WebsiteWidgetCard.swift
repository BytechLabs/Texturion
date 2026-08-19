import SwiftUI
import UIKit

/// #232 — the "Text us" button an owner puts on their own website.
///
/// Hand-port of `apps/web/src/components/settings/website-widget-card.tsx` and
/// twin of `WebsiteWidgetCard.kt`, and the port is not a copy: the two surfaces
/// answer the same question from different places.
///
/// # A phone is where you DECIDE, not where you install
///
/// Nobody edits their WordPress theme from a phone. What somebody does do from
/// a phone is send the line to whoever looks after the site — so Copy is here
/// and carries its weight, and the three-step instruction stays, because the
/// person receiving that message needs to be told where it goes.
///
/// The routing question is the part that genuinely belongs on a phone. "Which
/// number do website messages land on" is a decision an owner makes while
/// standing in a van, and there is no reason it should require a laptop.
///
/// # Same rules as web
///
/// - The key is fetched only when the card is opened. It is the credential in
///   the markup, not a fact about the workspace, and every member would
///   otherwise carry it from startup.
/// - The picker appears only when there is more than one active line. A menu
///   with one item is a decision that does not exist dressed up as one.
///   *Applying: Zen of Clarity.*
/// - Replacing the key is behind a confirm and says what it costs, because
///   every embed carrying the old one stops working the moment it lands.
///   *Applying: Ethical Friction and Loss Aversion.*
@MainActor
struct WebsiteWidgetCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let numbers: [PhoneNumberSummary]
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @Environment(\.appLocale) private var appLocale

    @State private var open = false
    @State private var key: String?
    @State private var loadFailed = false
    @State private var confirming = false
    @State private var busy = false
    @State private var error: String?

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    /// Only the lines that can actually receive. Offering a suspended or
    /// released number would be an offer to point the website at something that
    /// cannot answer — and the server falls back past it anyway, so the menu
    /// would be showing a choice that silently does not hold.
    private var routable: [PhoneNumberSummary] {
        numbers.filter { $0.status == NumberStatus.active && !(($0.number_e164 ?? "").isEmpty) }
    }

    private var chosen: PhoneNumberSummary? {
        routable.first { $0.id == company.widget_number_id }
    }

    var body: some View {
        SettingsCard(
            title: t("settings.widgetTitle"),
            description: t("settings.widgetBlurb")
        ) {
            if !open {
                Button(t("settings.widgetShow")) {
                    Haptics.tap()
                    open = true
                }
                .buttonStyle(.bordered)
            } else if let snippet = key {
                loaded(widgetSnippet(key: snippet, locale: company.locale))
            } else {
                Text(loadFailed ? t("settings.widgetLoadFailed") : t("settings.widgetLoading"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .task(id: open) {
            guard open, key == nil else { return }
            do {
                key = try await scope.repo.widgetKey(scope.companyId).widget_key
                loadFailed = false
            } catch {
                // Named rather than silent: a card that opens to nothing reads
                // as a broken app, and the person is one tap from trying again.
                loadFailed = true
                self.error = error.userMessage
            }
        }
    }

    @ViewBuilder
    private func loaded(_ markup: String) -> some View {
        Text(t("settings.widgetStepCopy")).font(.footnote)
        Text(t("settings.widgetStepPaste")).font(.footnote)
        Text(t("settings.widgetStepSave")).font(.footnote)

        // Selectable is not the point here — a phone's answer to "I could not
        // copy it" is to try Copy again, not to transcribe a script tag by hand.
        Text(markup)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.top, 6)

        HStack(spacing: 8) {
            Button(t("settings.widgetCopy")) {
                Haptics.tap()
                UIPasteboard.general.string = markup
                scope.showMessage(t("settings.widgetCopied"))
            }
            .buttonStyle(.borderedProminent)

            Button(t("settings.widgetRotate")) {
                Haptics.tap()
                confirming = true
            }
            .buttonStyle(.plain)
            .foregroundStyle(BrandColor.olive)
        }
        .padding(.top, 10)

        if confirming {
            // What they stand to LOSE, stated plainly: the widget on every site
            // carrying the old snippet. *Applying: Loss Aversion.*
            Text(t("settings.widgetRotateWarning"))
                .font(.footnote)
                .padding(.top, 8)
            HStack(spacing: 8) {
                Button(t("settings.widgetRotateConfirm")) {
                    Haptics.reject()
                    rotate()
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(busy)

                Button(t("common.cancel")) { confirming = false }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 6)
        }

        // #232 phase 3: LAST, under the actions. The card exists to get one line
        // of markup somewhere, and a routing question in front of that is a
        // decision demanded before the thing it decides about even works. It
        // must also not sit between the snippet and Copy — web put it there
        // first and the screenshot showed a Copy that looked like it belonged to
        // the picker. *Applying: Prioritise Intent, and Relationship Strength.*
        if routable.count > 1 {
            Divider().padding(.top, 14)
            Text(t("settings.widgetLineLabel"))
                .font(.callout)
                .padding(.top, 12)
            Text(t("settings.widgetLineHelp"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Menu {
                // Named, not blank. "Your first number" is what the server
                // actually does with an unset choice, and a default that does
                // not say what it resolves to is a setting somebody has to test
                // to understand. *Applying: Smart Defaults.*
                Button(t("settings.widgetLineDefault")) { saveLine(nil) }
                ForEach(routable, id: \.id) { number in
                    Button(formatPhone(number.number_e164)) { saveLine(number.id) }
                }
            } label: {
                Text(
                    chosen.map { formatPhone($0.number_e164) }
                        ?? t("settings.widgetLineDefault")
                )
            }
            .disabled(busy)
            .padding(.top, 6)
        }

        if let error {
            Text(error)
                .font(.footnote)
                .foregroundStyle(.red)
                .padding(.top, 8)
        }
    }

    private func rotate() {
        busy = true
        error = nil
        Task {
            do {
                key = try await scope.repo.rotateWidgetKey(scope.companyId).widget_key
                confirming = false
                scope.showMessage(t("settings.widgetRotated"))
            } catch {
                self.error = error.userMessage
            }
            busy = false
        }
    }

    /// Write the choice, or clear it.
    ///
    /// `.null` rather than omitting the key: null is a real value here — it
    /// means "back to the oldest active number" — and a body that simply left
    /// the field out would be a request to change nothing.
    private func saveLine(_ numberId: String?) {
        busy = true
        error = nil
        Task {
            do {
                let patch = JSONValue.object([
                    "widget_number_id": numberId.map { JSONValue.string($0) } ?? .null
                ])
                onCompanyUpdated(try await scope.repo.updateCompany(scope.companyId, patch: patch))
                scope.showMessage(t("settings.widgetLineSaved"))
            } catch {
                self.error = error.userMessage
            }
            busy = false
        }
    }
}

/// The one line an owner pastes into their own website.
///
/// Hand-port of `apps/web/src/lib/marketing/widget-snippet.ts`, INCLUDING the
/// part that looks like superstition: the closing tag is assembled from the tag
/// name rather than written out. Swift has no bundler that would embed this
/// source into a page, so the parser hazard that forced it on web cannot bite
/// here — but the three builders have to produce byte-identical markup, and the
/// cheapest way to keep them identical is to keep them the same shape. A future
/// edit lands on all three or none.
///
/// The origin is the constant the push deep links already use: whatever host
/// this build talks to is the host serving widget.js.
func widgetSnippet(key: String, locale: String? = nil) -> String {
    let tag = "script"
    // #228: the WORKSPACE's language, so a visitor reading the business's own
    // site gets the business's own language. widget.js is served raw to a
    // third-party page with no way to ask us anything before it paints, so this
    // has to arrive as an attribute. Emitted only for a non-default locale — an
    // English workspace's snippet stays the one line it always was.
    let lang = (locale != nil && locale != MessageLocale.en)
        ? " data-lang=\"\(locale!)\""
        : ""
    return "<\(tag) src=\"\(PushLink.appOrigin)/widget.js\" data-key=\"\(key)\"\(lang) defer></\(tag)>"
}
