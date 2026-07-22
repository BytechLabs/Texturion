import Observation
import PhotosUI
import SwiftUI
import UIKit

enum ComposerMode: Equatable, Sendable {
    case text
    case note
}

/// Loonext amber — notes/overdue accent (mirrors the Android NoteAmber twin),
/// now aliased onto the Paper & Olive amber tokens so both themes come free.
enum NoteAmber {
    static let bg = BrandColor.amberBg
    static let ink = BrandColor.overdueAmber
    static let line = BrandColor.overdueAmber.opacity(0.35)
}

/// Composer state hoisted out of the UI so the thread controller can restore a
/// failed send. Text persists as a per-conversation client draft (the server
/// keeps none) with a debounced write.
@MainActor
@Observable
final class ComposerState {
    private let draftKey: String
    private let drafts: ComposerDrafts

    private(set) var text = ""
    var mode: ComposerMode = .text
    var photos: [StagedPhoto] = []
    var files: [StagedFile] = []

    @ObservationIgnored private var saveTask: Task<Void, Never>?

    init(draftKey: String, drafts: ComposerDrafts) {
        self.draftKey = draftKey
        self.drafts = drafts
        text = drafts.load(draftKey)
    }

    func onTextChange(_ value: String) {
        text = value
        queueDraftSave()
    }

    private func queueDraftSave() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            if Task.isCancelled { return }
            drafts.save(draftKey, text: text)
        }
    }

    /// Clear immediately on send — fast by feel; the queued row is the UI.
    func clearForSend() {
        text = ""
        photos = []
        files = []
        saveTask?.cancel()
        drafts.clear(draftKey)
    }

    /// Failed send: put the draft back exactly as it was.
    func restore(body: String, photos: [StagedPhoto], files: [StagedFile]) {
        text = body
        self.photos = photos
        self.files = files
        queueDraftSave()
    }
}

/// The messages-style composer pill: Text/Note mode toggle, auto-grow field
/// (1→6 lines then internal scroll), `/` opens saved replies, photo attach
/// (≤3, transcoded ≤1 MB), note files (≤10 × 25 MB), passive segment meter,
/// merge-field live preview. `banner` replaces text mode with an explanatory
/// card — notes stay available; `noteOnly` is the viewer_level='note' gate.
@MainActor
struct ThreadComposerView: View {
    @Bindable var state: ComposerState
    let noteOnly: Bool
    let banner: ComposerBanner?
    let contactName: String?
    let businessName: String?
    let loadTemplates: @MainActor () async throws -> [Template]
    let onSendText: @MainActor (String, [StagedPhoto]) -> Void
    let onSaveNote: @MainActor (String, [StagedFile]) -> Void
    let onNotice: @MainActor (String) -> Void

    @State private var templatePickerOpen = false
    @State private var photosPickerOpen = false
    @State private var fileImporterOpen = false
    @State private var photoSelection: [PhotosPickerItem] = []

    private var textBlocked: Bool { noteOnly || banner != nil }
    private var isNote: Bool { textBlocked || state.mode == .note }

