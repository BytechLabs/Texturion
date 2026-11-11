import SwiftUI

/// #733: the three sizes a symbol is drawn at (web: 14, 16 and 20 px). Pass one to
/// `.font(.scaled(IconSize.small, weight: ...))`, so a symbol follows the reader's text
/// size like the words beside it.
///
/// - `small`: beside small text, a chevron on a row, a quiet inline mark.
/// - `standard`: the default symbol, in a button, a field or a row.
/// - `large`: a symbol that leads, in a header or a bar.
///
/// Not on these: a symbol under 10 pt sits inside a badge or a chip and is sized to it,
/// and one over 20 pt is an illustration or a hero glyph. `IconSizePatternGuardTests`
/// holds both lines, and names the one screen that sizes its own (the in-call controls).
enum IconSize {
    static let small: CGFloat = 12
    static let standard: CGFloat = 15
    static let large: CGFloat = 20
}
