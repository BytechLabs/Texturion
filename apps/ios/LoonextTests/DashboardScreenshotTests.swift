import Foundation
import SwiftUI
import UIKit
import XCTest

@testable import Loonext

/// #540 — real pixels for the iOS dashboard, produced by the simulator test host.
///
/// This is deliberately not a golden-image test. The assertions keep the harness
/// honest (the view laid out, scrolled, changed size for Dynamic Type, and painted
/// more than a flat background); the kept XCTAttachments are for a person to look
/// at. Font rasterisation changing with an Xcode image must not turn visual review
/// into approving a regenerated baseline without looking.
@MainActor
final class DashboardScreenshotTests: XCTestCase {
    private struct Variant {
        let name: String
        let interfaceStyle: UIUserInterfaceStyle
        let contentSize: UIContentSizeCategory
        let colorScheme: ColorScheme
        let dynamicTypeSize: DynamicTypeSize
    }

    private struct RenderResult {
        let contentHeight: CGFloat
        let pageCount: Int
    }

    private let variants = [
        Variant(
            name: "light-normal",
            interfaceStyle: .light,
            contentSize: .large,
            colorScheme: .light,
            dynamicTypeSize: .large
        ),
        Variant(
            name: "dark-normal",
            interfaceStyle: .dark,
            contentSize: .large,
            colorScheme: .dark,
            dynamicTypeSize: .large
        ),
        Variant(
            name: "light-accessibility",
            interfaceStyle: .light,
            contentSize: .accessibilityExtraExtraExtraLarge,
            colorScheme: .light,
            dynamicTypeSize: .accessibility5
        ),
        Variant(
            name: "dark-accessibility",
            interfaceStyle: .dark,
            contentSize: .accessibilityExtraExtraExtraLarge,
            colorScheme: .dark,
            dynamicTypeSize: .accessibility5
        ),
    ]

    func testRepresentativeDashboardInBothThemesAndTextSizes() throws {
        // LoonextApp normally does this before its first frame. This test builds
        // the shipped view directly, so it owns the same setup explicitly.
        DesignFonts.register()

        var rendered: [String: RenderResult] = [:]
        for variant in variants {
            let result = try render(variant)
            rendered[variant.name] = result
            XCTAssertGreaterThan(
                result.pageCount,
                1,
                "\(variant.name) did not exercise the dashboard's scroll layout"
            )
        }

        // A filename saying “accessibility” is not evidence that the trait
        // reached the view. The full dashboard must become materially taller;
        // otherwise the large-text screenshots are duplicates wearing new names.
        let lightNormal = try XCTUnwrap(rendered["light-normal"])
        let lightAccessibility = try XCTUnwrap(rendered["light-accessibility"])
        let darkNormal = try XCTUnwrap(rendered["dark-normal"])
        let darkAccessibility = try XCTUnwrap(rendered["dark-accessibility"])
        XCTAssertGreaterThan(
            lightAccessibility.contentHeight,
            lightNormal.contentHeight * 1.15,
            "the light accessibility render did not grow with Dynamic Type"
        )
        XCTAssertGreaterThan(
            darkAccessibility.contentHeight,
            darkNormal.contentHeight * 1.15,
            "the dark accessibility render did not grow with Dynamic Type"
        )
    }

