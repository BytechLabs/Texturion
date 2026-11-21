import { RemindersPageBody } from "@/components/marketing/reminders-page";
import { remindersFr } from "@/i18n/marketing/reminders";
import { buildMetadata } from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";
import { localizedPath } from "@/lib/marketing/translated-pages";

export const metadata = buildMetadata({
  title: remindersFr.metaTitle,
  description: remindersFr.metaDescription,
  path: localizedPath(LIVE_ROUTES.featuresReminders, "fr-CA"),
});

export default function RemindersPageFr() {
  return <RemindersPageBody locale="fr-CA" />;
}
