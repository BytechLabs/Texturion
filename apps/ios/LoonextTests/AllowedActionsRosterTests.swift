import XCTest

/// #722 phase 3: every state machine the phone renders actions for is decoded
/// from `allowed_actions` by one model file and read by one screen file.
///
/// The API serves `allowed_actions` on each record and refuses an action that is
/// not in it, so a phone that keeps its own local check shows a button the
/// server will refuse. A machine named here whose model or screen no longer
/// mentions the field fails, and the machines the phone does not offer say why.
///
/// `packages/shared/src/state-machines/allowed-actions-roster.test.ts` holds the
/// list of machines that exist and names the same files, so a new machine fails
/// there until it has a row here.
final class AllowedActionsRosterTests: XCTestCase {
    private struct RosterRow {
        let machine: String
        let model: String
        let screen: String
    }

    private static let rows: [RosterRow] = [
        RosterRow(machine: "conversation", model: "Core/Model/Messaging.swift", screen: "Features/Inbox/InboxTab.swift"),
        RosterRow(machine: "conversation_visibility", model: "Core/Model/Messaging.swift", screen: "Support/RecordActions.swift"),
        // The retry button on a bubble and the menu item both read `Message.retryable`.
        RosterRow(machine: "message", model: "Core/Model/Messaging.swift", screen: "Core/Model/Messaging.swift"),
        RosterRow(machine: "task", model: "Core/Model/Tasks.swift", screen: "Features/Tasks/TaskRecordMenu.swift"),
        RosterRow(machine: "call", model: "Core/Model/Calls.swift", screen: "Features/Calls/CallsLogic.swift"),
        RosterRow(machine: "scheduled_message", model: "Core/Model/Messaging.swift", screen: "Features/Inbox/ScheduledSheet.swift"),
        RosterRow(machine: "quote", model: "Features/Quotes/QuotesApi.swift", screen: "Features/Quotes/ThreadQuotes.swift"),
        RosterRow(machine: "payment_request", model: "Features/Payments/PaymentsApi.swift", screen: "Features/Payments/ThreadPayments.swift"),
        RosterRow(machine: "subscription", model: "Core/Model/Core.swift", screen: "Features/Settings/BillingSection.swift"),
        RosterRow(machine: "workspace", model: "Core/Model/Core.swift", screen: "Features/Settings/BillingSection.swift"),
        RosterRow(machine: "registration", model: "Features/Settings/SettingsModels.swift", screen: "Features/Settings/RegistrationFixForm.swift"),
        RosterRow(machine: "port", model: "Features/Settings/SettingsModels.swift", screen: "Features/Settings/PortCards.swift"),
        RosterRow(machine: "phone_number", model: "Core/Model/Core.swift", screen: "Features/Settings/NumbersSection.swift"),
        RosterRow(machine: "text_enablement", model: "Features/Settings/SettingsModels.swift", screen: "Features/Settings/TextEnableCards.swift"),
        RosterRow(machine: "invite", model: "Core/Model/Team.swift", screen: "Features/Settings/TeamSection.swift"),
        RosterRow(machine: "data_export", model: "Features/Settings/SettingsModels.swift", screen: "Features/Settings/UsageExportCard.swift"),
    ]

    /// Machines with actions that the phone does not offer, and why.
    private static let notOffered: [String: String] = [
        "calendar_connection": "Calendar connections are connected and removed on the web; the phones do not manage them.",
        "calendar_link": "Calendar links are managed on the web; the phones do not manage them.",
    ]

    private func mentionsField(_ relative: String) throws -> Bool {
        let url = try UiPatternScan.sourceRoot().appendingPathComponent(relative)
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return false }
        return text.range(of: #"allowed_?[aA]ctions"#, options: .regularExpression) != nil
    }

    func testEveryMachineThePhoneRendersNamesAModelAndAScreenThatCarryAllowedActions() throws {
        var checked = 0
        var missing: [String] = []
        for row in Self.rows {
            for (role, path) in [("model", row.model), ("screen", row.screen)] {
                checked += 1
                if try !mentionsField(path) { missing.append("\(row.machine) \(role): \(path)") }
            }
        }
        // A roster that checks nothing reports clean.
        XCTAssertGreaterThan(checked, 0, "checked \(checked) files")
        XCTAssertEqual(missing, [], "checked \(checked) files; these lack allowed_actions")
    }

    func testTheMachinesAreListedOnceAndTheMachinesNotOfferedSayWhy() {
        let machines = Self.rows.map(\.machine)
        XCTAssertEqual(Set(machines).count, machines.count)
        XCTAssertFalse(machines.isEmpty, "no machine is offered by the phone")
        for (machine, reason) in Self.notOffered {
            XCTAssertFalse(machines.contains(machine), "\(machine) is both offered and not offered")
            XCTAssertGreaterThan(reason.count, 10, "\(machine) needs a reason")
        }
    }
}
