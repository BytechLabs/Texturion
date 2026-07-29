import Observation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

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

    /// Teammates named on a NOTE draft. Ids come from what was picked, never
    /// from re-reading the draft for "@name": display names are neither unique
    /// nor prefix-free, so parsing notifies the wrong people. Deleting a name
    /// from the text still withdraws that mention at send time.
    private(set) var picked: [PickedMention] = []

    @ObservationIgnored private var saveTask: Task<Void, Never>?

    init(draftKey: String, drafts: ComposerDrafts) {
        self.draftKey = draftKey
        self.drafts = drafts
        text = drafts.load(draftKey)
        // The picks ride with the words; restoring one without the other makes
        // the draft lie about who it will notify.
        picked = drafts.loadMentions(draftKey)
    }

    func addMention(_ mention: PickedMention) {
        picked.append(mention)
        queueDraftSave()
    }

    /// #408: when this draft began — the moment the composer first held text.
    ///
    /// Held in memory rather than persisted with the draft, deliberately. A
    /// draft restored after the app was killed has no start moment we can
    /// honestly claim, and the predicate treats nil as "do not warn": a
    /// confirmation we cannot justify is worse than none, because the first
    /// false one teaches people to dismiss the true ones.
    private(set) var draftStartedAt: String?

    func onTextChange(_ value: String) {
        text = value
        if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            draftStartedAt = nil
        } else if draftStartedAt == nil {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            draftStartedAt = formatter.string(from: Date())
        }
        queueDraftSave()
    }

    private func queueDraftSave() {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            if Task.isCancelled { return }
            drafts.save(draftKey, text: text)
            drafts.saveMentions(draftKey, mentions: picked)
        }
    }

    /// Clear immediately on send — fast by feel; the queued row is the UI.
    func clearForSend() {
        text = ""
        // #408: the next draft is a new one, and its warning must be judged
        // against when IT began, not against a moment two sends ago.
        draftStartedAt = nil
        photos = []
        files = []
        picked = []
        saveTask?.cancel()
        drafts.clear(draftKey)
    }

    /// Failed send: put the draft back exactly as it was.
    func restore(
        body: String,
        photos: [StagedPhoto],
        files: [StagedFile],
        picked: [PickedMention] = []
    ) {
        text = body
        self.photos = photos
        self.files = files
        self.picked = picked
        queueDraftSave()
    }
}

/// The messages-style composer pill: Text/Note mode toggle, auto-grow field
/// (1→6 lines then internal scroll), `/` opens saved replies, photo attach
/// (≤3, transcoded ≤1 MB), note files (≤10 × 25 MB), passive segment meter,
/// merge-field live preview. `banner` replaces text mode with an explanatory
/// card — notes stay available; `noteOnly` is the viewer_level='note' gate.
/// #408: everything the send boundary needs to spot a colliding reply.
///
/// ONE parameter rather than three, deliberately. `ThreadComposerView` already
/// takes seven closures, and the Swift type checker has given up on this
/// view's call site before — "failed to produce diagnostic for expression",
/// which is the checker running out of budget rather than a real error. Adding
/// three more arguments is exactly the shape that tipped it. Grouping them
/// costs one struct and keeps the call site the size it was.
struct DuplicateReplyContext {
    /// The newest outbound in this thread. Nil never warns.
    let lastOutbound: Message?
    /// Resolves the sender to a display name — "Sam replied" is a fact
    /// somebody can act on, "someone replied" is not.
    let memberName: @Sendable (String) -> String?
    let meUserId: String
}

