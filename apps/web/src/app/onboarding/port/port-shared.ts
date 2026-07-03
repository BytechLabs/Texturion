import { apiFetch } from "@/lib/api/client";
import type { PortabilityCheck } from "@/lib/api/types";

/**
 * Small shared helpers for the port sub-wizard. The portability check route
 * (POST /v1/port-requests/check) is company-scoped (X-Company-Id + owner/admin),
 * so the port flow creates the company first (with the ported number's own area
 * code defaulting `requested_area_code`, PORTING.md correction 2) and only then
 * runs the check — the check is still pre-payment (the company is `incomplete`),
 * which D16 permits for this one read-only Telnyx call.
 */

/** Normalize a typed phone (any format) to +1E.164, or null if not NANP. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  if (!ten) return null;
  // NANP local: NXX-NXX-XXXX, area + exchange first digit 2–9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

/** The 3-digit area code (NPA) of a +1E.164 number — the company-creation default. */
export function areaCodeOf(e164: string): string {
  const match = /^\+1(\d{3})/.exec(e164);
  return match ? match[1] : "";
}

/** POST /v1/port-requests/check for an explicit company id (onboarding). */
export function apiFetchCheck(
  companyId: string,
  phoneE164: string,
): Promise<PortabilityCheck> {
  return apiFetch<PortabilityCheck>("/v1/port-requests/check", {
    method: "POST",
    companyId,
    body: { phone_e164: phoneE164 },
  });
}
