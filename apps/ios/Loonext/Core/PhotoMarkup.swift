import CoreGraphics
import Foundation

/// #294 — an arrow and a circle on a photo.
///
/// The hand-port of `packages/shared/src/photo-markup.ts`.
///
/// The issue's own words: "an arrow and a circle on a photo beats a paragraph
/// explaining where to look, and takes three seconds instead of thirty."
///
/// ## Why it is drawn into the picture rather than stored beside it
///
/// D28 says attachments enter through exactly two doors and a task's files are a
/// derived view. An overlay stored as its own object would be a third thing to
/// upload, a third thing to keep in step with the photo, and a third thing that can
/// arrive without it. So the marks are burned into the bytes on the phone, and what
/// reaches the server is an ordinary note attachment that happens to have an arrow on
/// it — subject to every existing rule unchanged, because it is not a special file.
///
/// The original is not destroyed: it is still in the camera roll. What is replaced is
/// the STAGED copy, before it has been sent anywhere.
///
/// ## Why there is no colour picker
///
/// One colour, always, with a light halo behind it. A picker is a decision somebody
/// has to make while standing in a customer's kitchen with wet hands, and the reason
/// pickers exist — red vanishing against brick or rust — is solved better by the halo.
enum PhotoMarkup {

    static let arrow = "arrow"
    static let circle = "circle"

    /// The two marks. Anything more is a drawing app, which this is not.
    static let tools = [arrow, circle]

    static func label(_ tool: String) -> String {
        switch tool {
        case arrow: return "Arrow"
        case circle: return "Circle"
        default: return tool
        }
    }

    /// The one line of instruction, for somebody who has never opened this.
    static let hint = "Drag on the photo, or tap twice, to point at something."

    /// What it says once a first tap has landed.
    ///
    /// The tap-tap path is WCAG 2.5.7's requirement — every dragging movement needs a
    /// single-pointer alternative — and it only works if the person can tell the app
    /// is waiting for them rather than that their tap did nothing.
    static let hintSecondTap = "Now tap where it should point."

    /// Puts the marks on and closes.
    static let save = "Done"

    /// Takes the last mark off. One step is what a thumb wants.
    static let undo = "Undo"

    /// The mark: a strong red that reads as deliberate rather than decorative.
    static let ink: UInt32 = 0xE2_3D_28

    /// The halo drawn under it. White, and wider than the ink — this is what makes
    /// one fixed colour work on every photograph a trade takes.
    static let halo: UInt32 = 0xFF_FF_FF

    /// The same two colours as the strings the shared module holds.
    ///
    /// DERIVED rather than written out again: two literals for one colour is two
    /// places for a red to drift, and the parity test would then be comparing a
    /// constant against itself.
    static var inkHex: String { hex(ink) }
    static var haloHex: String { hex(halo) }

    private static func hex(_ value: UInt32) -> String {
        String(format: "#%06X", value)
    }

    /// The halo is drawn first, at this multiple of the ink's width.
    static let haloScale: CGFloat = 2.2

    private static let minStroke: CGFloat = 3
    private static let maxStroke: CGFloat = 18

    /// How thick to draw, for an image of this size.
    ///
    /// Proportional: a 3-pixel line on a 4000-pixel photo is invisible at the size
    /// anybody views it, and a 30-pixel line on a 600-pixel crop covers the thing it
    /// points at. Clamped at both ends.
    static func strokeWidth(width: CGFloat, height: CGFloat) -> CGFloat {
        let shortest = min(abs(width), abs(height))
        guard shortest.isFinite, shortest > 0 else { return minStroke }
        return max(minStroke, min(maxStroke, (shortest * 0.006).rounded()))
    }

    /// The two barbs of an arrowhead at `to`, for a shaft coming from `from`.
    ///
    /// The head is a fixed fraction of the shaft with a floor and a ceiling, so a
    /// short jab still gets a visible head and a long drag does not grow a comical
    /// one.
    static func arrowHead(
        from: CGPoint,
        to: CGPoint,
        stroke: CGFloat
    ) -> (CGPoint, CGPoint) {
        let dx = to.x - from.x
        let dy = to.y - from.y
        let length = (dx * dx + dy * dy).squareRoot()
        // A zero-length drag has no direction to point in. Returning the tip twice
        // draws nothing rather than dividing by zero and drawing NaN.
        guard length > 0 else { return (to, to) }

        let angle = atan2(dy, dx)
        let head = max(stroke * 3, min(length * 0.32, stroke * 9))
        // 28 degrees either side.
        let spread: CGFloat = 0.49
        return (
            CGPoint(
                x: to.x - head * cos(angle - spread),
                y: to.y - head * sin(angle - spread)
            ),
            CGPoint(
                x: to.x - head * cos(angle + spread),
                y: to.y - head * sin(angle + spread)
            )
        )
    }

    /// The ellipse a circle mark occupies, from the two corners of the drag.
    static func circleFromDrag(from: CGPoint, to: CGPoint) -> CGRect {
        CGRect(
            x: min(from.x, to.x),
            y: min(from.y, to.y),
            width: abs(to.x - from.x),
            height: abs(to.y - from.y)
        )
    }

    /// Is this drag big enough to have been meant?
    ///
    /// A tap while looking at a photo should not leave a dot on a customer's job
    /// record. Measured against the image rather than in absolute pixels, so the same
    /// flick means the same thing on a phone photo and a DSLR one.
    static func isDeliberateDrag(
        from: CGPoint,
        to: CGPoint,
        width: CGFloat,
        height: CGFloat
    ) -> Bool {
        let shortest = min(abs(width), abs(height))
        guard shortest.isFinite, shortest > 0 else { return false }
        let dx = to.x - from.x
        let dy = to.y - from.y
        return (dx * dx + dy * dy).squareRoot() >= shortest * 0.03
    }

    /// What the file is called once it has marks on it.
    static func markedUpFileName(_ original: String) -> String {
        let trimmed = original.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "marked-up.jpg" }
        // Always .jpg: the phone re-encodes to JPEG, so keeping a .png extension on
        // JPEG bytes would be a lie the type check downstream would then catch.
        var stem = trimmed
        if let dot = trimmed.lastIndex(of: "."), dot != trimmed.startIndex {
            let after = trimmed[trimmed.index(after: dot)...]
            // Non-empty, and no separator: the same rule the shared regex uses,
            // so "photo." keeps its dot on every client rather than on two of three.
            if !after.isEmpty, !after.contains("/"), !after.contains("\\") {
                stem = String(trimmed[..<dot])
            }
        } else if trimmed.hasPrefix(".") {
            stem = ""
        }
        return stem.isEmpty ? "photo-marked.jpg" : "\(stem)-marked.jpg"
    }
}

/// One mark on a photo, in image pixels.
struct PhotoMark: Identifiable {
    let id = UUID()
    let tool: String
    let from: CGPoint
    var to: CGPoint
}
