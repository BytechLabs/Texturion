import type { SettingsSectionId } from "./settings-visibility";

/**
 * #727: the settings sections in their groups, in display order, on every
 * client. Every section is in exactly one group.
 *
 * The business's groups come first, so an owner still lands on Workspace; a
 * member who can open none of them lands on Profile, the first of their own.
 */
export type SettingsGroupId =
  | "workspace"
  | "messages"
  | "phone"
  | "billing"
  | "you"
  | "developers"
  | "support";

export const SETTINGS_GROUPS: readonly {
  id: SettingsGroupId;
  sections: readonly SettingsSectionId[];
}[] = [
  { id: "workspace", sections: ["workspace", "team", "ai"] },
  // Hours, the away reply and automatic texts share the "hours" section id.
  { id: "messages", sections: ["hours", "templates"] },
  { id: "phone", sections: ["numbers", "calling", "blockedNumbers"] },
  // Members land on Notifications and bookkeepers on Usage, as they did
  // before the groups: the first section of a group is where its role lands.
  { id: "billing", sections: ["usage", "billing", "payments"] },
  { id: "you", sections: ["notifications", "profile", "account", "devices"] },
  { id: "developers", sections: ["webhooks", "apiKeys"] },
  { id: "support", sections: ["history", "help", "whatsNew"] },
];

/** The group a section is shown under. */
export function settingsGroupOf(section: SettingsSectionId): SettingsGroupId {
  const group = SETTINGS_GROUPS.find((g) => g.sections.includes(section));
  if (!group) throw new Error(`settings section ${section} is in no group`);
  return group.id;
}

/**
 * Sections sorted into group order. Sections that share an id (Hours and
 * Automatic texts) keep the order they were given in.
 */
export function inSettingsGroupOrder<T>(
  sections: readonly T[],
  idOf: (section: T) => SettingsSectionId,
): T[] {
  const rank = (section: T) => {
    const id = idOf(section);
    const group = SETTINGS_GROUPS.findIndex((g) => g.sections.includes(id));
    return group * 100 + SETTINGS_GROUPS[group]!.sections.indexOf(id);
  };
  return sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index)
    .map(({ section }) => section);
}
