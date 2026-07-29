import SwiftUI

/// #402 — the dates the weekly schedule cannot know about.
///
/// Christmas Day falls on a Thursday. The schedule says Thursday 08:00–17:00,
/// so the product believed the shop was open and a homeowner with a burst pipe
/// got silence. An auto-reply matters MORE on a holiday than on an ordinary
/// evening: at 9pm on a Tuesday the customer knows why nobody replied, but on
/// Christmas Day silence is ambiguous, and they resolve that by calling
/// somebody else.
///
/// Sits directly under the weekly hours it overrides — these dates only mean
/// anything as an exception to that schedule, and an owner looking for "we're
/// shut on Boxing Day" looks where they set their hours.
///
/// Same copy as web and Android, deliberately: a rule worded three ways is
/// three rules.
@MainActor
struct ClosedDatesCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?
    @State private var from = ""
    @State private var to = ""
    @State private var note = ""

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }
    private var existing: [HoursException] { company.business_hours_exceptions }

    var body: some View {
        SettingsCard(
            title: "Closed dates",
            description: "Holidays, a week off, a day for a funeral. On these dates your "
                + "away reply goes out even if the weekly schedule says you're open — so a "
                + "customer texting on Christmas morning hears something back instead of "
                + "nothing."
        ) {
            if existing.isEmpty {
                Text("No closed dates yet. Your weekly hours apply every week.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(existing.enumerated()), id: \.offset) { pair in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(closedDatesLabel(pair.element))
                                .font(.callout)
                            if let note = pair.element.note, !note.isBlank {
                                Text(note)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if canEdit {
                            Button("Remove") { remove(at: pair.offset) }
                                .font(.footnote)
                                .disabled(saving)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            if canEdit {
                Spacer().frame(height: 10)
                HStack(spacing: 8) {
                    DateField(label: "First day", value: $from, enabled: !saving)
                    // Empty means one day, which is what most of these are.
                    DateField(label: "Last day", value: $to, enabled: !saving)
                }
                Spacer().frame(height: 8)
                TextField("Closed for the holiday, back Monday", text: $note)
                    .textFieldStyle(.roundedBorder)
                    .disabled(saving)
                    .onChange(of: note) { _, value in
                        if value.count > 200 { note = String(value.prefix(200)) }
                    }
                Spacer().frame(height: 10)
                Button(saving ? "Saving…" : "Add closed date") { add() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(saving)
            } else {
                Spacer().frame(height: 4)
                ReadOnlyLine("Only owners and admins can change closed dates.")
            }

            InlineError(error)
        }
    }

    private func add() {
        let start = from.trimmingCharacters(in: .whitespaces)
        // Only the first box filled means one day. Making somebody type the
        // same date twice is busywork on the common case.
        let trimmedTo = to.trimmingCharacters(in: .whitespaces)
        let end = trimmedTo.isEmpty ? start : trimmedTo
        if start.isEmpty {
            error = "Pick the date you're closed."
            return
        }
        if end < start {
            error = "The last day can't be before the first day."
            return
        }
        let trimmedNote = note.trimmingCharacters(in: .whitespaces)
        let entry = HoursException(
            from: start,
            to: end,
            // Closed all day. The weekly schedule already handles the shape of
            // an ordinary short day.
            hours: nil,
            note: trimmedNote.isEmpty ? nil : trimmedNote
        )
        commit(existing + [entry], message: "Closed date added.") {
            from = ""
            to = ""
            note = ""
        }
    }

    private func remove(at index: Int) {
        var next = existing
        guard next.indices.contains(index) else { return }
        next.remove(at: index)
        commit(next, message: "Closed date removed.") {}
    }

    private func commit(
        _ next: [HoursException],
        message: String,
        onDone: @escaping @MainActor () -> Void
    ) {
        error = nil
        saving = true
        let payload = JSONValue.array(
            next.map { entry in
                var fields: [String: JSONValue] = [
                    "from": .string(entry.from),
                    "to": .string(entry.to),
                    "hours": .null,
                ]
                if let note = entry.note, !note.isBlank {
                    fields["note"] = .string(note)
                }
                return .object(fields)
            }
        )
        let body = JSONValue.object(["business_hours_exceptions": payload])
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
                scope.showMessage(message)
                onDone()
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// "2026-12-25" alone, or "2026-12-25 — 2026-12-26" for a range.
func closedDatesLabel(_ entry: HoursException) -> String {
    entry.from == entry.to ? entry.from : "\(entry.from) — \(entry.to)"
}

@MainActor
private struct DateField: View {
    let label: String
    @Binding var value: String
    let enabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            TextField("2026-12-25", text: $value)
                .textFieldStyle(.roundedBorder)
                .disabled(!enabled)
        }
    }
}
