import SwiftUI

/// What the picker hands back: a US exact number, or a CA/masked area code.
enum NumberChoice {
    case exact(String)
    case areaCode(String)
}

func isValidAreaCode(_ code: String) -> Bool {
    code.range(of: "^[2-9]\\d{2}$", options: .regularExpression) != nil
}

/// The choose-your-number picker (#163) over GET /v1/available-numbers: live
/// Telnyx inventory with an area-code filter, a client-side digit filter,
/// the masked-CA path (the pick becomes an area code assigned at order time),
/// and the honest "show nearby numbers" widen prompt when a code is exhausted.
///
/// The caller performs the actual order (provision or remediate) — `pending`
/// and `error` surface that request's state inside the sheet.
@MainActor
struct NumberPickerSheet: View {
    let scope: SettingsScope
    let country: String
    let initialAreaCode: String?
    let title: String
    let pending: Bool
    let error: String?
    let onDismiss: @MainActor () -> Void
    let onPick: @MainActor (NumberChoice) -> Void

    @State private var areaCode: String
    @State private var digitFilter = ""
    @State private var bestEffort = false
    @State private var state: LoadState<AvailableNumbersResult> = .loading
    @State private var fetchKey = 0

    init(
        scope: SettingsScope,
        country: String,
        initialAreaCode: String?,
        title: String,
        pending: Bool,
        error: String?,
        onDismiss: @escaping @MainActor () -> Void,
        onPick: @escaping @MainActor (NumberChoice) -> Void
    ) {
        self.scope = scope
        self.country = country
        self.initialAreaCode = initialAreaCode
        self.title = title
        self.pending = pending
        self.error = error
        self.onDismiss = onDismiss
        self.onPick = onPick
        _areaCode = State(initialValue: initialAreaCode ?? "")
    }

    /// Only a well-formed NANP code goes on the wire; partial input just types.
    private var effectiveAreaCode: String? {
        isValidAreaCode(areaCode) ? areaCode : nil
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    TextField("Area code", text: Binding(
                        get: { areaCode },
                        set: { next in
                            if next.count <= 3 && next.allSatisfy(\.isNumber) {
                                areaCode = next
                                bestEffort = false
                            }
                        }
                    ))
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.numberPad)
                    .frame(width: 110)
                    .disabled(pending)
                    TextField("Contains digits", text: Binding(
                        get: { digitFilter },
                        set: { next in
                            if next.count <= 10 && next.allSatisfy(\.isNumber) {
                                digitFilter = next
                            }
                        }
                    ))
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.numberPad)
                    .disabled(pending)
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        switch state {
                        case .loading:
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 28)
                        case .failed(let message):
                            Text(message)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Button("Try again") { fetchKey += 1 }
                                .buttonStyle(.bordered)
                                .padding(.top, 8)
                        case .ready(let result):
                            pickerResults(result)
                        }
                        InlineError(error)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
                        .disabled(pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
        .task(id: "\(effectiveAreaCode ?? "")|\(bestEffort)|\(fetchKey)") {
            state = .loading
            do {
                state = .ready(
                    try await scope.repo.availableNumbers(
                        country: country,
                        areaCode: effectiveAreaCode,
                        bestEffort: bestEffort
                    )
                )
            } catch {
                state = .failed(error.userMessage)
            }
        }
    }

    // MARK: - Results

    @ViewBuilder
    private func pickerResults(_ result: AvailableNumbersResult) -> some View {
        // CA (masked) inventory: no exact numbers to list — the pick is the code.
        if result.masked {
            Text(
                "Canadian numbers are assigned when the order goes through, so your "
                    + "pick here is the area code. There are numbers available"
                    + (effectiveAreaCode.map { " in \($0)" } ?? "") + "."
            )
            .font(.callout)
            if let code = effectiveAreaCode {
                Button(pending ? "Ordering…" : "Use area code \(code)") {
                    onPick(.areaCode(code))
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
                .disabled(pending)
                .padding(.top, 10)
            } else {
                Text("Enter the 3-digit area code you want above.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }
        } else if result.best_effort_exhausted && !bestEffort {
            Text(
                "No numbers in \(effectiveAreaCode ?? "that area code") right now. "
                    + "Nearby area codes usually have plenty."
            )
            .font(.callout)
            Button("Show nearby numbers") { bestEffort = true }
                .buttonStyle(.bordered)
                .disabled(pending)
                .padding(.top, 8)
        } else {
            let filtered = result.data.filter { matchesDigitFilter(e164: $0.phone_number, filter: digitFilter) }
            if filtered.isEmpty {
                Text(
                    digitFilter.isEmpty
                        ? "No numbers came back. Refresh for a new batch, or try another area code."
                        : "No available number contains \"\(digitFilter)\". Loosen the filter "
                            + "or refresh for a new batch."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
                Button("Refresh") { fetchKey += 1 }
                    .buttonStyle(.bordered)
                    .disabled(pending)
                    .padding(.top, 8)
            } else {
                if bestEffort {
                    Text("Showing nearby numbers — the exact area code is out of stock.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 6)
                }
                ForEach(filtered, id: \.phone_number) { number in
                    Button {
                        onPick(.exact(number.phone_number))
                    } label: {
                        HStack {
                            Text(formatPhone(number.phone_number))
                                .font(.body)
                                .foregroundStyle(Color.primary)
                            Spacer()
                            if let region = number.region {
                                Text(region)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                    .disabled(pending)
                    Divider()
                }
                Button("Refresh the list") { fetchKey += 1 }
                    .font(.subheadline)
                    .buttonStyle(.borderless)
                    .disabled(pending)
                    .padding(.top, 8)
            }
        }
    }
}
