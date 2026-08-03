import { ScheduledView } from "@/components/scheduled/scheduled-view";

export const metadata = {
  title: "Scheduled",
};

/**
 * /scheduled — #233's workspace-level view of every text queued to go out.
 *
 * A crew shares one inbox, so a follow-up the owner wrote on Sunday night is
 * invisible to the tech who answers the same customer on Monday. The issue
 * asks for this "so nobody is surprised"; this is where that stops being true.
 * The whole surface is the client view; this file is the route + title.
 */
export default function ScheduledPage() {
  return <ScheduledView />;
}
