import { redirect } from "next/navigation";

/** #735: the Trash moved to /trash; old links and the phones' links land there. */
export default function TrashSettingsRedirect() {
  redirect("/trash");
}
