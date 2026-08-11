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

    /// #513: the filter the SEARCH uses, as opposed to the one the list uses.
    /// Below two digits there is nothing to narrow and the API refuses it.
    private var searchDigits: String? {
        digitFilter.count >= 2 ? digitFilter : nil
    }
    @State private var bestEffort = false
    @State private var state: LoadState<AvailableNumbersResult> = .loading
    @State private var fetchKey = 0

    @Environment(\.appLocale) private var appLocale

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
                    TextField(AppStrings.translate(appLocale, "settingsMore.areaCode"), text: Binding(
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
                    TextField(AppStrings.translate(appLocale, "settingsMore.containsDigits"), text: Binding(
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
                            Button(AppStrings.translate(appLocale, "common.retry")) {
                                fetchKey += 1
                            }
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
                    Button(AppStrings.translate(appLocale, "common.cancel")) { onDismiss() }
                        .disabled(pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
        // #513: the digits are part of the SEARCH, not only of the list below.
        // Keyed on the filter, so a fresh batch honours it — Refresh used to
        // hand back another twenty numbers chosen without reference to what had
        // been typed. Two digits is the floor: one narrows nothing and the API
        // refuses it.
        .task(
            id: "\(effectiveAreaCode ?? "")|\(bestEffort)|\(searchDigits ?? "")|\(fetchKey)"
        ) {
            // A keystroke replaces the task, so this settles rather than firing
            // a request per character. The list below still narrows instantly
            // in the meantime, which is what makes the wait invisible.
            if searchDigits != nil {
                try? await Task.sleep(nanoseconds: 400_000_000)
                if Task.isCancelled { return }
            }
            state = .loading
            do {
                state = .ready(
                    try await scope.repo.availableNumbers(
                        country: country,
                        areaCode: effectiveAreaCode,
                        bestEffort: bestEffort,
                        contains: searchDigits
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
                AppStrings.translate(
                    appLocale,
                    "settingsMore.maskedPick",
                    [
                        "where": effectiveAreaCode.map {
                            AppStrings.translate(
                                appLocale,
                                "settingsMore.inAreaCode",
                                ["areaCode": $0]
                            )
                        } ?? ""
                    ]
                )
            )
            .font(.callout)
            if let code = effectiveAreaCode {
                Button(
                    pending
                        ? AppStrings.translate(appLocale, "settingsMore.ordering")
                        : AppStrings.translate(
                            appLocale,
                            "settingsMore.useAreaCode",
                            ["areaCode": code]
                        )
                ) {
                    onPick(.areaCode(code))
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
                .disabled(pending)
                .padding(.top, 10)
            } else {
                Text(AppStrings.translate(appLocale, "settingsMore.enterAreaCode"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }
        } else if result.best_effort_exhausted && !bestEffort {
            Text(
                AppStrings.translate(
                    appLocale,
                    "settingsMore.noNumbersIn",
                    [
                        "areaCode": effectiveAreaCode
                            ?? AppStrings.translate(appLocale, "settingsMore.thatAreaCode")
                    ]
                )
            )
            .font(.callout)
            Button(AppStrings.translate(appLocale, "settingsMore.showNearby")) {
                bestEffort = true
            }
                .buttonStyle(.bordered)
                .disabled(pending)
                .padding(.top, 8)
        } else {
            let filtered = result.data.filter { matchesDigitFilter(e164: $0.phone_number, filter: digitFilter) }
            if filtered.isEmpty {
                Text(
                    digitFilter.isEmpty
                        ? AppStrings.translate(appLocale, "settingsMore.noNumbersBack")
                        : AppStrings.translate(
                            appLocale,
                            "settingsMore.noNumberContains",
                            ["digits": digitFilter]
                        )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
                Button(AppStrings.translate(appLocale, "settingsMore.refresh")) {
                    fetchKey += 1
                }
                    .buttonStyle(.bordered)
                    .disabled(pending)
                    .padding(.top, 8)
            } else {
                if bestEffort {
                    Text(AppStrings.translate(appLocale, "settingsMore.showingNearby"))
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
                Button(AppStrings.translate(appLocale, "settingsMore.refreshList")) {
                    fetchKey += 1
                }
                    .font(.subheadline)
                    .buttonStyle(.borderless)
                    .disabled(pending)
                    .padding(.top, 8)
            }
        }
    }
}
