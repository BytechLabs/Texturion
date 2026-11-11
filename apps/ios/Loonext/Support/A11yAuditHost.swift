#if DEBUG
import SwiftUI

/// The screens `LoonextUITests` opens with `-a11yAuditSurface <name>`: the real
/// views on fixture data, so the audit needs no account or network. Debug only.
enum A11yAuditSurface: String, CaseIterable {
    case login
    case signUp
    case forgot
    case inbox
    case thread
    case calls
    case tasks
    case contacts
    case inCall
    case dialer
    case settings
    case settingsSearch
    case account
    case trash
    /// #739: the Tasks calendar, month view, on dated fixture tasks.
    case taskCalendar
    /// #740: a contact with a long history on the redesigned contact page.
    case contactDetail
    /// #744: the Calendar settings card with both ways to connect.
    case calendarSettings
    /// #746: team settings, with the shared role control.
    case team
    /// #746: the on-call picker, which lives in Hours rather than Team.
    case onCall
    /// #752: the Tasks map with pinned jobs around downtown Toronto.
    case taskMap
    /// #749: the Calling settings, with after-hours calls on voicemail and the note
    /// saying who chose it.
    case callingSettings

    /// The surface this launch asked for, if any.
    static var requested: A11yAuditSurface? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let flag = arguments.firstIndex(of: "-a11yAuditSurface"),
              arguments.indices.contains(flag + 1)
        else { return nil }
        return A11yAuditSurface(rawValue: arguments[flag + 1])
    }
}

@MainActor
struct A11yAuditHost: View {
    let surface: A11yAuditSurface

    @State private var graph = AppGraph()

    var body: some View {
        let locale = UiLocaleStore.shared.resolved
        content
            .environment(\.appLocale, locale)
            .environment(\.locale, UiLocale.platformLocale(locale))
            .tint(BrandColor.olive)
            .background(BrandColor.canvas.ignoresSafeArea())
    }

    @ViewBuilder
    private var content: some View {
        switch surface {
        case .login:
            AuthFlow(authManager: graph.authManager)
        case .signUp:
            AuthFlow(authManager: graph.authManager, startingAt: .signUp)
        case .forgot:
            AuthFlow(authManager: graph.authManager, startingAt: .forgot)
        case .inbox:
            inboxRowsFixture()
        case .thread:
            VStack(spacing: 0) {
                threadTimelineFixture()
                composerFixture()
            }
        case .calls:
            callLogFixture()
        case .tasks:
            tasksListFixture()
        case .contacts:
            contactsListFixture()
        case .inCall:
            inCallControlsFixture()
        case .dialer:
            dialerFixture()
        case .settings:
            settingsIndexFixture()
        case .settingsSearch:
            settingsSearchFixture()
        case .account:
            accountSheetFixture()
        case .trash:
            trashListFixture()
        case .taskCalendar:
            A11yTasksSurface(initialView: .calendar)
        case .taskMap:
            A11yTasksSurface(initialView: .map)
        case .contactDetail:
            A11yContactSurface()
        case .calendarSettings:
            A11ySettingsSurface(kind: .calendar)
        case .team:
            A11ySettingsSurface(kind: .team)
        case .onCall:
            A11ySettingsSurface(kind: .onCall)
        case .callingSettings:
            A11ySettingsSurface(kind: .calling)
        }
    }
}
#endif
