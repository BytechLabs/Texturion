import { redirect } from "next/navigation";

/** #715: Scheduled is an inbox view now; old links and bookmarks land there. */
export default function ScheduledRedirect(): never {
  redirect("/inbox/scheduled");
}
