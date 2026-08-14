import Foundation

/// #286 — saying that a number is missing, rather than letting it be missing.
///
/// Hand-port of `packages/shared/src/hidden-numbers-notice.ts`. Per-number
/// access (#106) filters the numbers list server-side, and the filter is
/// silent. A tech who knows the shop runs two lines, opens the list and finds
/// one, cannot tell a permission from a bug — and the person they ask is the
/// owner, who then has to work out they configured it deliberately.
///
/// A COUNT and nothing else: naming the number would undo the rule this
/// sentence exists to explain.
///
/// The wording lives in shared and is ported rather than reinvented, because
/// three clients describing one access rule three different ways is the #437
/// failure on the surface where a new member forms their first impression.
func hiddenNumbersNotice(_ hiddenCount: Int, locale: String? = nil) -> String? {
    if hiddenCount <= 0 { return nil }
    return AppStrings.translate(
        locale,
        hiddenCount == 1 ? "domain.hiddenNumbersOne" : "domain.hiddenNumbersMany",
        ["count": String(hiddenCount)]
    )
}
