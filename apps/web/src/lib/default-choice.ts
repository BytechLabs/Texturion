/**
 * #717: a picker with a "use the default" choice does not also offer the
 * default's own value as a second explicit choice, which would be two ways to
 * say one thing. The exception is a record already set explicitly to that
 * value: hiding it there would hide the state in force.
 *
 * An unknown default (still loading, or an older server) hides nothing.
 */
export function offeredBesideDefault<T>(
  value: T,
  defaultValue: T | null | undefined,
  stored: T | null | undefined,
): boolean {
  return value !== defaultValue || value === stored;
}