    private func render(_ variant: Variant) throws -> RenderResult {
        let dashboard = try dashboardFixture()
        let root = AnyView(
            dashboard
                // AppStrings reads this environment; Locale also fixes any
                // system formatting used by dates and numbers in the rows.
                .environment(\.appLocale, "en")
                .environment(\.locale, Locale(identifier: "en_CA"))
                // The UIKit trait below is the real OS channel. These explicit
                // SwiftUI values are also required because custom relative fonts
                // read DynamicTypeSize directly.
                .environment(\.colorScheme, variant.colorScheme)
                .environment(\.dynamicTypeSize, variant.dynamicTypeSize)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(BrandColor.canvas.ignoresSafeArea())
                .transaction { transaction in
                    transaction.disablesAnimations = true
                }
        )

        let host = UIHostingController(rootView: root)
        let container = UIViewController()
        let window = makeWindow()
        window.overrideUserInterfaceStyle = variant.interfaceStyle
        container.overrideUserInterfaceStyle = variant.interfaceStyle
        host.overrideUserInterfaceStyle = variant.interfaceStyle

        window.rootViewController = container
        container.addChild(host)
        host.view.frame = container.view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.view.addSubview(host.view)
        host.didMove(toParent: container)

        // `Font.custom(... relativeTo:)` follows SwiftUI's DynamicTypeSize;
        // `Font.scaled(...)` uses UIFontMetrics. Override both channels so the
        // accessibility render tests the whole design system rather than only
        // whichever font factory happened to be used on a given line.
        let traits = UITraitCollection(traitsFrom: [
            UITraitCollection(userInterfaceStyle: variant.interfaceStyle),
            UITraitCollection(preferredContentSizeCategory: variant.contentSize),
        ])
        container.setOverrideTraitCollection(traits, forChild: host)

        window.isHidden = false
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        settle(window)
        let scrollView = try XCTUnwrap(
            descendants(of: UIScrollView.self, in: host.view)
                .max(by: { $0.contentSize.height < $1.contentSize.height }),
            "ForYouList no longer exposes a rendered ScrollView"
        )
        XCTAssertGreaterThan(scrollView.bounds.height, 0, "the dashboard viewport has no height")
        XCTAssertGreaterThan(
            scrollView.contentSize.height,
            scrollView.bounds.height,
            "the full fixture unexpectedly fits in one viewport"
        )

        let offsets = pageOffsets(for: scrollView)
        for (index, offset) in offsets.enumerated() {
            scrollView.setContentOffset(CGPoint(x: 0, y: offset), animated: false)
            settle(window)

            let image = capture(host.view, scale: window.screen.scale)
            XCTAssertGreaterThan(image.size.width, 300, "\(variant.name) rendered no phone width")
            XCTAssertGreaterThan(image.size.height, 500, "\(variant.name) rendered no phone height")
            XCTAssertTrue(
                hasMoreThanOneColour(image),
                "\(variant.name) page \(index + 1) is one flat colour; nothing drew"
            )

            let page = String(format: "%02d", index + 1)
            let attachment = XCTAttachment(image: image)
            attachment.name = "dashboard-\(variant.name)-page-\(page).png"
            attachment.lifetime = .keepAlways
            add(attachment)
        }

        return RenderResult(
            contentHeight: scrollView.contentSize.height,
            pageCount: offsets.count
        )
    }

    /// Use the simulator's real viewport and safe-area geometry. Hosted unit
    /// tests normally have a UIWindowScene; the frame-only fallback keeps a
    /// missing scene loud in the image assertions instead of skipping green.
    private func makeWindow() -> UIWindow {
        if let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first {
            let window = UIWindow(windowScene: scene)
            window.frame = scene.screen.bounds
            return window
        }
        return UIWindow(frame: UIScreen.main.bounds)
    }

    private func settle(_ view: UIView) {
        view.setNeedsLayout()
        view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        view.layoutIfNeeded()
    }

    private func descendants<T: UIView>(of type: T.Type, in root: UIView) -> [T] {
        var result = root.subviews.compactMap { $0 as? T }
        for child in root.subviews {
            result.append(contentsOf: descendants(of: type, in: child))
        }
        return result
    }

    /// Twenty-percent overlap prevents a row split exactly at a page boundary
    /// from disappearing between two otherwise-valid screenshots.
    private func pageOffsets(for scrollView: UIScrollView) -> [CGFloat] {
        let top = -scrollView.adjustedContentInset.top
        let bottom = max(
            top,
            scrollView.contentSize.height
                - scrollView.bounds.height
                + scrollView.adjustedContentInset.bottom
        )
        guard bottom > top + 1 else { return [top] }

        let step = max(1, scrollView.bounds.height * 0.8)
        var offsets = [top]
        var next = top + step
        while next < bottom - 1 {
            offsets.append(next)
            next += step
        }
        if let last = offsets.last, abs(last - bottom) > 1 {
            offsets.append(bottom)
        }
        return offsets
    }

    private func capture(_ view: UIView, scale: CGFloat) -> UIImage {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = scale
        format.opaque = true
        return UIGraphicsImageRenderer(bounds: view.bounds, format: format).image { context in
            // drawHierarchy is closest to what the simulator presents. The
            // layer fallback keeps an offscreen host from producing a blank PNG
            // if UIKit declines that path before a key window exists.
            if !view.drawHierarchy(in: view.bounds, afterScreenUpdates: true) {
                view.layer.render(in: context.cgContext)
            }
        }
    }

