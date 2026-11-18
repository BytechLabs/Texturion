import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";

import { unwrap } from "./http";

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
