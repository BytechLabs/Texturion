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

    /// #294: whether these photos are the before or the after.
    ///
    /// Nil unless somebody says otherwise. Defaulting to "before" would mislabel most
    /// notes, and a job record that is confidently wrong is worse than one that says
    /// nothing.
    var workPhase: String?

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
        workPhase = nil
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
/// `readOnly` (#315) is the stronger one: a view-only observer may do NEITHER,
/// so the card is all there is. Leaving the note box under it would offer a
/// write the API refuses, and the worst version of that is somebody believing
/// they left a note.
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
    /// #315: view-only — no text box and no note box, just the reason.
    var readOnly: Bool = false
    let banner: ComposerBanner?
    let contactName: String?
    let businessName: String?
    /// #274: the contact's service address, for {address} in the preview.
    var contactAddress: String?
    /// #274: the signed-in member, for {my_name}.
    var senderName: String?
    /// #274: this conversation's number in E.164, for {our_number}.
    var ourNumberE164: String?
    let loadTemplates: @MainActor () async throws -> [Template]
    /// #475: the body, the photos, the saved reply it came from (if any),
    /// and whether the words changed after it was inserted (#274).
    let onSendText: @MainActor (String, [StagedPhoto], String?, Bool) -> Void
    let onSaveNote: @MainActor (String, [StagedFile], [String], String?) -> Void
    /// #520: does this thread have a job due TODAY? Decided by the screen, not
    /// here — this view stays presentational, and "today" is a question about
    /// the device's clock and the task list rather than about a draft.
    ///
    /// False hides the affordance entirely rather than disabling it: a control
    /// that is present and inert still costs a reader the moment it takes to
    /// work out why it does nothing, on a toolbar that already carries five.
    /// Defaulted so every existing construction site is unchanged.
    var hasJobToday: Bool = false
    /// #520: send "on my way — about N minutes", where N is the tap.
    var onSendOnMyWay: (@MainActor (Int) -> Void)?
    /// Who may be named on a note here. Nil withholds mentions entirely rather
    /// than opening a picker with nothing behind it.
    var loadMentionableMembers: (@MainActor () async -> [MentionableMember])?
    let onNotice: @MainActor (String) -> Void
    /// #408: nil withholds the collision check entirely (a compose screen with
    /// no thread behind it has nothing to collide with).
    var duplicateReply: DuplicateReplyContext?
    /// Ask for AI-drafted replies. Nil hides the affordance entirely.
    var suggestReplies: (@MainActor (String) async -> ReplySuggestions)?
    /// #431: report what happened to one of Lou's drafts — sent as written, sent
    /// after changes, or shown and not used. Enum only; the draft's words never
    /// leave the device for this. Nil skips the measurement (a screen with no
    /// company context behind it), never the send.
    var reportAiOutcome: (@MainActor (String, String) -> Void)?
    /// Place a call to this customer, offered by a banner that blocks texting
    /// but not calling. Nil withholds it (a member without text level on the
    /// number would be refused by the API).
    var onCallInstead: (@MainActor () -> Void)?
    /// #253: report THIS failure. Nil withholds the offer entirely.
    var onReportBanner: (@MainActor (ComposerBanner) -> Void)?
    /// #302: called on each keystroke of a REPLY so teammates on this thread
    /// see somebody is answering. Throttled by the caller — the keystroke rate
    /// is not the broadcast rate. Notes deliberately do not signal: a note goes
    /// to the crew, and nobody is racing to answer the customer with it.
    var onTyping: (@MainActor () -> Void)?
    /// Identifies this thread AT ITS CURRENT POINT, so drafts already paid for
    /// are reused until a message in either direction retires them. Nil skips
    /// the cache entirely (a compose screen with no thread behind it yet).
    var draftCacheKey: String?
    /// #225: what time it is where the customer is. Nil, or a daytime clock,
    /// shows nothing — the line exists only for the hour that would change
    /// what somebody does, and a clock on screen all day is furniture.
    var destinationClock: DestinationClock?
    /// #507: dictate a wrap-up after a call and get the words back to check and
    /// post as a note. Nil hides the affordance entirely (a compose screen with
    /// no conversation behind it has nothing to post a note to, and a member
    /// without note level on the number would be refused by the API).
    ///
    /// DECLARED LAST on purpose. A SwiftUI view's memberwise initialiser takes
    /// its arguments in declaration order, so the newest optional going at the
    /// end is the one shape that cannot reorder an existing call site.
    var wrapUp: WrapUpDictationContext?

    /// #233: queue this text for `sendAtISO` instead of sending it now.
    ///
    /// Returns what the API said, because a quiet-hours 409 is a QUESTION
    /// rather than a failure — the composer asks and retries with the flag,
    /// which is #225 ask 2 (warned, never blocked). Nil hides the affordance
    /// entirely: a screen with no conversation behind it has nothing to
    /// schedule against, and an affordance that only ever fails is worse than
    /// no affordance.
    ///
    /// Declared after ``wrapUp`` for the same memberwise-init reason it gives.
    var onScheduleSend: (@MainActor (String, String, Bool) async -> ScheduleOutcome)?

    @State private var templatePickerOpen = false
    @State private var mentionPickerOpen = false
    /// #475: which saved reply is in the box, and what it said on arrival.
    ///
    /// Compared at SEND time rather than tracked per keystroke: the question
    /// #274 asks is "did this go out different from the template", and
    /// somebody who types a word and deletes it did not edit anything.
    @State private var templateUse: (id: String, body: String)?
    // Drafts live only while the composer is looking at this thread: they are a
    // momentary offer, never cached state.
    @State private var suggestions: [String] = []
    // Reported with the drafts: Lou was never told what this business does.
    // Held for the life of the composer rather than re-fetched, since it only
    // changes when someone writes the line.
    @State private var businessUnknown = false
    /// #408: the pause before landing on top of a colleague's answer.
    @State private var confirmCollision = false
    // #233 send later. All three surfaces are owned HERE rather than by the
    // caller, because the words being scheduled live in this box: a 409 has to
    // leave the draft where it is so the second attempt still has something to
    // send.
    @State private var sendLaterOpen = false
    @State private var pickTimeOpen = false
    /// The instant awaiting a quiet-hours answer. Nil means nothing is asked.
    @State private var quietConfirmFor: Date?
    @State private var suggesting = false
    /// #431: which of Lou's drafts (if any) was taken into the composer, and
    /// whether any were shown at all. Kept so the outcome can be judged at the
    /// moment of sending — the only moment that says whether it was useful.
    @State private var pickedSuggestion: String?
    @State private var suggestionsWereShown = false
    @State private var photosPickerOpen = false
    @State private var fileImporterOpen = false
    @State private var photoSelection: [PhotosPickerItem] = []
    /// #507: what the dictation is doing, and for how long.
    ///
    /// Held as plain view state rather than read off the recorder, which owns
    /// only what SwiftUI cannot (the live AVAudioRecorder and its file). Two
    /// owners of one truth is how a button ends up drawn as recording after the
    /// recorder has stopped.
    @State private var wrapUpPhase = WrapUpPhase.idle
    @State private var wrapUpSeconds = 0
    /// Created on the first press rather than with the view: most threads are
    /// opened, read and left without anyone dictating anything, and an audio
    /// object built for every one of them is a cost with no reader. Mirrors how
    /// ThreadView builds its controller.
    @State private var wrapUpRecorder: WrapUpRecorder?
    @State private var wrapUpTicker: Task<Void, Never>?

    private var textBlocked: Bool { noteOnly || banner != nil }

    /// #520: whether the ETA choices are showing. One tap opens them, the next
    /// sends — so the prompt asks a question and the note says what answering
    /// does.
    @State private var choosingEta = false
    private var isNote: Bool { textBlocked || state.mode == .note }

    private var canSend: Bool {
        if isNote {
            return !state.text.isBlank || !state.files.isEmpty
        }
        return !state.text.isBlank || !state.photos.isEmpty
    }

    /// #253: the report closure for one banner, built OUTSIDE the ViewBuilder.
    ///
    /// Two reasons it is a method rather than an inline `.map { … }`. A
    /// @MainActor function type is implicitly @Sendable and inference through
    /// `Optional.map` does not carry that contextual type into the closure
    /// literal — the same trap ThreadView documents on `onCallInstead`. And a
    /// `var` plus an `if` inside a ViewBuilder block is not a view, so the
    /// obvious local-variable spelling does not compile at all.
    private func reporter(for banner: ComposerBanner) -> (@MainActor () -> Void)? {
        guard let onReportBanner else { return nil }
        return { onReportBanner(banner) }
    }

    var body: some View {
        VStack(spacing: 0) {
            if let banner {
                ComposerBannerCard(
                    banner: banner,
                    onCallInstead: onCallInstead,
                    onReport: reporter(for: banner)
                )
            }

            if !readOnly {
                composerBody
            }
        }
    }

    @ViewBuilder
    private var composerBody: some View {
        VStack(spacing: 0) {

            // #520: above the box, and only when there is a job today. Not on
            // a note — a note goes to the crew, and "on my way" is for the
            // customer.
            if !noteOnly, hasJobToday, let sendOnMyWay = onSendOnMyWay {
                if choosingEta {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(OnMyWay.Copy.prompt)
                                .font(.golos(13))
                                .foregroundStyle(BrandColor.muted600)
                            ForEach(OnMyWay.presets, id: \.self) { minutes in
                                Button(OnMyWay.presetLabel(minutes)) {
                                    choosingEta = false
                                    sendOnMyWay(minutes)
                                }
                                .font(.golos(13))
                                .buttonStyle(.bordered)
                            }
                            Button("Cancel") { choosingEta = false }
                                .font(.golos(13))
                                .foregroundStyle(BrandColor.muted600)
                        }
                        // What the next tap does, said before it is tapped.
                        Text(OnMyWay.Copy.gatedNote)
                            .font(.golos(11))
                            .foregroundStyle(BrandColor.muted600)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
                } else {
                    Button(OnMyWay.Copy.action) { choosingEta = true }
                        .font(.golos(13))
                        .foregroundStyle(BrandColor.muted600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.top, 6)
                }
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
                // #294: only once there are photos to describe. A before/after choice
                // on a text-only note is noise on the most common thing anybody does
                // in this composer.
                WorkPhaseRow(value: state.workPhase) { next in
                    state.workPhase = next
                }
            }

            // #507: above the pill, where the drafts strip sits in text mode.
            // Only while something is actually happening — a control that
            // announces itself when idle is furniture.
            if isNote, wrapUpPhase != .idle {
                wrapUpStatusLine
            }

            composerPill

            if !isNote {
                ComposerHints(
                    text: state.text,
                    hasMedia: !state.photos.isEmpty,
                    contactName: contactName,
                    businessName: businessName,
                    contactAddress: contactAddress,
                    senderName: senderName,
                    ourNumberE164: ourNumberE164
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
            TemplatePickerSheet(loadTemplates: loadTemplates) { body, templateId in
                templatePickerOpen = false
                insertTemplate(body, templateId)
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
        // #233: presets and picker are one flow — choosing "Pick a time…"
        // dismisses the sheet and opens the picker, so a person is never
        // looking at both. Two `.sheet` modifiers rather than one branching
        // presentation, because SwiftUI cannot swap a sheet's content while it
        // is on screen without dropping the transition.
        .sheet(isPresented: $sendLaterOpen) {
            SendLaterSheet(
                clock: destinationClock,
                onPick: { at in scheduleFor(at) },
                onPickCustom: { pickTimeOpen = true }
            )
        }
        .sheet(isPresented: $pickTimeOpen) {
            SendLaterPicker(clock: destinationClock) { at in scheduleFor(at) }
        }
        .alert(
            "That lands late where they are",
            isPresented: Binding(
                get: { quietConfirmFor != nil },
                set: { if !$0 { quietConfirmFor = nil } }
            )
        ) {
            Button("Pick another time", role: .cancel) { quietConfirmFor = nil }
            Button("Schedule it anyway") {
                if let pending = quietConfirmFor {
                    quietConfirmFor = nil
                    scheduleFor(pending, quietHoursConfirmed: true)
                }
            }
        } message: {
            Text(quietHoursScheduleMessage(localHour: destinationClock?.local_hour))
        }
        // #507: a recording must not outlive the composer that started it.
        .onDisappear { cancelWrapUp() }
        // Leaving note mode mid-hold. The mic control and the "we are
        // listening" line both live inside the note branch, so switching to
        // Text takes away the only stop button AND the only thing on screen
        // saying a recording is running — an open microphone with nothing to
        // show for it, which is the one impression this feature cannot give.
        .onChange(of: isNote) { _, nowNote in
            if !nowNote, wrapUpPhase != .idle {
                cancelWrapUp()
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
            // #431: shown but not taken. A send from here counts as discarded.
            suggestionsWereShown = true
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
                suggestionsWereShown = true
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
                    Button("Dismiss") {
                        suggestions = []
                        // #431: closed the strip without taking one. Reported
                        // now rather than deferred to a send that may never come.
                        if suggestionsWereShown {
                            suggestionsWereShown = false
                            reportAiOutcome?(
                                AiOutcome.featureSuggestReply,
                                AiOutcome.discarded
                            )
                        }
                    }
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
                    // #431: taken into the composer. Whether it was CHANGED is
                    // decided at send time by comparing with what goes out.
                    pickedSuggestion = suggestion
                    suggestionsWereShown = false
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

                // #507: in the pill beside the paperclip rather than behind a
                // menu, for the same reason Lou's orb is in text mode — this is
                // used in the thirty seconds after hanging up, and two taps and
                // a menu is more work than typing the sentence.
                if wrapUp != nil {
                    wrapUpButton
                }
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

            // #233: send later, as a visible control beside Send rather than a
            // long-press on it. It appears only when there are words to
            // schedule and hides again the moment the box is empty, so it is
            // never furniture; Send keeps the filled circle and stays the
            // single primary. *Applying: Zen of Clarity & Relationship
            // Strength.*
            if canScheduleLater {
                Button {
                    sendLaterOpen = true
                } label: {
                    Image(systemName: "clock")
                        .font(.body)
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 34, height: 34)
                }
                .accessibilityLabel("Send later")
            }

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

    // MARK: - #507 wrap-up dictation

    /// Hold to dictate a wrap-up.
    ///
    /// PRESS-AND-HOLD, NOT A LATCH, and that is the design rather than a
    /// styling choice. D117 makes "when is this listening?" the question the
    /// whole feature has to answer, and a finger on a button is the plainest
    /// answer there is: it hears the member for exactly as long as they hold
    /// it, and it is physically impossible for it to be doing so while the
    /// phone is in a pocket. A latched recorder would need a second story about
    /// when it stops.
    ///
    /// Note mode only, for the same reason. A wrap-up becomes an internal note
    /// — never a text — so the control does not exist on the side of the
    /// composer that reaches a customer.
    private var wrapUpButton: some View {
        let recording = wrapUpPhase == .recording
        return Group {
            if wrapUpPhase == .transcribing {
                // Lou wears one mark everywhere it appears (AiOrb.swift).
                AiOrb(state: .thinking, size: 20)
            } else {
                Image(systemName: recording ? "mic.fill" : "mic")
                    .font(.body.weight(.medium))
                    .foregroundStyle(recording ? BrandColor.destructive : NoteAmber.ink)
            }
        }
        // The paperclip's frame, so the two controls sit on one baseline
        // without a spacing decision being made by eye.
        .frame(width: 36, height: 36)
        .contentShape(Circle())
        // `minimumDuration` is a ceiling nobody can reach, and that is the
        // whole trick. `onPressingChanged` reports false the moment the long
        // press SUCCEEDS — not when the finger lifts — so an ordinary 0.5s
        // duration would stop the recording half a second in. A duration no
        // press outlives means the gesture never succeeds, `perform` never
        // runs, and `pressing` tracks the finger exactly. A plain large number
        // rather than `.infinity` so nothing downstream does arithmetic on it.
        //
        // The ticker's 120s auto-stop is the backstop for the other direction:
        // if a release is ever swallowed, recording still ends and still sends.
        .onLongPressGesture(minimumDuration: 600, maximumDistance: 44) {
            // Unreachable by design — see above.
        } onPressingChanged: { pressing in
            if pressing {
                beginWrapUp()
            } else {
                finishWrapUp()
            }
        }
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Hold to dictate a wrap-up")
        .accessibilityHint(
            "Say what was agreed after the call. Lou writes your words down for "
                + "you to check before you post the note."
        )
    }

    /// What is happening, while it is happening.
    ///
    /// A recording control with no elapsed feedback is the one that produces a
    /// two-minute file — the member cannot tell a held button from a stuck one.
    /// The countdown appears only in the last stretch, the same rule the
    /// destination clock above follows: a number on screen the whole time is
    /// furniture, and this one exists for the moment it changes what somebody
    /// does.
    private var wrapUpStatusLine: some View {
        let remaining = max(0, WrapUpLimits.maxSeconds - wrapUpSeconds)
        let transcribing = wrapUpPhase == .transcribing
        let label: String
        if transcribing {
            label = "Writing down what you said\u{2026}"
        } else if remaining <= 15 {
            label = "Go ahead \u{2014} \(remaining)s left"
        } else {
            label = "Go ahead \u{2014} let go when you're done"
        }
        return HStack(spacing: 5) {
            AiOrb(state: transcribing ? .thinking : .working, size: 12)
            Text(label)
                .font(.golos(11))
                .foregroundStyle(BrandColor.muted600)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    /// Press-down: permission, then the call check, then record.
    ///
    /// Both refusals are one plain sentence on the existing notice surface and
    /// nothing else — the member is left in the composer with a keyboard, which
    /// is the whole failure posture of this feature.
    private func beginWrapUp() {
        guard let wrapUp, wrapUpPhase == .idle else { return }
        let recorder = wrapUpRecorder ?? WrapUpRecorder()
        wrapUpRecorder = recorder

        switch recorder.micPermission {
        case .granted:
            break
        case .denied:
            onNotice(WrapUpStartRefusal.micDenied.message)
            return
        case .unasked:
            // Asked at the point of use. The answer cannot rescue THIS press —
            // the system sheet was up while they were talking — so the honest
            // reply is "say it again", never a silently empty note.
            Task {
                let granted = await recorder.requestMic()
                onNotice(
                    granted
                        ? WrapUpStartRefusal.micJustGranted.message
                        : WrapUpStartRefusal.micDenied.message
                )
            }
            return
        }

        // D117: the one arrangement that could pick up the customer through the
        // earpiece. Checked at press time rather than baked into a disabled
        // state, because a member can dismiss the in-call screen and land back
        // here with the call still up.
        if let refusal = recorder.start(callInProgress: wrapUp.callInProgress()) {
            onNotice(refusal.message)
            return
        }
        wrapUpSeconds = 0
        wrapUpPhase = .recording
        wrapUpTicker?.cancel()
        // Counts in a LOCAL and publishes it, rather than reading the state
        // back and adding one. Cancellation is the only stop signal this loop
        // trusts — `finishWrapUp` cancels it on every path — so a counter that
        // never reads shared state cannot run away on a stale read.
        wrapUpTicker = Task {
            var elapsed = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                elapsed += 1
                wrapUpSeconds = elapsed
                // A stuck finger must not buy two minutes of pocket audio: stop
                // at the server's own ceiling and send what was actually said.
                if elapsed >= WrapUpLimits.maxSeconds {
                    finishWrapUp()
                    return
                }
            }
        }
    }

    /// Release: stop, upload the bytes, and put the words in the box.
    ///
    /// The transcript lands in the field the member already types in — not a
    /// sheet, and never straight onto the thread. They read it, fix whatever
    /// was misheard, and press send, which is the same note path a typed note
    /// takes. There is deliberately no second way to write a note.
    private func finishWrapUp() {
        guard wrapUpPhase == .recording else { return }
        wrapUpTicker?.cancel()
        wrapUpTicker = nil
        guard let wrapUp, let recorder = wrapUpRecorder else {
            wrapUpPhase = .idle
            wrapUpSeconds = 0
            return
        }
        // The recording is read and DELETED inside `finish()` — before the
        // upload, not after — so an upload that never happens still leaves no
        // audio on the device.
        guard let taken = recorder.finish() else {
            wrapUpPhase = .idle
            wrapUpSeconds = 0
            onNotice("Hold the mic while you talk \u{2014} that was too short to write down.")
            return
        }
        wrapUpPhase = .transcribing
        Task {
            let outcome = await wrapUp.transcribe(taken.audio, taken.seconds)
            wrapUpPhase = .idle
            wrapUpSeconds = 0
            switch outcome {
            case .text(let words):
                // `state.text` is SHARED between the two modes, so a member who
                // tapped Text while this was in flight would have a private
                // wrap-up appear in the message addressed to the customer. Snap
                // back to Note before writing a single character.
                if state.mode != .note {
                    state.mode = .note
                }
                // Appended, never replacing: somebody who typed "call back re
                // permit" before dictating still has it. Parenthesised because
                // `||` inside a ternary is exactly the expression this file's
                // comments say has run the type checker out of budget.
                let current = state.text
                let spaced = (current.hasSuffix(" ") || current.hasSuffix("\n"))
                let joiner = spaced ? "" : " "
                // `onTextChange` rather than a raw assignment: it is the writer
                // that queues the draft save and starts the #408 draft clock.
                state.onTextChange(current.isBlank ? words : current + joiner + words)
            case .failed(let message):
                onNotice(message)
            }
        }
    }

    /// Leaving the thread mid-sentence throws the recording away rather than
    /// leaving a file behind for a view that no longer exists.
    private func cancelWrapUp() {
        wrapUpTicker?.cancel()
        wrapUpTicker = nil
        wrapUpRecorder?.discard()
        if wrapUpPhase == .recording {
            wrapUpPhase = .idle
            wrapUpSeconds = 0
        }
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
            if !isNote, !value.isEmpty { onTyping?() }
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

    private func insertTemplate(_ body: String, _ templateId: String) {
        let current = state.text
        let next = current.isEmpty
            ? body
            : current + (current.hasSuffix(" ") ? "" : " ") + body
        // #475: what the box holds AFTER the insert, so an append onto existing
        // words is not later read as an edit of the template.
        templateUse = (id: templateId, body: next)
        state.onTextChange(next)
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
        // Bound once rather than optional-chained at each use. `duplicateReply?
        // .memberName(id)` inside a flatMap yields String?? — one level deeper
        // than flatMap accepts — and the compiler's complaint about that is
        // considerably less obvious than this guard.
        guard let context = duplicateReply else { return "" }
        var name: String?
        if let sender = context.lastOutbound?.sent_by_user_id {
            name = context.memberName(sender)
        }
        var seconds = 0
        if let iso = context.lastOutbound?.created_at {
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

    /// #233: is there anything to schedule, and anywhere to schedule it?
    ///
    /// A note never reaches a customer, so "later" is meaningless there.
    private var canScheduleLater: Bool {
        onScheduleSend != nil && !isNote && canSend
    }

    /// Queue what is in the box, and clear it exactly as a send would.
    ///
    /// The clear happens on SUCCESS only. The words have left the box and are
    /// somewhere the person can see them; a draft left behind would be sent
    /// twice by anybody who assumed otherwise, and a draft cleared on a refusal
    /// would be a message nobody can recover.
    private func scheduleFor(_ at: Date, quietHoursConfirmed: Bool = false) {
        guard let schedule = onScheduleSend else { return }
        let body = state.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        let iso = ISO8601DateFormatter().string(from: at)
        Task {
            switch await schedule(body, iso, quietHoursConfirmed) {
            case .scheduled:
                quietConfirmFor = nil
                state.clearForSend()
                templateUse = nil
                // #539: the confirmation names the clock too. It used to render
                // the customer's time unlabelled, so the one sentence telling
                // somebody what they had just scheduled was the same trap as the
                // queued row it was confirming.
                onNotice(
                    "Sending \(TwoClocks.bothClocks(sendAtLabel(at, in: destinationZone(destinationClock)), sendAtLabel(at, in: .current))). "
                        + ScheduledSend.copyLine("picker_reassurance")
                )
            case .needsQuietHoursConfirm:
                quietConfirmFor = at
            // The caller has already said what went wrong, in the API's own
            // words. A second sentence written here would either repeat it or
            // contradict it.
            case .failed:
                quietConfirmFor = nil
            }
        }
    }

    private func submit() {
        guard canSend else { return }
        let body = state.text.trimmingCharacters(in: .whitespacesAndNewlines)
        // #431: judge Lou's draft against what is actually being sent, before the
        // composer is cleared. Notes are excluded — a note reaches no customer, so
        // a draft was never in play. Cleared either way, so one draft can only ever
        // yield one outcome.
        if !isNote {
            let outcome = AiOutcome.forDraft(
                shown: pickedSuggestion != nil || suggestionsWereShown,
                picked: pickedSuggestion,
                sent: body
            )
            pickedSuggestion = nil
            suggestionsWereShown = false
            if let outcome {
                reportAiOutcome?(AiOutcome.featureSuggestReply, outcome)
            }
        }
        if isNote {
            let files = state.files
            let mentionIds = MentionLogic.resolveMentions(text: body, picked: state.picked)
            let phase = state.workPhase
            state.clearForSend()
            onSaveNote(body, files, mentionIds, phase)
        } else {
            let photos = state.photos
            state.clearForSend()
            // #475/#274: what it came from, and whether it was changed.
            let used = templateUse
            onSendText(
                body,
                photos,
                used?.id,
                used != nil && used!.body.trimmingCharacters(in: .whitespacesAndNewlines)
                    != body.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            // The box is empty again, so whatever was inserted is spent. A
            // template left attached would tag the NEXT message too.
            templateUse = nil
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
    /// #393: the server-resolved signature this send will carry, or nil. Same
    /// argument as the names above — it is part of what sends, so it is part of
    /// what the meter counts. Passed in rather than composed so the count cannot
    /// drift from the body the server bills.
    var identificationSuffix: String? = nil
    /// #274: the contact's service address, for {address} in the preview.
    var contactAddress: String? = nil
    /// #274: the signed-in member, for {my_name}.
    var senderName: String? = nil
    /// #274: this conversation's number in E.164, for {our_number}.
    var ourNumberE164: String? = nil

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
        //
        // #393 adds the signature to that same string: merge fields first, then
        // sign, then estimate — the order the send path uses.
        //
        // #274: the meter counts the same values the preview renders, so an
        // address resolving into the body changes the part count exactly the
        // way a business name does.
        let sendsAs = Signature.append(
            MergeFields.applyMergeFields(
                text,
                values: MergeFields.Values(
                    contactName: contactName,
                    businessName: businessName,
                    contactAddress: contactAddress,
                    senderName: senderName,
                    ourNumber: ourNumberE164.map(MergeFields.formatNanpNumber)
                )
            ),
            suffix: identificationSuffix
        )
        let meter = segmentMeter(sendsAs, hasMedia: hasMedia)
        // A plain draft about to be SIGNED needs the preview too, or the one
        // case where the sent text differs from the typed text with no {token}
        // to hint at it is the case with no preview at all.
        let willSign = identificationSuffix != nil
            && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let showPreview = MergeFields.hasMergeFields(text) || willSign
        if meter.visible || showPreview {
            VStack(alignment: .leading, spacing: 2) {
                if meter.visible {
                    Text(meter.label)
                        .font(.golos(10.5))
                        .foregroundStyle(meter.warn ? BrandColor.overdueAmber : BrandColor.muted300)
                }
                if showPreview {
                    Text("Sends as: " + sendsAs)
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted300)
                    .lineLimit(2)
                    // #274: the two tokens this side cannot answer honestly. A
                    // cached "next visit" would be confidently wrong the moment
                    // a teammate reschedules it, and a preview that is usually
                    // right is worse than one that says what it cannot show.
                    if MergeFields.hasServerOnlyTokens(text) {
                        Text(MergeFields.serverOnlyTokensNote)
                            .font(.golos(10.5))
                            .foregroundStyle(BrandColor.muted300)
                    }
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
                .font(.scaled(17))
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
                                .font(.scaled(16))
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
                                .font(.scaled(11, weight: .semibold))
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
    /// #475: the body AND which saved reply it came from. Nothing downstream
    /// can recover the second from the first — by send time the words have
    /// been merged and possibly edited.
    let onPick: @MainActor (String, String) -> Void

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
                                    onPick(template.body, template.id)
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
                .font(.scaled(14, weight: .medium))
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
            onSendText: { _, _, _, _ in },
            onSaveNote: { _, _, _, _ in },
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
            onSendText: { _, _, _, _ in },
            onSaveNote: { _, _, _, _ in },
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
