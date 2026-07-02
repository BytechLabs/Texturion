/**
 * Phone display formatting (G10): numbers render `(416) 555-0182`,
 * E.164 stays under the hood, always.
 */
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!match) return e164;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}

/** Contact display name: name when present, formatted number otherwise (G4). */
export function contactDisplayName(
  contact: { name: string | null; phone_e164: string } | null | undefined,
): string {
  if (!contact) return "Unknown";
  return contact.name?.trim() ? contact.name : formatPhone(contact.phone_e164);
}
