import SwiftUI

/// What the confirm button looks like: red for something that cannot be undone, the
/// ordinary accent for a yes/no that merely commits.
enum ConfirmTone {
    case destructive
    case standard
}

// MARK: - Confirm sheet

/// Shared confirmation surface: calm body copy, optional destructive confirm,
/// inline error, and a pending state that disables both buttons and blocks
/// interactive dismissal. Presented via `.sheet`. Use it where the dialog carries
/// more than a sentence (an extra body, an inline error, a pending state); a plain
/// yes/no is `.confirmDialog(...)` below.
struct ConfirmSheet<Extra: View>: View {
    let title: String
    let message: String
    let confirmLabel: String
    var destructive: Bool = false
    var pending: Bool = false
    var error: String?
    var confirmEnabled: Bool = true
    /// Nil is the catalogue's Cancel. Empty hides the dismiss button entirely, for
    /// the one sheet that must not be closeable by accident: #314 shows recovery
    /// codes exactly once, and somebody who backs out of that screen has armed a
    /// lock and thrown away the spare key. Everywhere else, leave it.
    var dismissLabel: String?
    let onConfirm: @MainActor () -> Void
    let onDismiss: @MainActor () -> Void
    @ViewBuilder let extra: () -> Extra

    @Environment(\.appLocale) private var appLocale

    init(
        title: String,
        message: String,
        confirmLabel: String,
        destructive: Bool = false,
        pending: Bool = false,
        error: String? = nil,
        confirmEnabled: Bool = true,
        dismissLabel: String? = nil,
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

    private var resolvedDismissLabel: String {
        dismissLabel ?? AppStrings.translate(appLocale, "common.cancel")
    }

    var body: some View {
        let dismissText = resolvedDismissLabel
        return VStack(alignment: .leading, spacing: 0) {
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
                if !dismissText.isEmpty {
                    Button(dismissText) { onDismiss() }
                        .buttonStyle(.bordered)
                        .disabled(pending)
                }
                Spacer()
                Button(pending ? AppStrings.translate(appLocale, "common.working") : confirmLabel) {
                    onConfirm()
                }
                .buttonStyle(.borderedProminent)
                .tint(destructive ? BrandColor.destructive : BrandColor.olive)
                .disabled(!confirmEnabled || pending)
            }
            .padding(.top, 16)
        }
        .padding(20)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        // A sheet with no dismiss button must not be swipeable away either, or
        // the hidden button is decoration and the gesture is a silent trap.
        .interactiveDismissDisabled(pending || dismissText.isEmpty)
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
        dismissLabel: String? = nil,
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

// MARK: - Confirm dialog (a plain yes / no)

extension View {
    /// #733: the one "are you sure" for a plain yes / no, the system alert with Cancel
    /// and one confirm button (web: `ConfirmDialog`). `cancelLabel` is only for wording
    /// like "Keep it"; nil is the catalogue's Cancel.
    func confirmDialog(
        _ title: String,
        isPresented: Binding<Bool>,
        message: String,
        confirmLabel: String,
        cancelLabel: String? = nil,
        tone: ConfirmTone = .destructive,
        confirmDisabled: Bool = false,
        onConfirm: @escaping @MainActor () -> Void
    ) -> some View {
        modifier(
            ConfirmDialogModifier(
                title: title,
                isPresented: isPresented,
                message: message,
                confirmLabel: confirmLabel,
                cancelLabel: cancelLabel,
                tone: tone,
                confirmDisabled: confirmDisabled,
                onConfirm: onConfirm
            )
        )
    }

    /// The same dialog for a yes / no about one record: it shows while `item` holds
    /// one, and `onConfirm` receives it.
    func confirmDialog<Item>(
        _ title: String,
        item: Binding<Item?>,
        message: @escaping (Item) -> String,
        confirmLabel: String,
        cancelLabel: String? = nil,
        tone: ConfirmTone = .destructive,
        onConfirm: @escaping @MainActor (Item) -> Void
    ) -> some View {
        modifier(
            ConfirmItemDialogModifier(
                title: title,
                item: item,
                messageFor: message,
                confirmLabel: confirmLabel,
                cancelLabel: cancelLabel,
                tone: tone,
                onConfirm: onConfirm
            )
        )
    }
}

private struct ConfirmDialogModifier: ViewModifier {
    let title: String
    let isPresented: Binding<Bool>
    let message: String
    let confirmLabel: String
    let cancelLabel: String?
    let tone: ConfirmTone
    let confirmDisabled: Bool
    let onConfirm: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    private var role: ButtonRole? {
        tone == .destructive ? ButtonRole.destructive : nil
    }

    func body(content: Content) -> some View {
        content.alert(title, isPresented: isPresented) {
            Button(
                cancelLabel ?? AppStrings.translate(appLocale, "common.cancel"),
                role: .cancel
            ) {}
            Button(confirmLabel, role: role) { onConfirm() }
                .disabled(confirmDisabled)
        } message: {
            Text(message)
        }
    }
}

private struct ConfirmItemDialogModifier<Item>: ViewModifier {
    let title: String
    let item: Binding<Item?>
    /// The caller's sentence for this item, already in the reader's language.
    let messageFor: (Item) -> String
    let confirmLabel: String
    let cancelLabel: String?
    let tone: ConfirmTone
    let onConfirm: @MainActor (Item) -> Void

    @Environment(\.appLocale) private var appLocale

    private var role: ButtonRole? {
        tone == .destructive ? ButtonRole.destructive : nil
    }

    private var shown: Binding<Bool> {
        Binding(
            get: { item.wrappedValue != nil },
            set: { if !$0 { item.wrappedValue = nil } }
        )
    }

    func body(content: Content) -> some View {
        content.alert(title, isPresented: shown, presenting: item.wrappedValue) { data in
            Button(
                cancelLabel ?? AppStrings.translate(appLocale, "common.cancel"),
                role: .cancel
            ) {}
            Button(confirmLabel, role: role) { onConfirm(data) }
        } message: { data in
            Text(messageFor(data))
        }
    }
}
