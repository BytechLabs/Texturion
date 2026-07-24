import { COUNTRIES } from "@/lib/geo/countries";

/**
 * #214 — the option set for a country field's native typable autofill dropdown.
 * Pair it with an <input list={id}>: the browser renders a filter-as-you-type
 * suggestion list, while the field stays a plain text input (any value is still
 * accepted). Robust inside a Popover — no nested-overlay focus conflicts.
 */
export function CountryDatalist({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {COUNTRIES.map((country) => (
        <option key={country} value={country} />
      ))}
    </datalist>
  );
}
