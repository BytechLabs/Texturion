import Foundation

/// #717: a picker with a "use the default" choice does not also offer the
/// default's own value as a second explicit choice, which would be two ways to
/// say one thing. The exception is a record already set explicitly to that
/// value: hiding it there would hide the state in force.
///
/// An unknown default (still loading, or an older server) hides nothing.
///
/// Hand-port of `apps/web/src/lib/default-choice.ts`.
func offeredBesideDefault<T: Equatable>(
    _ value: T,
    default defaultValue: T?,
    stored: T?
) -> Bool {
    value != defaultValue || value == stored
}

/// `choices` with the default's own value dropped, unless it is `stored`.
func choicesBesideDefault<T: Equatable>(
    _ choices: [T],
    default defaultValue: T?,
    stored: T?
) -> [T] {
    choices.filter { offeredBesideDefault($0, default: defaultValue, stored: stored) }
}
