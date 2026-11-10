import { ScheduledView } from "@/components/scheduled/scheduled-view";

export const metadata = {
  title: "Scheduled",
};

/**
 * /inbox/scheduled: #233's view of every text queued to go out, as a view of
 * the inbox (#715). A crew shares one inbox, so a follow-up the owner wrote on
 * Sunday night is invisible to the tech who answers the same customer on
 * Monday; this is where that stops being true.
 */
export default function ScheduledPage() {
  return <ScheduledView />;
}
