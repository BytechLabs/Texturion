import { normalizeNanpInput } from "@loonext/shared";

export function normalizeNanpPhone(input: string): string | null {
  return normalizeNanpInput(input, "us-ca");
}

/**
 * Input normalizers for the identity step (G10: formatted for humans,
 * canonical under the hood). Pure — unit-tested alongside the step machine.
 */

/** "mikesplumbing.com" → "https://mikesplumbing.com"; empty stays empty. */
export function normalizeWebsite(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
