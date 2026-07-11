import { CallsView } from "@/components/calls/calls-view";

export const metadata = {
  title: "Calls",
};

/**
 * /calls — the #129 call log (docs/CALLS-FEATURE.md P3): every inbound call
 * to a business number, newest first, with outcome and talk time, linking
 * into the conversation it threaded into. A calm scrolling document (the
 * for-you shape, not the inbox fixed frame); the server applies the #106
 * number-access deny list. The whole surface is the client view; this file
 * is the route + title.
 */
export default function CallsPage() {
  return <CallsView />;
}
