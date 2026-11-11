import SwiftUI

/// #733: the one place a transient notice gets its shape (web: `undoableToast` in
/// `optimistic-undo.tsx` and `createdToast` in `created-toast.ts`).
///
/// Three shapes, and each screen picks one rather than building its own:
///
/// - **Undo**: a change the product can put back. One Undo action, held for
///   `undoSeconds`. `Toast.undoable`.
/// - **Open**: something created somewhere else. One Open action, held as long as an
///   Undo would be. `Toast.created`, and `.createdAlert` where the confirmation is an
///   alert over a sheet rather than a toast.
/// - **Plain**: success or error with nothing to take back. `plainSeconds`.
///
/// A delete the product cannot put back asks first through `ConfirmDialog` and then
/// reports with a plain notice.
///
/// `undoSeconds` is ten, not web's five, on purpose: a phone undo follows a gesture that
/// can be made by accident, and `docs/UNDO-AUDIT.md` records the difference.
enum Toast {
    static let undoSeconds: Double = 10
    static let plainSeconds: Double = 3

    /// How long a notice stays up: longer when it carries an action.
    static func seconds(undoable: Bool) -> Double {
        undoable ? undoSeconds : plainSeconds
    }

    static func undoLabel(_ locale: String?) -> String {
        AppStrings.translate(locale, "thread.undo")
    }

    static func openLabel(_ locale: String?) -> String {
        AppStrings.translate(locale, "common.open")
    }

    /// The notice for a change the product can put back. `trashLabel` adds the "View
    /// Trash" action to a delete.
    static func undoable(
        id: Int64,
        text: String,
        locale: String?,
        trashLabel: String? = nil,
        undo: @escaping @MainActor () -> Void
    ) -> ThreadNotice {
        ThreadNotice(
            id: id,
            text: text,
            actionLabel: undoLabel(locale),
            action: undo,
            trashLabel: trashLabel
        )
    }

    /// The notice for something made elsewhere, with a way to it.
    static func created(
        id: Int64,
        text: String,
        locale: String?,
        open: @escaping @MainActor () -> Void
    ) -> ThreadNotice {
        ThreadNotice(
            id: id,
            text: text,
            actionLabel: openLabel(locale),
            action: open
        )
    }
}

extension ThreadNotice {
    /// How long this notice stays up.
    var seconds: Double { Toast.seconds(undoable: actionLabel != nil) }
}

/// One-line transient notice with an optional action and a "View Trash" link: the
/// Android snackbar's calm iOS stand-in. Every screen that shows a `ThreadNotice` draws
/// it with this.
struct ToastView: View {
    let notice: ThreadNotice
    let onDismiss: @MainActor () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Text(notice.text)
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.ink)
                .lineLimit(2)
            if let label = notice.actionLabel {
                Button(label) {
                    notice.action?()
                    onDismiss()
                }
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
            }
            // #710: a delete notice also leads to the Trash.
            if let trashLabel = notice.trashLabel {
                Button(trashLabel) {
                    AppRouter.shared.openTrash = true
                    onDismiss()
                }
                .font(.golos(12.5, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: Capsule())
        .padding(.horizontal, 24)
        .onTapGesture { onDismiss() }
    }
}

/// The confirmation that a task was made, as an alert over the sheet that made it, with
/// Open when the task can be opened from here.
private struct CreatedAlert: ViewModifier {
    @Binding var notice: String?
    @Binding var openTaskId: String?
    @Environment(\.appLocale) private var appLocale

    func body(content: Content) -> some View {
        content.alert(
            notice ?? "",
            isPresented: Binding(
                get: { notice != nil },
                set: { if !$0 { notice = nil } }
            )
        ) {
            if let taskId = openTaskId {
                Button(Toast.openLabel(appLocale)) {
                    notice = nil
                    openTaskId = nil
                    AppRouter.shared.openTaskId = taskId
                }
            }
            Button(AppStrings.translate(appLocale, "common.close"), role: .cancel) {
                notice = nil
                openTaskId = nil
            }
        }
    }
}

extension View {
    /// The Open shape for a confirmation that is an alert: the one place it is drawn.
    func createdAlert(notice: Binding<String?>, openTaskId: Binding<String?>) -> some View {
        modifier(CreatedAlert(notice: notice, openTaskId: openTaskId))
    }
}