    /// Sample into a known RGBA buffer. Merely receiving UIImage proves only
    /// that a background filled its bounds; two colours proves a mark, glyph,
    /// divider, or surface actually painted.
    private func hasMoreThanOneColour(_ image: UIImage) -> Bool {
        guard let source = image.cgImage else { return false }
        let side = 32
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        return pixels.withUnsafeMutableBytes { rawBuffer in
            guard let context = CGContext(
                data: rawBuffer.baseAddress,
                width: side,
                height: side,
                bitsPerComponent: 8,
                bytesPerRow: side * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                    | CGBitmapInfo.byteOrder32Big.rawValue
            ) else { return false }
            context.interpolationQuality = .low
            context.draw(source, in: CGRect(x: 0, y: 0, width: side, height: side))

            let bytes = rawBuffer.bindMemory(to: UInt8.self)
            guard bytes.count >= 8 else { return false }
            let first = (bytes[0], bytes[1], bytes[2], bytes[3])
            for index in stride(from: 4, to: bytes.count, by: 4) {
                if bytes[index] != first.0
                    || bytes[index + 1] != first.1
                    || bytes[index + 2] != first.2
                    || bytes[index + 3] != first.3 {
                    return true
                }
            }
            return false
        }
    }

    // MARK: - A full, credential-free dashboard

