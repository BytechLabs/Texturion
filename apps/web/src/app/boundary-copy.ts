import { boundariesEn } from "@/i18n/sections/boundaries";
import { commonEn } from "@/i18n/sections/common";

/**
 * What the two root error boundaries say, in English: they render outside
 * every LocaleProvider (sections/boundaries.ts), so `useT()` only ever
 * answered English there. They read the sections directly because importing
 * `@/i18n/provider` ships the whole two-language app catalogue (about 590 KB)
 * with the root layout, on every page. The keys are the catalogue's, so going
 * back to `t("misc.…")` once a provider sits above them is a rename.
 */
export const boundaryCopy = {
  ...boundariesEn,
  retry: commonEn.retry,
} as const;

/** `misc.errorReference` with the digest filled in. */
export function boundaryReference(digest: string): string {
  return boundariesEn.errorReference.split("{digest}").join(digest);
}
