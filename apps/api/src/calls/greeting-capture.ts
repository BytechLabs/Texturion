/**
 * #309 — "Call me and I'll record it".
 *
 * The last path in the issue's Scope: a greeting recorded over the phone
 * rather than in the app, for the owners least likely to hold a handset at
 * arm's length and grant a microphone permission.
 *
 * ## Why this rings the owner instead of the owner ringing us
 *
 * Scope words it as "call a number, record, hang up". This inverts it: one tap
 * in the app dials the owner's mobile, they speak after the beep and hang up.
 * Three reasons, and the first is the one that decides it.
 *
 * - **An inbound record-this number is a number anyone can call.** Identifying
 *   the workspace by caller ID means a spoofed caller ID rewrites a business's
 *   greeting — the most customer-visible string we hold. Every mitigation (a
 *   PIN, a number per workspace) rebuilds the authentication the app session
 *   already performed.
 * - **It carries no standing surface and costs less.** An outbound leg exists
 *   for the seconds it is used; an inbound number is provisioned, billed, and
 *   reachable forever.
 * - **It still answers the issue's reason.** What those owners will not do is
 *   RECORD in an app. Answering a call and talking is precisely what they are
 *   comfortable with, and the tap that starts it is the one they already use to
 *   open the settings screen.
 *
 * If the intent was a path that needs no app at all, the inbound number is the
 * only shape that satisfies it and this is the wrong build — flagged on the
 * issue before writing it.
 */

/**
 * client_state on a greeting-capture leg: `vgc|<companyId>|<name>`.
 *
 * The name rides the tag rather than a database row because the call IS the
 * whole transaction: nothing is written until the recording lands, so a call
 * the owner abandons leaves nothing to clean up. It takes the remainder of the
 * string for the same reason the inbound-ring tags put their pipe-risky field
 * last — a greeting called "After hours | holidays" must not shift the parse.
 */
export const GREETING_CAPTURE_STATE = "vgc";

export interface GreetingCaptureTag {
  companyId: string;
  name: string;
}

function b64encode(value: string): string {
  return btoa(value);
}

export function buildGreetingCaptureState(companyId: string, name: string): string {
  return b64encode(`${GREETING_CAPTURE_STATE}|${companyId}|${name}`);
}

/**
 * Parse a greeting-capture tag, or null for anything else.
 *
 * Null on ANY doubt: an unrecognised tag must fall through to the ordinary
 * routing rules rather than being treated as a capture leg. A forged tag can
 * only ever name a company id, and every write below is scoped by it — the
 * greeting lands in the workspace the tag names, which is the workspace whose
 * signed-in member asked for the call.
 */
export function parseGreetingCaptureState(
  clientState: string | null | undefined,
): GreetingCaptureTag | null {
  if (!clientState) return null;
  let decoded: string;
  try {
    decoded = atob(clientState);
  } catch {
    return null;
  }
  const [prefix, companyId, ...rest] = decoded.split("|");
  if (prefix !== GREETING_CAPTURE_STATE) return null;
  if (!companyId || !UUID.test(companyId)) return null;
  const name = rest.join("|").trim();
  if (!name || name.length > 60) return null;
  return { companyId, name };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
