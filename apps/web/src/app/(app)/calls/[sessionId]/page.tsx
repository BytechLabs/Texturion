import { CallDetail } from "@/components/calls/call-detail";

export const metadata = {
  title: "Call",
};

/**
 * /calls/[sessionId] — #336. The permalink a call never had.
 *
 * Keyed on the Telnyx session id rather than the row id, because that is the
 * identifier every other call surface already speaks: the voicemail endpoint,
 * the live-call socket, and the Durable Object's own state. A URL built from
 * it is the one that can be handed between them, and the one both native
 * clients already carry in their ring-wake links.
 *
 * The server enforces #106 on the detail route itself rather than inheriting
 * it from the list — a permalink is the classic place a deny-list gets missed.
 */
export default async function CallPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <CallDetail sessionId={sessionId} />;
}
