import type { Membership } from "@/lib/api/types";

/** Cookie persisting the active-workspace choice (G12 company context). */
export const COMPANY_COOKIE = "jt-company";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Pure: pick the active company from memberships + the persisted choice. */
export function resolveActiveCompanyId(
  memberships: readonly Membership[],
  persisted: string | null,
): string | null {
  if (memberships.length === 0) return null;
  if (
    persisted !== null &&
    memberships.some((m) => m.company_id === persisted)
  ) {
    return persisted;
  }
  return memberships[0].company_id;
}

/** Pure: extract a cookie value from a `document.cookie` string. */
export function parseCookieValue(
  cookieHeader: string,
  name: string,
): string | null {
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("=")) || null;
  }
  return null;
}

export function readCompanyCookie(): string | null {
  if (typeof document === "undefined") return null;
  return parseCookieValue(document.cookie, COMPANY_COOKIE);
}

export function writeCompanyCookie(companyId: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COMPANY_COOKIE}=${encodeURIComponent(companyId)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}
