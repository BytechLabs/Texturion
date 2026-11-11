/**
 * #722: whether the server lets this member take `action` on the workspace
 * now (subscribe, update_payment_method, resubscribe, pause, resume, close).
 * An older server sends no list, and then the existing behaviour stands.
 */
export function companyAllows(
  company: { allowed_actions?: readonly string[] } | null | undefined,
  action: string,
): boolean {
  return company?.allowed_actions?.includes(action) ?? true;
}
