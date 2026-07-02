/**
 * Checkout gate helper (SPEC §4.1 step 4, §9): a company that owes US
 * registration (US, or CA with `us_texting_enabled=true`) must have a
 * SUBMITTABLE brand + campaign pair before it may reach payment — the
 * `checkout.session.completed` handler relies on this gate when it submits
 * the 10DLC registration.
 */

export interface RegistrationRow {
  kind: "brand" | "campaign";
  status: "draft" | "submitted" | "pending" | "approved" | "rejected";
  sole_proprietor: boolean;
  data: Record<string, unknown>;
}

/** A company owes the US-registration flow (SPEC §4.2 table). */
export function owesUsRegistration(company: {
  country: string;
  us_texting_enabled: boolean;
}): boolean {
  return (
    company.country === "US" ||
    (company.country === "CA" && company.us_texting_enabled)
  );
}

function present(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Field names follow the SPEC §4.4 wizard→Telnyx payload mapping — the wizard
 * stores the brand/campaign payloads under those canonical keys. `website` is
 * optional (sole prop may omit it, §4.1 step 3).
 */
function brandDataComplete(row: RegistrationRow): boolean {
  const { data } = row;
  const common = ["displayName", "email", "phone", "vertical", "street", "city", "state", "postalCode", "country"];
  if (!common.every((key) => present(data, key))) return false;
  if (row.sole_proprietor) {
    // Sole Proprietor path: name + last-4 identifier + OTP mobile (§4.4).
    return ["firstName", "lastName", "ein", "mobilePhone"].every((key) =>
      present(data, key),
    );
  }
  return ["companyName", "ein"].every((key) => present(data, key));
}

function campaignDataComplete(row: RegistrationRow): boolean {
  return ["messageFlow", "sample1", "sample2"].every((key) =>
    present(row.data, key),
  );
}

/**
 * A row is submittable when it either already went through submission
 * (`submitted`/`pending`/`approved` — covers resubscribes, where the §4.4
 * reactivation path reuses the existing rows) or is a `draft`/`rejected` row
 * whose wizard data carries every field the §4.4 Telnyx payload requires.
 */
function submittable(row: RegistrationRow): boolean {
  if (
    row.status === "submitted" ||
    row.status === "pending" ||
    row.status === "approved"
  ) {
    return true;
  }
  return row.kind === "brand"
    ? brandDataComplete(row)
    : campaignDataComplete(row);
}

/** True when both the brand and campaign rows exist and are submittable. */
export function registrationDraftComplete(
  rows: readonly RegistrationRow[],
): boolean {
  const brand = rows.find((row) => row.kind === "brand");
  const campaign = rows.find((row) => row.kind === "campaign");
  return (
    brand !== undefined &&
    campaign !== undefined &&
    submittable(brand) &&
    submittable(campaign)
  );
}
