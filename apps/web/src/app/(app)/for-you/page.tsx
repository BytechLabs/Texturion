import { ForYouView } from "@/components/for-you/for-you-view";

export const metadata = {
  title: "For You",
};

/**
 * /for-you — the member focus queue (D23; docs/HOME-AND-VIEWS.md). The default
 * member landing (App-v2). A working queue, not a notification log: four
 * urgency-sorted sections (Waiting on you / Your tasks / Unread / owner-admin
 * Triage) derived from GET /v1/for-you, each linking straight to its thread or
 * task. The whole surface is the client view; this file is the route + title.
 */
export default function ForYouPage() {
  return <ForYouView />;
}
