import SwiftUI

/// #287 — what this thread has been quoted, and the way to quote it.
///
/// ## Why a strip beside the composer rather than a bubble
///
/// The same reasoning #224's payment strip settled, and it applies harder here.
/// The message carrying the quote link is already in the transcript exactly as
/// the customer received it. What is NOT in the transcript is the STATE — sent,
/// opened, accepted, lapsed — and three of those four change with nobody in the
/// workspace doing anything. A bubble would have to mutate after the fact, which
/// is the one thing a transcript must never do.
///
/// ## The status it renders
///
/// `Quote.shownStatus`, never the stored column and never the wire's
/// `effective_status` — see `QuotesApi.swift` for why a cached row outlives its
/// own derivation.
///
/// ## The form
///
/// *Smart Defaults*: the expiry is pre-filled at 14 days. It is the one field
/// whose answer a crew member does not care about and cannot leave blank, so
/// asking them to type it is pure friction; the amount and the work are theirs
/// and are deliberately empty, because a default price is a wrong price.
///
/// *Ethical Friction, calibrated*: creating is not sending. A draft costs
/// nothing and is invisible to the customer, so it needs no ceremony. SEND is
/// the customer-visible act that binds a price, so the button carries the amount
/// rather than saying "Send" — you cannot press it without the figure in your
/// eye.
///
/// Mirrors `apps/web/src/components/thread/quote-strip.tsx` and
/// `ThreadQuotes.kt`.

/// Rows worth keeping above the composer: live, or decided in the last week.
private let quoteRecentDecisionSeconds: TimeInterval = 7 * 24 * 60 * 60

/// The expiry a crew member does not have to think about.
private let quoteDefaultExpiryDays = 14

private func quoteIsWorthShowing(_ quote: Quote, now: Date) -> Bool {
    if !Quotes.isDecided(quote.shownStatus(now: now)) { return true }
    guard let decided = Quotes.isoDate(quote.decided_at) else { return false }
    return now.timeIntervalSince(decided) < quoteRecentDecisionSeconds
}

@MainActor
@Observable
final class ThreadQuotesModel {
    private let quotes: QuotesApi
    private let companyId: String
    private let conversationId: String

    var rows: [Quote] = []
    var sendingId: String?
    var busy = false
    var notice: String?

    init(quotes: QuotesApi, companyId: String, conversationId: String) {
        self.quotes = quotes
        self.companyId = companyId
        self.conversationId = conversationId
    }

    var visible: [Quote] {
        let now = Date()
        return rows.filter { quoteIsWorthShowing($0, now: now) }
    }

    func load() async {
        // A failed read is silence, not an error banner. The strip is absent on
        // almost every thread anyway, and a red row above the composer for a
        // list that is usually empty is a worse trade than showing nothing.
        rows = (try? await quotes.forConversation(
            companyId: companyId,
            conversationId: conversationId
        ))?.data ?? []
    }

    func create(amountCents: Int, description: String, locale: String?) async {
        busy = true
        defer { busy = false }
        let expires = ISO8601DateFormatter().string(
            from: Date().addingTimeInterval(
                TimeInterval(quoteDefaultExpiryDays * 24 * 60 * 60)
            )
        )
        do {
            _ = try await quotes.create(
                companyId: companyId,
                conversationId: conversationId,
                amountCents: amountCents,
                description: description,
                expiresAt: expires
            )
            await load()
        } catch {
            notice = error.userMessage(locale ?? MessageLocale.en)
        }
    }

    func send(_ quote: Quote, locale: String?) async -> Bool {
        sendingId = quote.id
        defer { sendingId = nil }
        do {
            _ = try await quotes.send(companyId: companyId, quoteId: quote.id)
            await load()
            return true
        } catch {
            notice = error.userMessage(locale ?? MessageLocale.en)
            return false
        }
    }
}

struct ThreadQuotesPane: View {
    let api: ApiClient
    let companyId: String
    let conversationId: String
    let role: String?
    /// #106: 'text' or 'note' on this conversation's number.
    let viewerLevel: String
    /// A sent quote goes out as an ordinary text the transcript does not know of.
    let onSent: () -> Void

    @Environment(\.appLocale) private var appLocale

