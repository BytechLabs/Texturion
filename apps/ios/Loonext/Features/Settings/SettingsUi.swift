import SwiftUI
import UIKit

/// Shared settings primitives (#163): hairline-bordered cards (never shadows),
/// calm status pills, the confirm sheet, and the external-browser opener the
/// billing surfaces require (App Store rules: hosted Stripe pages open in the
/// REAL browser via UIApplication.open, never a webview or SFSafariViewController).

// MARK: - Card

struct SettingsCard<Content: View>: View {
    let title: String
    var description: String?
    @ViewBuilder let content: () -> Content

    init(title: String, description: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.description = description
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.golos(15, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            if let description {
                Text(description)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .padding(.top, 2)
            }
            Spacer().frame(height: 12)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }
}

/// Honest read-only line for members ("Only owners and admins can…").
struct ReadOnlyLine: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted600)
    }
}

/// Calm one-sentence inline error under a form control.
struct InlineError: View {
    let message: String?

    init(_ message: String?) {
        self.message = message
    }

    var body: some View {
        if let message {
            Text(message)
                .font(.golos(12))
                .foregroundStyle(BrandColor.destructive)
                .padding(.top, 6)
        }
    }
}

// MARK: - Toggle row

struct LabeledToggleRow: View {
    let label: String
    var supporting: String?
    let isOn: Bool
    var enabled: Bool = true
    let onChange: @MainActor (Bool) -> Void

    var body: some View {
        Toggle(isOn: Binding(get: { isOn }, set: { onChange($0) })) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                if let supporting {
                    Text(supporting)
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted500)
                }
            }
        }
        .tint(BrandColor.olive)
        .disabled(!enabled)
        .padding(.vertical, 4)
    }
}

// MARK: - Status pill

enum PillTone {
    case positive
    case warn
    case bad
    case neutral
}

/// Flat status pill: tinted background, no elevation (hairline system).
struct StatusPill: View {
    let label: String
    let tone: PillTone

    private var background: Color {
        switch tone {
        case .positive: BrandColor.limeChip
        case .warn: BrandColor.amberBg
        case .bad: BrandColor.destructiveContainer
        case .neutral: BrandColor.inset
        }
    }

    private var foreground: Color {
        switch tone {
        case .positive: BrandColor.onLimeChip
        case .warn: BrandColor.overdueAmber
        case .bad: BrandColor.destructive
        case .neutral: BrandColor.muted600
        }
    }

    var body: some View {
        Text(label)
            .font(.golos(10, weight: .bold))
            .lineLimit(1)
            .foregroundStyle(foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(background, in: Capsule())
    }
}

// MARK: - Confirm sheet

/// Shared confirmation surface: calm body copy, optional destructive confirm,
/// inline error, and a pending state that disables both buttons and blocks
/// interactive dismissal. Presented via `.sheet`.
struct ConfirmSheet<Extra: View>: View {
    let title: String
    let message: String
    let confirmLabel: String
    var destructive: Bool = false
    var pending: Bool = false
    var error: String?
    var confirmEnabled: Bool = true
    var dismissLabel: String = "Cancel"
    let onConfirm: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void
    @ViewBuilder let extra: () -> Extra

    init(
        title: String,
        message: String,
        confirmLabel: String,
        destructive: Bool = false,
        pending: Bool = false,
        error: String? = nil,
        confirmEnabled: Bool = true,
        dismissLabel: String = "Cancel",
        onConfirm: @escaping @MainActor () -> Void,
        onDismiss: @escaping @MainActor () -> Void,
        @ViewBuilder extra: @escaping () -> Extra
    ) {
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
        self.destructive = destructive
        self.pending = pending
        self.error = error
        self.confirmEnabled = confirmEnabled
        self.dismissLabel = dismissLabel
        self.onConfirm = onConfirm
        self.onDismiss = onDismiss
        self.extra = extra
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.golos(17, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(message)
                        .font(.body)
                        .padding(.top, 8)
                    extra()
                    InlineError(error)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack {
                Button(dismissLabel) { onDismiss() }
                    .buttonStyle(.bordered)
                    .disabled(pending)
                Spacer()
                Button(pending ? "Working…" : confirmLabel) { onConfirm() }
                    .buttonStyle(.borderedProminent)
                    .tint(destructive ? BrandColor.destructive : BrandColor.olive)
                    .disabled(!confirmEnabled || pending)
            }
            .padding(.top, 16)
        }
        .padding(20)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(pending)
    }
}

extension ConfirmSheet where Extra == EmptyView {
    init(
        title: String,
        message: String,
        confirmLabel: String,
        destructive: Bool = false,
        pending: Bool = false,
        error: String? = nil,
        confirmEnabled: Bool = true,
        dismissLabel: String = "Cancel",
        onConfirm: @escaping @MainActor () -> Void,
        onDismiss: @escaping @MainActor () -> Void
    ) {
        self.init(
            title: title,
            message: message,
            confirmLabel: confirmLabel,
            destructive: destructive,
            pending: pending,
            error: error,
            confirmEnabled: confirmEnabled,
            dismissLabel: dismissLabel,
            onConfirm: onConfirm,
            onDismiss: onDismiss,
            extra: { EmptyView() }
        )
    }
}

// MARK: - Message bubble preview

/// A quiet message-bubble preview: exactly what the customer receives.
struct PreviewBubble: View {
    let label: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.golos(10.5, weight: .bold))
                .kerning(1.0)
                .foregroundStyle(BrandColor.muted500)
            Text(text)
                .font(.golos(13))
                .foregroundStyle(BrandColor.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .padding(.top, 10)
    }
}

// MARK: - System glue

/// Hosted Stripe pages and the fair-use policy open in the user's REAL
/// browser: App Store rules treat an embedded webview around an external
/// payment page as a violation, and an in-app Safari sheet is not sufficient.
@MainActor
func openExternal(_ url: String) {
    guard let parsed = URL(string: url) else { return }
    UIApplication.shared.open(parsed)
}

@MainActor
func copyToClipboard(_ text: String) {
    UIPasteboard.general.string = text
}
