import SwiftUI

/// #228 — Settings › Profile: the language THIS PERSON reads the app in.
///
/// ## Why it is not the workspace's language control
///
/// There is already a language card, in Settings › Workspace, and it sets
/// something else entirely: which language the four AUTOMATED TEXTS go out in to
/// CUSTOMERS. Its own copy says so, because an owner reading "language"
/// reasonably expects the app to change language and it does not.
///
/// This is the other half, and the two must not be merged. They have different
/// audiences (the crew, the customers), different permissions (anybody may set
/// their own; only owners and admins set the workspace's) and different scopes
/// (one phone's reader, every customer). A crew in Montreal can have an owner
/// reading French, a tech reading English, and every customer texted in French,
/// and none of those three facts is derivable from the others.
///
/// ## Why "Same as my phone" is a real option and not the absence of one
///
/// `null` is a value the route stores, and it means "ask the device, then the
/// workspace" (`UiLocale.resolve`). Somebody who has never touched this has it,
/// and somebody who chose English and then changed their mind should be able to
/// get BACK to it — otherwise the first tap on this card is irreversible, and a
/// person who later sets their phone to French would be stuck reading English
/// because of a tap they made once.
struct YourLanguageCard: View {
    let scope: SettingsScope

    @State private var saving = false
    @State private var error: String?
    @Environment(\.appLocale) private var appLocale

    /// The member's own setting: one of the two languages, or nil for the phone.
    /// Read off the store rather than off `scope.me`, because the store is what
    /// the whole app is drawing itself from and it updates the instant this card
    /// writes to it — `me` is re-fetched on a schedule of its own.
    private var chosen: String? { UiLocaleStore.shared.userLocale }

    var body: some View {
        SettingsCard(
            title: AppStrings.translate(appLocale, "shell.languageTitle"),
            description: AppStrings.translate(appLocale, "shell.languageDescription")
        ) {
            ForEach(MessageLocale.all, id: \.self) { locale in
                // `MessageLocale.label` names each language in ITSELF and is
                // never translated: somebody looking for French needs to find
                // the word they would recognise, whatever the app is currently
                // drawn in.
                choiceRow(
                    label: MessageLocale.label(locale),
                    selected: chosen == locale,
                    note: nil
                ) {
                    save(locale)
                }
            }
            choiceRow(
                label: AppStrings.translate(appLocale, "shell.languageSameAsPhone"),
                selected: chosen == nil,
                // Says what following the phone actually resolves to right now,
                // so "same as my phone" is not a promise the reader has to test.
                note: AppStrings.translate(
                    appLocale,
                    "shell.languageFollowingDevice",
                    ["language": MessageLocale.label(UiLocaleStore.shared.deviceLocale)]
                )
            ) {
                save(nil)
            }
            Spacer().frame(height: 6)
            // The same caveat the workspace card carries, pointing the other
            // way. Two language settings in one app is exactly the pair somebody
            // changes the wrong one of.
            ReadOnlyLine(AppStrings.translate(appLocale, "shell.languageNotCustomers"))
            InlineError(error)
        }
    }

    /// One radio row — the same grammar as the workspace language card, so the
    /// two read as two instances of one control rather than two controls.
    private func choiceRow(
        label: String,
        selected: Bool,
        note: String?,
        action: @escaping @MainActor () -> Void
    ) -> some View {
        Button {
            guard !selected else { return }
            action()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? BrandColor.olive : Color.secondary)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.body)
                        .foregroundStyle(Color.primary)
                    if let note {
                        Text(note)
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted600)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .disabled(saving)
    }

    /// Applied to the app FIRST, then written.
    ///
    /// The screen turning over as the finger lifts is the whole feedback for
    /// this control, and waiting a round trip for it would make a language
    /// choice feel like a form submission. A failed write puts the previous
    /// answer back, so the app never claims a setting the server does not have.
    private func save(_ locale: String?) {
        let previous = UiLocaleStore.shared.userLocale
        error = nil
        saving = true
        UiLocaleStore.shared.setUserLocale(locale)
        Task {
            do {
                try await scope.graph.meApi.updateLocale(locale)
                // Confirmed in the language just chosen, not the one that was on
                // screen when the tap happened.
                scope.showMessage(
                    AppStrings.translate(
                        UiLocaleStore.shared.resolved,
                        "shell.languageSaved"
                    )
                )
            } catch {
                UiLocaleStore.shared.setUserLocale(previous)
                self.error = error.userMessage
            }
            saving = false
        }
    }
}