    private var canSend: Bool {
        if isNote {
            return !state.text.isBlank || !state.files.isEmpty
        }
        return !state.text.isBlank || !state.photos.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            if let banner {
                ComposerBannerCard(banner: banner)
            }

            if !textBlocked {
                HStack(spacing: 4) {
                    modePill(
                        label: "Text",
                        selected: state.mode == .text,
                        selectedBg: BrandColor.avatarTint,
                        selectedInk: BrandColor.muted900
                    ) { state.mode = .text }
                    modePill(
                        label: "Note",
                        selected: state.mode == .note,
                        selectedBg: NoteAmber.bg,
                        selectedInk: NoteAmber.ink
                    ) { state.mode = .note }
                    Spacer()
                }
                .padding(.leading, 16)
                .padding(.top, 4)
            }

            if !isNote, !state.photos.isEmpty {
                PhotoChipsRow(photos: state.photos) { id in
                    state.photos.removeAll { $0.id == id }
                }
            }
            if isNote, !state.files.isEmpty {
                FileChipsRow(files: state.files) { id in
                    if let file = state.files.first(where: { $0.id == id }) {
                        Task.detached { discardStagedFile(file) }
                    }
                    state.files.removeAll { $0.id == id }
                }
            }

            composerPill

            if !isNote {
                ComposerHints(
                    text: state.text,
                    hasMedia: !state.photos.isEmpty,
                    contactName: contactName,
                    businessName: businessName
                )
            }
        }
        .photosPicker(
            isPresented: $photosPickerOpen,
            selection: $photoSelection,
            maxSelectionCount: max(1, maxPhotos - state.photos.count),
            matching: .images
        )
        .onChange(of: photoSelection) { _, items in
            guard !items.isEmpty else { return }
            photoSelection = []
            ingestPhotos(items)
        }
        .fileImporter(
            isPresented: $fileImporterOpen,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true
        ) { result in
            stageFiles(result)
        }
        .sheet(isPresented: $templatePickerOpen) {
            TemplatePickerSheet(loadTemplates: loadTemplates) { body in
                templatePickerOpen = false
                insertTemplate(body)
            }
        }
    }

    private var composerPill: some View {
        HStack(alignment: .bottom, spacing: 4) {
            if !isNote {
                Menu {
                    Button {
                        photosPickerOpen = true
                    } label: {
                        Label("Attach a photo", systemImage: "photo")
                    }
                    .disabled(state.photos.count >= maxPhotos)
                    Button {
                        templatePickerOpen = true
                    } label: {
                        Label("Saved reply", systemImage: "text.badge.plus")
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.body.weight(.medium))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Add to message")
            } else {
                Button {
                    fileImporterOpen = true
                } label: {
                    Image(systemName: "paperclip")
                        .font(.body.weight(.medium))
                        .foregroundStyle(NoteAmber.ink)
                        .frame(width: 36, height: 36)
                }
                .disabled(state.files.count >= maxNoteFiles)
                .accessibilityLabel("Attach files to this note")
            }

            TextField(
                isNote ? "Write an internal note…" : "Text message",
                text: Binding(
                    get: { state.text },
                    set: { handleTextChange($0) }
                ),
                axis: .vertical
            )
            .lineLimit(1 ... 6)
            .font(.body)
            .padding(.vertical, 8)

            Button {
                submit()
            } label: {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(
                        canSend
                            ? (isNote ? NoteAmber.bg : BrandColor.onLime)
                            : BrandColor.muted500
                    )
                    .frame(width: 34, height: 34)
                    .background(
                        Circle().fill(
                            canSend
                                ? (isNote ? NoteAmber.ink : BrandColor.lime)
                                : BrandColor.insetDeep
                        )
                    )
            }
            .disabled(!canSend)
            .accessibilityLabel(isNote ? "Save note" : "Send message")
            .padding(.vertical, 3)
        }
        .padding(.horizontal, 6)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(isNote ? NoteAmber.bg : BrandColor.paper)
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(
                            isNote ? NoteAmber.line : BrandColor.insetDeep,
                            lineWidth: 1
                        )
                )
        )
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private func modePill(
        label: String,
        selected: Bool,
        selectedBg: Color,
        selectedInk: Color,
        onTap: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: onTap) {
            Text(label)
                .font(.footnote.weight(.medium))
                .foregroundStyle(selected ? selectedInk : BrandColor.muted500)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(selected ? selectedBg : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func handleTextChange(_ value: String) {
        // "/" in an empty text draft opens saved replies instead.
        if !isNote, state.text.isEmpty, value == "/" {
            templatePickerOpen = true
        } else {
            state.onTextChange(value)
        }
    }

    private func insertTemplate(_ body: String) {
        let current = state.text
        state.onTextChange(
            current.isEmpty
                ? body
                : current + (current.hasSuffix(" ") ? "" : " ") + body
        )
    }

    private func submit() {
        guard canSend else { return }
        let body = state.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if isNote {
            let files = state.files
            state.clearForSend()
            onSaveNote(body, files)
        } else {
            let photos = state.photos
            state.clearForSend()
            onSendText(body, photos)
        }
    }

    private func ingestPhotos(_ items: [PhotosPickerItem]) {
        Task {
            var trimmed = false
            for item in items {
                if state.photos.count >= maxPhotos {
                    trimmed = true
                    break
                }
                guard let data = try? await item.loadTransferable(type: Data.self) else {
                    onNotice("Couldn't read that photo. Try attaching it again.")
                    continue
                }
                let result = await Task.detached(operation: { preparePhoto(data: data) }).value
                switch result {
                case .ready(let photo):
                    state.photos.append(photo)
                case .rejected(let reason):
                    onNotice(reason)
                }
            }
            if trimmed { onNotice("You can attach up to 3 photos per text.") }
        }
    }

    private func stageFiles(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }
        var trimmed = false
        for url in urls {
            if state.files.count >= maxNoteFiles {
                trimmed = true
                break
            }
            switch stageNoteFile(pickedURL: url) {
            case .ready(let file):
                state.files.append(file)
            case .rejected(let reason):
                onNotice(reason)
            }
        }
        if trimmed { onNotice("Notes can carry up to 10 files.") }
    }
}

/// Passive hints under the pill: the segment meter (visible from 2+ parts,
/// amber at 4+, flat 3 for MMS) and the merge-field live preview — the same
/// drop-empty substitution the server applies at send time.
struct ComposerHints: View {
    let text: String
    let hasMedia: Bool
    let contactName: String?
    let businessName: String?

    var body: some View {
        let meter = segmentMeter(text, hasMedia: hasMedia)
        let showPreview = MergeFields.hasMergeFields(text)
        if meter.visible || showPreview {
            VStack(alignment: .leading, spacing: 2) {
                if meter.visible {
                    Text(meter.label)
                        .font(.golos(10.5))
                        .foregroundStyle(meter.warn ? BrandColor.overdueAmber : BrandColor.muted300)
                }
                if showPreview {
                    Text(
                        "Sends as: " + MergeFields.applyMergeFields(
                            text,
                            contactName: contactName,
                            businessName: businessName
                        )
                    )
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted300)
                    .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.bottom, 4)
        }
    }
}

