import { RemindersPageBody } from "@/components/marketing/reminders-page";
import { remindersEn } from "@/i18n/marketing/reminders";
import { buildMetadata } from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";

export const metadata = buildMetadata({
  title: remindersEn.metaTitle,
  description: remindersEn.metaDescription,
  path: LIVE_ROUTES.featuresReminders,
});

export default function RemindersPage() {
  return <RemindersPageBody locale="en" />;
}
