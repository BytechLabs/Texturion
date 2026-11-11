import { redirect } from "next/navigation";

/** #755: the audit log moved to /settings/audit-log; old bookmarks and emailed links land there. */
export default function HistorySettingsRedirect() {
  redirect("/settings/audit-log");
}
