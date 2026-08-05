import Foundation

/// Does this line of Swift TYPE a price, rather than format one?
///
/// EXTRACTED BECAUSE IT IS NOW READ BY TWO SCREENS. It began as a private
/// method of `CancelOneActionTests`, watching the billing screen and the pause
/// copy. #522 needed the same question asked of `RegistrationCard.swift`, whose
/// enable-US card carried a flat "$29" in three sentences shown only to a
/// workspace billed in CAD — and a second hand-written copy of this walk is
/// exactly the kind of near-duplicate that drifts. One implementation, two
/// callers.
///
/// # Why it is a walk and not a regular expression
///
/// It has to tell three different `$` apart, and only one of them is money:
///
///   `$confirming`  a SwiftUI binding, outside any literal
///   `$0`           a closure parameter — and it appears INSIDE interpolation
///                  inside a literal, as in `" \(relativeTime($0)) ago"`
///   `$29`          a price
///
/// The obvious pattern — a quote, then anything, then `$` and a digit — was
/// written first for #522 and fired on `RegistrationRow`'s relative-date
/// sentences, which contain no money at all. Interpolation is `\(…)`, so the
/// walk enters it on the escape, counts parentheses out again, and only asks
/// the money question about characters that are literal text. That is the whole
/// difference between "reads the copy" and "reads the source".
///
/// Whitespace and comments are the caller's business: pass
/// `typesAPrice(code(line))` so a whole-line comment about pricing is prose
/// rather than an offence.
func typesAPrice(_ line: String) -> Bool {
    let characters = Array(line)
    var inString = false
    var interpolation = 0
    var index = 0
    while index < characters.count {
        let character = characters[index]
        if inString, character == "\\", index + 1 < characters.count,
           characters[index + 1] == "(" {
            interpolation += 1
            index += 2
            continue
        }
        if inString, interpolation > 0 {
            if character == "(" { interpolation += 1 }
            if character == ")" { interpolation -= 1 }
            index += 1
            continue
        }
        if character == "\\" {
            index += 2
            continue
        }
        if character == "\"" {
            inString.toggle()
            index += 1
            continue
        }
        if inString, character == "$", index + 1 < characters.count,
           characters[index + 1].isNumber {
            return true
        }
        index += 1
    }
    return false
}
