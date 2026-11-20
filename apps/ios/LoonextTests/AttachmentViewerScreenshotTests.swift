import SwiftUI
import UIKit
import XCTest

@testable import Loonext

@MainActor
final class AttachmentViewerScreenshotTests: XCTestCase {
    func testPhotoViewerInBothThemes() {
        DesignFonts.register()
        let bounds = CGRect(x: 0, y: 0, width: 390, height: 844)
        let photoSize = CGSize(width: 640, height: 480)
        let photo = UIGraphicsImageRenderer(size: photoSize).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(origin: .zero, size: photoSize))
            UIColor.systemOrange.setFill()
            context.cgContext.fillEllipse(in: CGRect(x: 145, y: 65, width: 350, height: 350))
        }
        let themes: [(String, ColorScheme, UIUserInterfaceStyle)] = [
            ("light", .light, .light),
            ("dark", .dark, .dark)
        ]

        for (name, scheme, style) in themes {
            let root = AttachmentViewer(
                label: "Photo",
                contentType: "image/jpeg",
                previewImage: Image(uiImage: photo),
                mintOriginal: {
                    try await Task.sleep(for: .seconds(60))
                    throw CancellationError()
                }
            )
            .environment(\.appLocale, "en")
            .environment(\.colorScheme, scheme)
            let host = UIHostingController(rootView: root)
            let window = UIWindow(frame: bounds)
            window.overrideUserInterfaceStyle = style
            window.rootViewController = host
            window.isHidden = false
            host.view.frame = bounds
            host.view.layoutIfNeeded()

            let screenshot = UIGraphicsImageRenderer(bounds: bounds).image { _ in
                XCTAssertTrue(host.view.drawHierarchy(in: bounds, afterScreenUpdates: true))
            }
            let attachment = XCTAttachment(image: screenshot)
            attachment.name = "attachment-viewer-\(name)"
            attachment.lifetime = .keepAlways
            add(attachment)
            window.isHidden = true
            window.rootViewController = nil
        }
    }
}