/// Removable photo previews above the pill.
struct PhotoChipsRow: View {
    let photos: [StagedPhoto]
    let onRemove: @MainActor (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(photos) { photo in
                    ZStack(alignment: .topTrailing) {
                        if let image = UIImage(data: photo.bytes) {
                            Image(uiImage: image)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 56, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .strokeBorder(BrandColor.insetDeep, lineWidth: 0.5)
                                )
                        } else {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(BrandColor.inset)
                                .frame(width: 56, height: 56)
                        }
                        Button {
                            onRemove(photo.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(BrandColor.ink, BrandColor.paper)
                        }
                        .accessibilityLabel("Remove photo")
                        .offset(x: 6, y: -6)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
        }
    }
}

/// Removable staged note-file chips.
struct FileChipsRow: View {
    let files: [StagedFile]
    let onRemove: @MainActor (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(files) { file in
                    HStack(spacing: 6) {
                        Text(file.name)
                            .font(.footnote)
                            .lineLimit(1)
                            .frame(maxWidth: 160)
                        Button {
                            onRemove(file.id)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(BrandColor.muted500)
                        }
                        .accessibilityLabel("Remove \(file.name)")
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .strokeBorder(BrandColor.insetDeep, lineWidth: 1)
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }
}

/// Saved-replies picker: search over GET /v1/templates, tap to insert.
@MainActor
struct TemplatePickerSheet: View {
    let loadTemplates: @MainActor () async throws -> [Template]
    let onPick: @MainActor (String) -> Void

    @State private var state: LoadState<[Template]> = .loading
    @State private var query = ""
    @State private var retryKey = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Templates")
                .font(.display(21))
                .foregroundStyle(BrandColor.ink)
            content
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(BrandColor.canvas.ignoresSafeArea())
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task(id: retryKey) {
            state = .loading
            do {
                state = .ready(try await loadTemplates())
            } catch {
                state = .failed(error.userMessage)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            CenteredLoading()
        case .failed(let message):
            CenteredError(message: message) { retryKey += 1 }
        case .ready(let templates):
            if templates.isEmpty {
                Text("No saved replies yet. Create them on the web under Settings.")
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted600)
                    .multilineTextAlignment(.center)
                    .padding(24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else {
                let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
                let matches = templates.filter { template in
                    trimmed.isEmpty ||
                        template.name.localizedCaseInsensitiveContains(trimmed) ||
                        template.body.localizedCaseInsensitiveContains(trimmed)
                }
                searchField
                ScrollView {
                    if matches.isEmpty {
                        Text("Nothing matches.")
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.muted600)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 24)
                    } else {
                        PaperCard {
                            ForEach(matches, id: \.id) { template in
                                Button {
                                    onPick(template.body)
                                } label: {
                                    HStack(alignment: .top, spacing: 11) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(template.name)
                                                .font(.golos(13.5, weight: .bold))
                                                .foregroundStyle(BrandColor.ink)
                                            Text(template.body)
                                                .font(.golos(12))
                                                .foregroundStyle(BrandColor.muted600)
                                                .lineLimit(2)
                                        }
                                        Spacer(minLength: 11)
                                        Text("Insert")
                                            .font(.golos(11, weight: .semibold))
                                            .foregroundStyle(BrandColor.muted900)
                                            .padding(.horizontal, 13)
                                            .padding(.vertical, 7)
                                            .background(Capsule().fill(BrandColor.inset))
                                    }
                                    .padding(.horizontal, 15)
                                    .padding(.vertical, 13)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                if template.id != matches.last?.id {
                                    RowDivider()
                                }
                            }
                        }
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                Text("Type / in the composer to open these inline · shared with the crew")
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted300)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 10)
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(BrandColor.muted300)
            TextField("Search templates", text: $query)
                .font(.golos(13))
                .foregroundStyle(BrandColor.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
        .background(BrandColor.paper, in: Capsule())
        .overlay(Capsule().strokeBorder(BrandColor.insetDeep, lineWidth: 1.5))
    }
}

// MARK: - Previews

#Preview("Composer") {
    VStack {
        Spacer()
        ThreadComposerView(
            state: ComposerState(draftKey: "preview", drafts: ComposerDrafts()),
            noteOnly: false,
            banner: nil,
            contactName: "Dana Whitcomb",
            businessName: "Loonext Fencing",
            loadTemplates: { [] },
            onSendText: { _, _ in },
            onSaveNote: { _, _ in },
            onNotice: { _ in }
        )
    }
}

#Preview("Composer — opted out") {
    VStack {
        Spacer()
        ThreadComposerView(
            state: ComposerState(draftKey: "preview-gated", drafts: ComposerDrafts()),
            noteOnly: false,
            banner: .optedOut,
            contactName: "Dana Whitcomb",
            businessName: "Loonext Fencing",
            loadTemplates: { [] },
            onSendText: { _, _ in },
            onSaveNote: { _, _ in },
            onNotice: { _ in }
        )
    }
}
