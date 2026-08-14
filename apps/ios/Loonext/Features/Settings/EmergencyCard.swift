import SwiftUI

/// #460 — the emergency words and reply, in the owner's hands.
///
/// The shipped defaults told every customer of every workspace to reply URGENT
/// "for a no-heat or burst-pipe emergency", and answered them with a sentence
/// about smelling gas and calling the utility. Landscapers, locksmiths and
/// mobile mechanics all sent that. Now the words and the reply are theirs.
///
/// WHY THIS IS ITS OWN CARD rather than three more rows on the away card: that
/// one already carries three decisions (reply on/off, the message, and whether
/// an emergency word wakes the crew). Adding the word list and the reply makes
/// five, past what a reader holds at once, and the two halves answer different
/// questions — "what do we say when we're shut" versus "what counts as an
/// emergency and what goes back".
///
/// It sits DIRECTLY beneath the away card and nowhere else, because the away
/// message is the sentence that tells a customer the word. Same copy as web and
/// Android, deliberately: a rule worded three ways is three rules.
@MainActor
struct EmergencyCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var words: [String]
    @State private var draft = ""
    @State private var message: String
    @State private var replyEnabled: Bool
    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    init(
        scope: SettingsScope,
        company: CompanyView,
        onCompanyUpdated: @escaping @MainActor (CompanyView) -> Void
    ) {
        self.scope = scope
        self.company = company
        self.onCompanyUpdated = onCompanyUpdated
        // Seeded from the EFFECTIVE list, never the raw column. An owner who has
        // never opened this screen has a nil column, and an empty box would read
        // as "nothing is watched for" — the opposite of the truth, and the
        // fastest way to make somebody think the feature is broken.
        _words = State(initialValue: company.effectiveEmergencyWords)
        _message = State(initialValue: company.emergency_message ?? "")
        // #553: held locally so the switch moves on the tap rather than a round
        // trip later.
        _replyEnabled = State(initialValue: company.emergency_reply_enabled)
    }

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    /// The sentence no setting removes, in the reader's language — resolved
    /// here rather than held as a constant, exactly as `EmergencyCard.kt` does.
    private var safetyLine: String { t(emergencySafetyLineKey) }

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var savedWords: [String] { company.effectiveEmergencyWords }
    private var trimmedMessage: String {
        message.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var dirty: Bool {
        words != savedWords
            || trimmedMessage
                != (company.emergency_message ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The composed preview: the owner's body (or the product default) followed
    /// by the sentence no setting removes. The server's composed message is the
    /// truth whenever nothing is unsaved, which is why it shows when empty.
    private var preview: String {
        let body = trimmedMessage.isEmpty
            ? company.emergency_effective_message
            : trimmedMessage
        return body.contains(safetyLine)
            ? body
            : "\(body) \(safetyLine)"
    }

    var body: some View {
        SettingsCard(
            title: t("settings.emergencyTitle"),
            description: t("settings.emergencyIntro")
        ) {
            Text(t("settings.emergencyWordsHeading"))
                .font(.callout)
            Text(t("settings.emergencyWordsHelp"))
                .font(.footnote)
                .foregroundStyle(.secondary)

            Spacer().frame(height: 8)
            // The word IS the content, so it stays legible and the remove
            // affordance rides beside it rather than replacing it.
            WrappingWords(words: words, canEdit: canEdit && !saving, onRemove: remove)

            if canEdit {
                Spacer().frame(height: 8)
                HStack(spacing: 8) {
                    TextField(t("settings.emergencyAddWordPlaceholder"), text: $draft)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.characters)
                        .disabled(saving)
                        .onChange(of: draft) { _, value in
                            if value.count > 15 { draft = String(value.prefix(15)) }
                        }
                    Button(t("settings.emergencyAddWordAction")) { add() }
                        .disabled(saving)
                }
            }
            if !company.emergency_keywords_are_custom {
                Text(t("settings.emergencyDefaults"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer().frame(height: 16)
            Text(t("settings.emergencyReplyHeading"))
                .font(.callout)
            // #553: the switch lives NEXT TO the thing it governs.
            //
            // It always existed, but under Hours — a screen away from the words and
            // the message it controls — so the founder reported the reply as
            // "enforced". A setting nobody can find is not a setting.
            //
            // And it is now a DIFFERENT switch. `emergency_keyword_enabled` used to
            // gate four things at once, so the only way to stop us texting on the
            // crew's behalf was to stop the product noticing emergencies. Turning
            // this one off keeps the crew escalation, the push and the inbox flag,
            // and withholds only the message.
            Toggle(t("settings.emergencyTextBack"), isOn: $replyEnabled)
                .font(.callout)
                .disabled(!canEdit || saving)
                .onChange(of: replyEnabled) { _, next in saveReplyEnabled(next) }
                .padding(.top, 4)
            Text(t("settings.emergencyTextBackHelp"))
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer().frame(height: 6)
            Text(t("settings.emergencyReplyHelp"))
                .font(.footnote)
                .foregroundStyle(.secondary)

            Spacer().frame(height: 6)
            TextField(
                company.emergency_effective_message,
                text: $message,
                axis: .vertical
            )
            .lineLimit(3...6)
            .textFieldStyle(.roundedBorder)
            .disabled(!canEdit || saving)
            .onChange(of: message) { _, value in
                if value.count > 1000 { message = String(value.prefix(1000)) }
            }
            Text(
                t(
                    company.emergency_message_is_custom
                        ? "settings.emergencyCount"
                        : "settings.emergencyCountDefault",
                    ["count": String(message.count)]
                )
            )
            .font(.caption2)
            .foregroundStyle(.secondary)

            // The honest part of this screen. An owner editing the body needs to
            // see that one sentence follows it whatever they write — otherwise
            // they will believe they removed it, and find out from a customer.
            Spacer().frame(height: 12)
            PreviewBubble(label: t("settings.emergencyPreviewLabel"), text: preview)
            Text(t("settings.emergencySafetyLineNote", ["line": safetyLine]))
                .font(.caption2)
                .foregroundStyle(.secondary)

            InlineError(error)

            if canEdit {
                if dirty {
                    Spacer().frame(height: 10)
                    Button(
                        saving ? t("common.saving") : t("settings.emergencySaveAction")
                    ) { save() }
                        .buttonStyle(.borderedProminent)
                        .tint(BrandColor.olive)
                        .disabled(saving)
                }
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine(t("settings.emergencyReadOnly"))
            }
        }
    }

    private func add() {
        let raw = draft.trimmingCharacters(in: .whitespaces)
        if let problem = emergencyKeywordError(raw, locale: appLocale) {
            error = problem
            return
        }
        let word = raw.uppercased()
        if words.contains(word) {
            error = t("settings.emergencyDuplicateWord", ["word": word])
            return
        }
        if words.count >= 10 {
            error = t("settings.emergencyTooManyWords")
            return
        }
        error = nil
        words.append(word)
        draft = ""
    }

    private func remove(_ word: String) {
        // Never down to zero. An empty list is not "no emergencies" — the switch
        // on the away card says that, honestly and reversibly. Watching for
        // nothing while the switch reads ON is the #414 defect.
        if words.count == 1 {
            error = t("settings.emergencyKeepOneWord")
            return
        }
        error = nil
        words.removeAll { $0 == word }
    }

    /// #553: saved on the tap, not behind the card's Save button.
    ///
    /// The words and the message are a draft somebody composes and commits. This is
    /// a switch, and a switch that needs a separate Save is a switch people believe
    /// they have already thrown. On failure it goes back to what the server has, so
    /// the control never shows a state the account is not in.
    private func saveReplyEnabled(_ next: Bool) {
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["emergency_reply_enabled": .bool(next)])
                )
                onCompanyUpdated(updated)
            } catch {
                replyEnabled = !next
                self.error = error.userMessage
            }
        }
    }

    private func save() {
        error = nil
        saving = true
        var fields: [String: JSONValue] = [:]
        // Only send the list when it is genuinely the owner's. Echoing the
        // product defaults back would FREEZE them on this workspace, so
        // improving them later would never reach it.
        if words != savedWords || company.emergency_keywords_are_custom {
            fields["emergency_keywords"] = .array(words.map { .string($0) })
        }
        fields["emergency_message"] =
            trimmedMessage.isEmpty ? .null : .string(trimmedMessage)
        let body = JSONValue.object(fields)
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                scope.showMessage(t("settings.emergencySaved"))
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// The one sentence appended to every emergency reply, mirroring
/// `EMERGENCY_SAFETY_LINE` in shared. Read from the catalogue because this
/// screen has to PREVIEW the composed message while the owner is still typing —
/// the server's composed value is a round trip behind.
///
/// BOTH LANGUAGES ARE THE SERVER'S OWN, copied character for character from
/// `packages/shared/src/locale.ts`. This is the one sentence in the product
/// with a SAFETY property: everything else degrades to "the reader gets
/// English" when a translation is missing, and this would degrade to somebody
/// in danger being told what to do in a language they may not read. A prettier
/// French written here would preview a sentence the server never sends, which
/// is the same failure with better spelling. 911 is the number in Canada and
/// the US alike, so it is as region-neutral in French as it is in English.
let emergencySafetyLineKey = "settings.emergencySafetyLine"

/// The keyword chips, wrapped.
///
/// `Layout`-free on purpose: a handful of short words never needs a custom
/// layout pass, and `LazyVGrid` with adaptive columns would give every chip the
/// same width — which for words of very different lengths reads as a table
/// rather than as a list of words.
@MainActor
private struct WrappingWords: View {
    let words: [String]
    let canEdit: Bool
    let onRemove: (String) -> Void

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        FlexibleRows(items: words) { word in
            Button {
                if canEdit { onRemove(word) }
            } label: {
                Text(canEdit ? t("settings.emergencyWordChip", ["word": word]) : word)
                    .font(.system(.footnote, design: .monospaced))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    // `insetDeep`, not `paper`: this chip sits ON a card, and
                    // a paper chip on a paper card is invisible in both themes.
                    // The inset ladder is what the palette provides for a well
                    // sitting inside a raised surface.
                    .background(BrandColor.insetDeep, in: Capsule())
                    .foregroundStyle(BrandColor.ink)
            }
            .buttonStyle(.plain)
            .disabled(!canEdit)
            .accessibilityLabel(
                canEdit ? t("settings.emergencyRemoveWordLabel", ["word": word]) : word
            )
        }
    }
}

/// Rows that wrap, built by chunking rather than measuring.
///
/// Four words per row at the shortest phone width, which every keyword fits
/// inside because the column refuses anything over 15 characters. Chunking is
/// exact where measurement would be approximate, and the bound is enforced by
/// the database rather than hoped for here.
@MainActor
private struct FlexibleRows<Item: Hashable, Content: View>: View {
    let items: [Item]
    @ViewBuilder let content: (Item) -> Content

    private var rows: [[Item]] {
        stride(from: 0, to: items.count, by: 3).map { start in
            Array(items[start..<min(start + 3, items.count)])
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(rows.enumerated()), id: \.offset) { row in
                HStack(spacing: 6) {
                    ForEach(row.element, id: \.self) { content($0) }
                    Spacer(minLength: 0)
                }
            }
        }
    }
}