@MainActor
struct ThreadComposerView: View {
    @Bindable var state: ComposerState
    let noteOnly: Bool
    let banner: ComposerBanner?
    let contactName: String?
    let businessName: String?
    let loadTemplates: @MainActor () async throws -> [Template]
    let onSendText: @MainActor (String, [StagedPhoto]) -> Void
    let onSaveNote: @MainActor (String, [StagedFile], [String]) -> Void
    /// Who may be named on a note here. Nil withholds mentions entirely rather
    /// than opening a picker with nothing behind it.
    var loadMentionableMembers: (@MainActor () async -> [MentionableMember])?
    let onNotice: @MainActor (String) -> Void
    /// #408: nil withholds the collision check entirely (a compose screen with
    /// no thread behind it has nothing to collide with).
    var duplicateReply: DuplicateReplyContext?
    /// Ask for AI-drafted replies. Nil hides the affordance entirely.
    var suggestReplies: (@MainActor (String) async -> ReplySuggestions)?
    /// Place a call to this customer, offered by a banner that blocks texting
    /// but not calling. Nil withholds it (a member without text level on the
    /// number would be refused by the API).
    var onCallInstead: (@MainActor () -> Void)?
    /// Identifies this thread AT ITS CURRENT POINT, so drafts already paid for
    /// are reused until a message in either direction retires them. Nil skips
    /// the cache entirely (a compose screen with no thread behind it yet).
    var draftCacheKey: String?
    /// #225: what time it is where the customer is. Nil, or a daytime clock,
    /// shows nothing — the line exists only for the hour that would change
    /// what somebody does, and a clock on screen all day is furniture.
    var destinationClock: DestinationClock?