    private func dashboardFixture() throws -> ForYouList {
        let now = Date()
        func wireDate(secondsAgo: TimeInterval) -> String {
            ISO8601DateFormatter().string(from: now.addingTimeInterval(-secondsAgo))
        }

        // Relative timestamps keep the priority order and the words on the rows
        // stable next month and next year. Fixed 2026 dates would eventually turn
        // every queue into the same “months ago” state and stop exercising #540.
        let forYou: ForYou = try decode(
            """
            {
              "follow_ups":[{
                "conversation_id":"conv-follow-up","status":"waiting",
                "contact":{"id":"contact-priya","name":"Priya Natarajan","phone_e164":"+14155560144"},
                "last_message_at":"\(wireDate(secondsAgo: 72 * 60 * 60))",
                "unread":false,"due_at":"\(wireDate(secondsAgo: 60 * 60))",
                "note":"Check whether the repipe estimate needs anything else"
              }],
              "waiting_on_you":[{
                "conversation_id":"conv-jake","status":"waiting",
                "contact":{"id":"contact-jake","name":"Jake Thompson","phone_e164":"+14155560122"},
                "assigned_user_id":"user-dana",
                "last_message_at":"\(wireDate(secondsAgo: 20 * 60 * 60))",
                "unread":true,"has_overdue_task":false,"urgency":1
              }],
              "my_tasks":[{
                "task_id":"task-overdue","title":"Confirm the expansion tank is in stock",
                "conversation_id":"conv-maria","message_id":"message-maria",
                "assigned_user_id":"user-dana",
                "due_at":"\(wireDate(secondsAgo: 2 * 60 * 60))","overdue":true
              }],
              "unread":[{
                "conversation_id":"conv-new-lead","status":"new",
                "contact":{"id":"contact-new","name":null,"phone_e164":"+14155560133"},
                "assigned_user_id":null,
                "last_message_at":"\(wireDate(secondsAgo: 20 * 60))"
              }],
              "triage":{
                "conversations":[{
                  "conversation_id":"conv-unassigned","status":"new",
                  "contact":{"id":"contact-leo","name":"Leo Martin","phone_e164":"+14155560155"},
                  "last_message_at":"\(wireDate(secondsAgo: 6 * 60 * 60))","unread":true
                }],
                "tasks":[{
                  "task_id":"task-unassigned","title":"Price the main-line repair",
                  "conversation_id":"conv-unassigned-task","message_id":"message-unassigned-task",
                  "due_at":"\(wireDate(secondsAgo: -24 * 60 * 60))","overdue":false
                }]
              },
              "totals":{
                "waiting_on_you":1,"my_tasks":1,"unread":1,
                "triage_conversations":1,"triage_tasks":1,"follow_ups":1,
                "distinct_work":6
              }
            }
            """
        )

        let responseTime: ResponseTimeReport = try decode(
            #"""
            {
              "window":{"days":30},"leads":12,"answered":9,"unanswered":3,
              "median_seconds":372,"p90_seconds":1840,
              "business_hours":{"leads":8,"answered":7,"median_seconds":240},
              "after_hours":{"leads":4,"answered":2,"median_seconds":780},
              "by_member":null,"by_number":[],"per_member_enabled":false,
              "baseline":{"leads":10,"answered":8,"median_seconds":900},
              "baseline_unavailable":null,"improved_by_seconds":528,
              "split_truncated":false,"split_row_limit":0
            }
            """#
        )
        let satisfaction: SatisfactionReport = try decode(
            #"""
            {
              "window":{"days":30},"asked":8,"answered":5,"average":4.6,
              "sample_too_small":false,"minimum_sample":3,
              "distribution":{"5":3,"4":2},"poor":0,
              "by_member":null,"per_member_enabled":false,"baseline":null,
              "improved_by":null,"truncated":false,"row_limit":0
            }
            """#
        )
        let pipeline: PipelineReportResponse = try decode(
            #"""
            {
              "days":30,
              "current":{"quoted":12,"won":4,"lost":2,"open":6,"median_days_to_win":3},
              "previous":{"quoted":8,"won":2,"lost":2,"open":4,"median_days_to_win":4},
              "win_rate":67,"previous_win_rate":50,
              "insight":"You win 67% of the quotes that get an answer. 6 quotes are still waiting on one."
            }
            """#
        )
        let leadSources: LeadSourceReport = try decode(
            #"""
            {
              "days":30,"widget":14,"unknown":3,"total":30,"coverage":0.9,
              "sources":[
                {"lead_source_id":"source-google","name":"Google","by_number":6,"by_person":2,"total":8},
                {"lead_source_id":"source-word","name":"Word of mouth","by_number":0,"by_person":5,"total":5}
              ]
            }
            """#
        )

        let calls: [Call] = try decode(
            """
            [{
              "id":"call-missed","call_session_id":"session-missed",
              "caller_e164":"+14155560144","contact_id":"contact-priya",
              "contact_name":"Priya Natarajan","caller_name":null,
              "phone_number_id":"number-main","conversation_id":"conv-follow-up",
              "outcome":"missed","direction":"inbound","forward_seconds":0,
              "screening_result":null,"stir_attestation":"A","voicemail_seconds":34,
              "answered_by_user_id":null,"answered_by_name":null,
              "started_at":"\(wireDate(secondsAgo: 75 * 60))"
            },{
              "id":"call-answered","call_session_id":"session-answered",
              "caller_e164":"+14155560111","contact_id":"contact-maria",
              "contact_name":"Maria Alvarez","caller_name":null,
              "phone_number_id":"number-main","conversation_id":"conv-maria",
              "outcome":"answered","direction":"inbound","forward_seconds":272,
              "screening_result":null,"stir_attestation":"A","voicemail_seconds":null,
              "answered_by_user_id":"user-dana","answered_by_name":"Dana Brightside",
              "started_at":"\(wireDate(secondsAgo: 3 * 60 * 60))"
            }]
            """
        )
        let outstandingQuotes: [Quote] = try decode(
            """
            [{
              "id":"quote-water-heater","conversation_id":"conv-maria",
              "contact_id":"contact-maria","amount_cents":185000,"currency":"usd",
              "description":"50-gallon water heater replacement","status":"sent",
              "sent_at":"\(wireDate(secondsAgo: 4 * 24 * 60 * 60))",
              "created_at":"\(wireDate(secondsAgo: 5 * 24 * 60 * 60))"
            }]
            """
        )

        let readState = CompanyReadState()
        readState.offerServerCount(3)
        var referral = ReferralMoment()
        referral.ask = true
        referral.customers = 12

        return ForYouList(
            forYou: forYou,
            spamReview: [
                SpamReviewItem(
                    conversation_id: "conv-spam-review",
                    contact: ContactSummary(
                        id: "contact-spam-review",
                        name: "Morgan Chen",
                        phone_e164: "+14155560166"
                    ),
                    marked_at: wireDate(secondsAgo: 2 * 24 * 60 * 60),
                    marked_by_user_id: "user-dana",
                    inbound_since: 4,
                    last_inbound_at: wireDate(secondsAgo: 35 * 60),
                    we_texted_them: true,
                    sustained: false,
                    high_volume: false
                )
            ],
            onAnswerSpamReview: { _, _ in },
            recentCalls: .ready(calls),
            outstandingQuotes: outstandingQuotes,
            chasedQuotes: [],
            onChaseQuote: { _, _ in },
            responseTime: responseTime,
            responseDays: 30,
            onResponseWindow: { _ in },
            satisfaction: satisfaction,
            referralMoment: referral,
            referralLink: nil,
            referralOpened: false,
            onOpenReferral: {},
            onDismissReferral: {},
            pipeline: pipeline,
            leadSources: leadSources,
            onOpenConversation: { _ in },
            readState: readState,
            onOpenNotifications: {},
            onOpenCalls: {},
            onRefresh: {},
            company: nil,
            onOpenContacts: {},
            onOpenSettings: { _ in },
            onOpenUnanswered: {},
            hidden: [],
            onCustomise: {}
        )
    }

    private func decode<T: Decodable>(_ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }
}
