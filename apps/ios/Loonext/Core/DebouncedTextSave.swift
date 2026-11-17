import Foundation

@MainActor
final class DebouncedTextSave {
    private struct Edit {
        let value: String
        let save: @MainActor (String) async -> Bool
    }

    private var saved: String
    private var pending: Edit?
    private var timer: Task<Void, Never>?
    private var saving = false

    init(_ initial: String) {
        saved = initial.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func schedule(_ draft: String, save: @escaping @MainActor (String) async -> Bool) {
        pending = Edit(value: draft.trimmingCharacters(in: .whitespacesAndNewlines), save: save)
        timer?.cancel()
        timer = Task {
            do {
                try await Task.sleep(for: .milliseconds(800))
            } catch {
                return
            }
            flush()
        }
    }

    func flush() {
        timer?.cancel()
        timer = nil
        guard !saving, let pending else { return }
        self.pending = nil
        guard pending.value != saved else { return }

        saving = true
        Task {
            if await pending.save(pending.value) {
                saved = pending.value
            }
            saving = false
            if timer == nil {
                flush()
            }
        }
    }
}