    @State private var templatePickerOpen = false
    @State private var mentionPickerOpen = false
    // Drafts live only while the composer is looking at this thread: they are a
    // momentary offer, never cached state.
    @State private var suggestions: [String] = []
    // Reported with the drafts: Lou was never told what this business does.
    // Held for the life of the composer rather than re-fetched, since it only
    // changes when someone writes the line.
    @State private var businessUnknown = false
    /// #408: the pause before landing on top of a colleague's answer.
    @State private var confirmCollision = false
    @State private var suggesting = false
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
                ComposerBannerCard(banner: banner, onCallInstead: onCallInstead)
            }

            // #225: above the box, below any banner. Never for a notes-only
            // member — an internal note has no recipient to wake up.
            if !noteOnly, let line = theirTimeLine(destinationClock) {
                Text(line)
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted600)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
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

            if !isNote, !suggestions.isEmpty || suggesting {
                replySuggestionsRow
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
        // #408: two techs answering the same customer thirty seconds apart is
        // the exact confusion a shared inbox exists to eliminate, and the
        // product creates the race on purpose — an unassigned inbound notifies
        // everyone, which is right for "never miss a lead". So this is a pause
        // at the moment the mistake becomes irreversible, not a lock.
        .alert("Somebody already answered", isPresented: $confirmCollision) {
            Button("Let me look", role: .cancel) {}
            Button("Send anyway") { submit() }
        } message: {
            Text(collisionMessage)
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
        // ONE importer for both modes: a note and a text are never composed at
        // the same time, and two .fileImporter modifiers on one view race each
        // other's presentation.
        .fileImporter(
            isPresented: $fileImporterOpen,
            allowedContentTypes: isNote ? [.item] : mmsImporterContentTypes,
            allowsMultipleSelection: true
        ) { result in
            if isNote {
                stageFiles(result)
            } else {
                stageMedia(result)
            }
        }
        .sheet(isPresented: $templatePickerOpen) {
            TemplatePickerSheet(loadTemplates: loadTemplates) { body in
                templatePickerOpen = false
                insertTemplate(body)
            }
        }
        .sheet(isPresented: $mentionPickerOpen) {
            if let load = loadMentionableMembers {
                MentionPickerSheet(load: load) { member in
                    mentionPickerOpen = false
                    insertMention(member)
                }
            }
        }
    }

    /// Write the chosen teammate into the draft and remember WHICH teammate,
    /// so two people sharing a display name stay distinguishable at send time.
    private func insertMention(_ member: MentionableMember) {
        let name = member.display_name.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = name.isEmpty ? "Teammate" : name
        let next = MentionLogic.insertMention(
            text: state.text,
            caret: state.text.count,
            name: label
        )
        state.onTextChange(next.text)
        state.addMention(PickedMention(userId: member.user_id, name: label))
    }

    /// Ask for drafts, sending whatever is typed so far so the server finishes
    /// the sentence rather than talking past it. Silence after a tap reads as
    /// broken, so an empty result says so out loud.
    private func askForSuggestions() {
        // Already drafted for this thread, and nothing has happened since: show
        // what Lou wrote rather than paying for the same answer twice.
        if let draftCacheKey, let cached = DraftSuggestionsCache.read(draftCacheKey) {
            suggestions = cached
            return
        }
        guard let ask = suggestReplies, !suggesting else { return }
        suggesting = true
        suggestions = []
        Task {
            let drafted = await ask(state.text)
            suggesting = false
            if drafted.suggestions.isEmpty {
                onNotice(replyDraftMessage(drafted.reason))
            } else {
                suggestions = drafted.suggestions
                businessUnknown = drafted.business_unknown
                if let draftCacheKey {
                    DraftSuggestionsCache.write(draftCacheKey, suggestions: drafted.suggestions)
                }
            }
        }
    }

    /// AI-drafted replies above the pill. Tapping one loads it into the composer
    /// to read and edit. NOTHING here sends — the person still presses send,
    /// every time, which is the whole safety model of the feature.
    private var replySuggestionsRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 5) {
                AiOrb(state: suggesting ? .thinking : .done, size: 14)
                Text(suggesting ? "Drafting…" : "Lou's drafts")
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
                Spacer()
                if !suggesting {
                    // No re-ask. Every ask is a real AI call, and re-rolling
                    // until a draft reads nicely is what turns a bounded
                    // per-message cost into an unbounded one, for an answer
                    // that is a starting point you edit anyway. The next set
                    // comes when the thread moves.
                    Button("Dismiss") { suggestions = [] }
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                        .buttonStyle(.plain)
                        .padding(.leading, 12)
                }
            }
            // Three placeholders while drafting, because three is what comes
            // back: the strip keeps its shape instead of jumping when they land.
            if suggesting {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(BrandColor.inset)
                        .frame(height: 38)
                }
            }
            ForEach(suggestions, id: \.self) { suggestion in
                Button {
                    // `text` is private(set); onTextChange is the writer (it
                    // also queues the draft save, which a raw assignment skips).
                    state.onTextChange(suggestion)
                    suggestions = []
                } label: {
                    Text(suggestion)
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.ink)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(BrandColor.paper)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(BrandColor.insetDeep, lineWidth: 1)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            // Offered here rather than only in Settings, because this is the
            // moment the gap is felt: the drafts are on screen and vaguer than
            // they need to be. The setting exists either way; almost nobody
            // goes looking.
            if !suggesting, businessUnknown {
                Button {
                    AppRouter.shared.openSettingsSection = .ai
                } label: {
                    Text("Lou doesn't know what you do yet. Tell it, and drafts get specific.")
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.olive)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
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
                    // A text carries more than photos, and this app could only
                    // send those: an audio clip, a PDF, or a contact card had
                    // to go out from the web app or Android.
                    Button {
                        fileImporterOpen = true
                    } label: {
                        Label("Attach a file", systemImage: "paperclip")
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

                // Lou sits in the pill, not inside the overflow: asking for a
                // draft was two taps and a menu, which is more work than
                // typing the reply.
                if suggestReplies != nil {
                    Button {
                        askForSuggestions()
                    } label: {
                        AiOrb(state: suggesting ? .thinking : .idle, size: 20)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .disabled(suggesting)
                    .accessibilityLabel(
                        state.text.isBlank ? "Draft with Lou" : "Finish with Lou"
                    )
                }
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
                requestSend()
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
            let previous = state.text
            state.onTextChange(value)
            // "@" at the start of a note or after a space names a teammate.
            // Mid-word it belongs to an email address or a rate like
            // "2 hrs @ $95", so the picker stays shut and the character is
            // always kept. Guarded to a single appended character so a stale
            // "@" already at the end cannot re-open it on an unrelated edit.
            if isNote,
                loadMentionableMembers != nil,
                value.count == previous.count + 1,
                value.hasPrefix(previous),
                MentionLogic.isMentionTrigger(text: value, caret: value.count)
            {
                mentionPickerOpen = true
            }
            // Drafts were written for what was typed a moment ago; once that
            // changes they are stale, so they go rather than sit there
            // offering to overwrite newer words.
            if !suggestions.isEmpty { suggestions = [] }
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

    /// #408: the send boundary. A teammate answering this customer while the
    /// draft was being written is the one thing worth a pause here.
    ///
    /// A WARNING, NOT A BLOCK. A duplicate reply is genuinely better than no
    /// reply, and anything discouraging a tech from answering works against
    /// the five-minute window that decides the job. Notes skip it entirely —
    /// they reach no customer, so there is no collision to have.
    /// Bound to a plain property rather than built inline: this view's call
    /// site has run the Swift type checker out of budget before, and a string
    /// assembled inside the modifier chain is exactly the kind of expression
    /// that does it.
    private var collisionMessage: String {
        let sender = duplicateReply?.lastOutbound?.sent_by_user_id
        let name = sender.flatMap { duplicateReply?.memberName($0) }
        var seconds = 0
        if let iso = duplicateReply?.lastOutbound?.created_at {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let parsed = formatter.date(from: iso)
                ?? ISO8601DateFormatter().date(from: iso)
            if let parsed {
                seconds = max(0, Int(Date().timeIntervalSince(parsed)))
            }
        }
        return duplicateReplyPrompt(who: name, secondsAgo: seconds)
            + " Send yours as well?"
    }

    private func requestSend() {
        guard canSend else { return }
        let collision = duplicateReplyWarning(
            draftStartedAt: state.draftStartedAt,
            lastOutboundAt: duplicateReply?.lastOutbound?.created_at,
            lastOutboundByUserId: duplicateReply?.lastOutbound?.sent_by_user_id,
            meUserId: duplicateReply?.meUserId ?? ""
        )
        if !isNote, collision.warn {
            confirmCollision = true
            return
        }
        submit()
    }

    private func submit() {
        guard canSend else { return }
        let body = state.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if isNote {
            let files = state.files
            let mentionIds = MentionLogic.resolveMentions(text: body, picked: state.picked)
            state.clearForSend()
            onSaveNote(body, files, mentionIds)
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

    /// Stage picked documents as outbound media. Same ceiling as photos (3 per
    /// text) because the server counts them the same way.
    private func stageMedia(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result else { return }
        var trimmed = false
        for url in urls {
            if state.photos.count >= maxPhotos {
                trimmed = true
                break
            }
            switch stageMmsMedia(pickedURL: url) {
            case .ready(let media):
                state.photos.append(media)
            case .rejected(let reason):
                onNotice(reason)
            }
        }
        if trimmed { onNotice("You can attach up to 3 files per text.") }
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
        // #415: measure what SENDS, not what was typed. This view already had
        // both names in hand for the preview below and gave the meter the raw
        // draft, so a message built around {business_name} — 15 characters
        // against "Wilson & Sons Plumbing and Heating" at 34 — was reported a
        // part short every time it went out.
        //
        // The encoding boundary is where it stops being a rounding error: an
        // accent or a curly apostrophe arriving through a name flips the WHOLE
        // message from GSM-7 to UCS-2 and per-part capacity falls from 160 to
        // 70. "Ménard Plomberie" and "O'Brien Heating" are the names this
        // product's Canada-first positioning actively courts.
        let meter = segmentMeter(
            MergeFields.applyMergeFields(
                text,
                contactName: contactName,
                businessName: businessName
            ),
            hasMedia: hasMedia
        )
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

/// The content types the file picker offers for an outbound text: the UTType
/// spellings of `mmsOutboundMediaTypes`. Offering `.item` would let someone
/// pick a .zip only to be turned away afterwards.
let mmsImporterContentTypes: [UTType] = {
    var types: [UTType] = [
        .image, .audio, .movie, .mpeg4Movie,
        .pdf, .vCard, .calendarEvent, .plainText,
    ]
    // 3GPP has no static constant, and a .ics file does not always resolve to
    // public.calendar-event. A kind you cannot pick is the same as one we
    // cannot send, so both are derived rather than assumed.
    types.append(contentsOf: [
        UTType(mimeType: "video/3gpp"),
        UTType(filenameExtension: "ics"),
    ].compactMap { $0 })
    return types
}()

/// A staged item with no thumbnail: its kind icon, its name, and its size.
struct StagedMediaChip: View {
    let media: StagedPhoto

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: media.kind.symbolName)
                .font(.system(size: 17))
                .foregroundStyle(BrandColor.muted600)
            Text(media.name ?? attachmentLabel(kind: media.kind, count: 1))
                .font(.golos(8.5, weight: .semibold))
                .foregroundStyle(BrandColor.muted600)
                .lineLimit(1)
                .truncationMode(.middle)
            Text(stagedSizeLabel(media.sizeBytes))
                .font(.golos(8))
                .foregroundStyle(BrandColor.muted300)
        }
        .padding(.horizontal, 4)
        .frame(width: 56, height: 56)
        .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(BrandColor.insetDeep, lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
    }
}

/// Removable staged previews above the pill: a thumbnail for a photo, a named
/// chip for everything else a text can carry.
struct PhotoChipsRow: View {
    let photos: [StagedPhoto]
    let onRemove: @MainActor (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(photos) { photo in
                    ZStack(alignment: .topTrailing) {
                        if photo.kind == .image, let image = UIImage(data: photo.bytes) {
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
                            // No thumbnail to show, so say what it is instead of
                            // staging an anonymous grey square.
                            StagedMediaChip(media: photo)
                        }
                        Button {
                            onRemove(photo.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(BrandColor.ink, BrandColor.paper)
                        }
                        .accessibilityLabel("Remove attachment")
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
            onSaveNote: { _, _, _ in },
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
            banner: .optedOut(carrierBlocked: true),
            contactName: "Dana Whitcomb",
            businessName: "Loonext Fencing",
            loadTemplates: { [] },
            onSendText: { _, _ in },
            onSaveNote: { _, _, _ in },
            onNotice: { _ in }
        )
    }
}

/// Names a teammate on an internal note.
///
/// The list is the SERVER's answer to who may be named here, never a filter
/// over the whole team: a teammate who cannot open this thread must not be
/// offered, because the note quotes the customer.
@MainActor
struct MentionPickerSheet: View {
    let load: @MainActor () async -> [MentionableMember]
    let onPick: @MainActor (MentionableMember) -> Void

    @State private var members: [MentionableMember]?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Mention a teammate")
                .font(.display(21))
                .foregroundStyle(BrandColor.ink)
            content
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(BrandColor.canvas.ignoresSafeArea())
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .task { members = await load() }
    }

    @ViewBuilder
    private var content: some View {
        if let rows = members {
            if rows.isEmpty {
                Text("No teammates can see this conversation.")
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted600)
                    .padding(.vertical, 16)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(rows) { member in
                            Button {
                                onPick(member)
                            } label: {
                                Text(displayName(member))
                                    .font(.golos(15))
                                    .foregroundStyle(BrandColor.ink)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 14)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        } else {
            CenteredLoading()
        }
    }

    private func displayName(_ member: MentionableMember) -> String {
        let trimmed = member.display_name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Teammate" : trimmed
    }
}