    @State private var model: ThreadQuotesModel?
    @State private var open = false
    @State private var amount = ""
    @State private var work = ""

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    /// A notes-only viewer sees none of this. A note goes to the crew; a quote
    /// goes to the customer, and somebody who cannot text this customer has no
    /// business quoting them.
    private var canSee: Bool { viewerLevel == "text" }

    /// #315: a view-only observer READS the thread and changes nothing in it.
    /// They still see what was quoted — that is a fact about the conversation
    /// they are here to read — and are offered no way to add or send one.
    private var canAct: Bool { canSee && role != MemberRole.readOnly }

    var body: some View {
        Group {
            if canSee, let model, !model.visible.isEmpty || canAct {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(model.visible) { quote in
                        QuoteStripRow(
                            quote: quote,
                            canSend: canAct,
                            sending: model.sendingId == quote.id
                        ) {
                            Task {
                                if await model.send(quote, locale: appLocale) { onSent() }
                            }
                        }
                    }
                    if canAct {
                        if open {
                            form(model)
                        } else {
                            Button(t("quotes.newQuote")) { open = true }
                                .font(.golos(13))
                                .foregroundStyle(BrandColor.olive)
                        }
                    }
                    // The API's own words on a refusal, never a paraphrase, and
                    // never swallowed: a create or send that failed silently is
                    // a crew member who thinks a customer has a price.
                    InlineError(model.notice)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 4)
            }
        }
        .task(id: "\(companyId)|\(conversationId)") {
            let created = ThreadQuotesModel(
                quotes: QuotesApi(api: api),
                companyId: companyId,
                conversationId: conversationId
            )
            model = created
            await created.load()
        }
    }

    @ViewBuilder
    private func form(_ model: ThreadQuotesModel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                TextField(t("quotes.amountLabel"), text: $amount)
                    .keyboardType(.decimalPad)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 120)
                TextField(t("quotes.descriptionLabel"), text: $work)
                    .textFieldStyle(.roundedBorder)
            }
            // The default, said out loud rather than hidden in a field nobody
            // filled in. A price with no expiry binds the business forever.
            Text(t("quotes.expiresInDays", ["days": String(quoteDefaultExpiryDays)]))
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted500)
            HStack(spacing: 10) {
                Button(model.busy ? t("quotes.saving") : t("quotes.saveDraft")) {
                    Task { await submit(model) }
                }
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
                .disabled(model.busy)

                Button(t("common.cancel")) { open = false }
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
            }
        }
    }

    private func submit(_ model: ThreadQuotesModel) async {
        let digits = amount.filter { $0.isNumber || $0 == "." }
        guard let dollars = Double(digits), dollars > 0 else {
            model.notice = t("quotes.needAmount")
            return
        }
        guard !work.trimmingCharacters(in: .whitespaces).isEmpty else {
            model.notice = t("quotes.needDescription")
            return
        }
        await model.create(
            amountCents: Int((dollars * 100).rounded()),
            description: work.trimmingCharacters(in: .whitespaces),
            locale: appLocale
        )
        amount = ""
        work = ""
        open = false
    }
}

private struct QuoteStripRow: View {
    let quote: Quote
    let canSend: Bool
    let sending: Bool
    let onSend: () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        let status = quote.shownStatus()
        // The row carries its own currency, the way a payment request does: a
        // quote is denominated when it is written, and a workspace that later
        // changes billing currency must not restate old prices.
        let money = quote.amountLabel

        HStack(spacing: 6) {
            Image(systemName: "doc.text")
                .foregroundStyle(BrandColor.muted500)
            Text(money)
                .font(.golos(13, weight: .medium))
            Text(quote.description)
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted500)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(AppStrings.translate(appLocale, QuoteStatus.keys[status] ?? "quotes.statusDraft"))
                .font(.golos(13))
                .foregroundStyle(statusTint(status))
            if status == QuoteStatus.draft, canSend {
                // The amount rides on the button: this is the act the customer
                // sees, and it binds a price.
                Button(
                    sending
                        ? AppStrings.translate(appLocale, "quotes.sending")
                        : AppStrings.translate(appLocale, "quotes.sendFor", ["amount": money])
                ) {
                    onSend()
                }
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.olive)
                .disabled(sending)
            }
        }
    }

    private func statusTint(_ status: String) -> Color {
        switch status {
        case QuoteStatus.accepted: return BrandColor.olive
        case QuoteStatus.expired, QuoteStatus.declined: return BrandColor.muted500
        default: return BrandColor.ink
        }
    }
}
