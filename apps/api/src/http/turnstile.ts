/**
 * The captcha check, once.
 *
 * Two copies of this existed before #232 needed a third — `routes/contact.ts`
 * and `routes/marketing.ts` — and they had already drifted in two ways that
 * make the case better than tidiness does:
 *
 *   * one posted `application/x-www-form-urlencoded` and the other JSON;
 *   * one refused a non-200 from Cloudflare explicitly, the other relied on
 *     the JSON parse to fail and reach the same verdict by accident.
 *
 * Both happen to fail CLOSED today, which is the only reason the drift was
 * harmless — and "harmless because both accidents landed the same way" is not
 * a property anybody checked or would notice changing.
 *
 * The form encoding is Cloudflare's documented shape and is what stays.
 */

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Is this token a real one?
 *
 * FAILS CLOSED on every uncertainty — a non-200, an unparseable body, a
 * network error. A captcha that passes when the verifier is unreachable is a
 * captcha an attacker can disable by making it unreachable, and every caller
 * of this is a public endpoint that spends money or stores a stranger's data.
 *
 * `remoteip` is sent only when the edge actually stamped one. Cloudflare treats
 * a bad remoteip as a failure, so passing the literal string "unknown" would
 * refuse every request from a caller we could not locate.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string,
): Promise<boolean> {
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        ...(ip !== "unknown" ? { remoteip: ip } : {}),
      }),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { success?: unknown };
    return payload.success === true;
  } catch {
    return false;
  }
}
