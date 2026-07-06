import { redirect } from "next/navigation";

/**
 * Templates moved into the settings shell (Settings → Templates). This keeps
 * old links/bookmarks and the /templates deep link working by forwarding to the
 * canonical location.
 */
export default function TemplatesRedirect() {
  redirect("/settings/templates");
}
