import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";

import { ApiError } from "../../http/errors";
import { unwrap } from "./http";
import { normalizeNanpPhone } from "./phone";

const NUMBER_OWNER_CONFLICT = "Number is already assigned to a contact";

export interface ContactNumberOwner {
  requested_number: string;
  id: string;
  phone_e164: string;
  name: string | null;
  deleted_at: string | null;
}

export async function contactNumberOwners(db: SupabaseClient, companyId: string, phones: string[]) {
  return unwrap<ContactNumberOwner[]>(await db.rpc("api_contact_number_owners", {
    p_company_id: companyId,
    p_numbers: phones,
  }), "contact number owners");
}

export async function contactNumberOwner(db: SupabaseClient, companyId: string, phone: string) {
  return (await contactNumberOwners(db, companyId, [phone]))[0] ?? null;
}

export async function selectedContactNumber(db: SupabaseClient, companyId: string, contactId: string, requested: string) {
  const phone = normalizeNanpPhone(requested);
  if (!phone) throw new ApiError("validation_failed", "Use a valid US or Canadian phone number.");
  const owner = await contactNumberOwner(db, companyId, phone);
  if (owner?.id !== contactId || owner.deleted_at) {
    throw new ApiError("validation_failed", "That number is not on this contact.");
  }
  return phone;
}

export function contactNumberConflict(error: { code?: string; message: string; details?: string } | null) {
  if (error?.code === "23505" && error.message === NUMBER_OWNER_CONFLICT) return error.details ?? null;
  return null;
}

export function contactNumberTaken(c: Context, ownerId: string) {
  return c.json({
    error: {
      code: "validation_failed",
      message: "That number is already on file under another contact.",
      existing_contact_id: ownerId,
    },
  }, 422);
}
