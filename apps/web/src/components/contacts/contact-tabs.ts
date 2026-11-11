import type { ContactDetail } from "@/lib/api/types";

/**
 * #740: the contact page's sections, as the `?tab=` in its URL names them.
 * A desktop shows who they are beside what happened, so the left column is
 * always there and a tab only picks the right-hand list; `details` (also the
 * default) shows the first list, Activity, there. A phone has room for one
 * thing at a time: Details, Activity or Files, with Conversations, Calls and
 * Tasks one tap inside Activity.
 */
export const CONTACT_TABS = [
  "details",
  "activity",
  "conversations",
  "calls",
  "tasks",
  "files",
] as const;

export type ContactTab = (typeof CONTACT_TABS)[number];

/** The lists on the right of a desktop page. */
export type ContactPane = Exclude<ContactTab, "details">;

export const CONTACT_PANES: readonly ContactPane[] = [
  "activity",
  "conversations",
  "calls",
  "tasks",
  "files",
];

/** What a phone's top control offers. */
export type PhoneTab = "details" | "activity" | "files";

/** What sits inside a phone's Activity tab. */
export const PHONE_ACTIVITY_PANES: readonly ContactPane[] = [
  "activity",
  "conversations",
  "calls",
  "tasks",
];

export function parseContactTab(raw: string | null): ContactTab {
  return (CONTACT_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as ContactTab)
    : "details";
}

export function paneOf(tab: ContactTab): ContactPane {
  return tab === "details" ? "activity" : tab;
}

export function phoneTabOf(tab: ContactTab): PhoneTab {
  if (tab === "details" || tab === "files") return tab;
  return "activity";
}

export type DetailField = "business" | "address" | "email" | "notes";

/**
 * The detail fields nobody has filled in. They sit behind "Add details"
 * instead of taking a row each; the name and the numbers always show, since
 * they are what the record is.
 */
export function emptyDetailFields(contact: ContactDetail): DetailField[] {
  const blank = (value: string | null | undefined) => !value?.trim();
  const empty: DetailField[] = [];
  if (blank(contact.business_name)) empty.push("business");
  if (blank(contact.address) && !(contact.addresses?.length ?? 0)) {
    empty.push("address");
  }
  if (blank(contact.email)) empty.push("email");
  if (blank(contact.notes)) empty.push("notes");
  return empty;
}
