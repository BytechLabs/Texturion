import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import type { Env } from "../env";
import { removeExportObjects } from "../workspace/export";
import { purgeTrashItem } from "./purge";

const CUSTOMERS_PER_RUN = 10;
const RECORDS_PER_CUSTOMER = 25;
const EXPORTS_PER_CUSTOMER = 5;

interface ErasureTarget {
  kind: "conversation" | "call" | "task";
  id: string;
}

export async function processCustomerErasures(env: Env): Promise<{ completed: number }> {
  const db = getDb(env);
  const due = await db.rpc("api_customer_erasures_due", { p_limit: CUSTOMERS_PER_RUN });
  if (due.error) throw new Error(`Customer erasure scan failed: ${due.error.message}`);

  let completed = 0;
  const failures: unknown[] = [];
  for (const contact of (due.data ?? []) as { id: string; company_id: string }[]) {
    try {
      if (await eraseCustomerBatch(db, contact.company_id, contact.id)) completed += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Customer erasure failed");
  return { completed };
}

async function eraseCustomerBatch(db: SupabaseClient, companyId: string, contactId: string) {
  const scope = { p_company: companyId, p_contact: contactId };
  const batch = await db.rpc("api_customer_erasure_batch", { ...scope, p_limit: RECORDS_PER_CUSTOMER });
  if (batch.error) throw new Error(`Customer erasure batch failed: ${batch.error.message}`);
  const records = (batch.data ?? []) as ErasureTarget[];
  for (const record of records) {
    const result = await purgeTrashItem(db, record.kind, record.id, null);
    if (result.outcome === "legal_hold") return false;
  }
  if (records.length === RECORDS_PER_CUSTOMER || !(await eraseCustomerExports(db, scope))) return false;
  const result = await db.rpc("api_finish_customer_erasure", scope);
  if (result.error) throw new Error(`Customer erasure finish failed: ${result.error.message}`);
  return result.data === true;
}

async function eraseCustomerExports(
  db: SupabaseClient,
  scope: { p_company: string; p_contact: string },
): Promise<boolean> {
  const copies = await db.rpc("api_customer_erasure_exports", { ...scope, p_limit: EXPORTS_PER_CUSTOMER });
  if (copies.error) throw new Error(`Customer export scan failed: ${copies.error.message}`);
  const rows = (copies.data ?? []) as { id: string; storage_prefix: string; removable: boolean }[];
  for (const row of rows) {
    if (!row.removable) return false;
    await removeExportObjects(db, row.storage_prefix);
    const removed = await db.from("data_exports").update({ reaped_at: new Date().toISOString() })
      .eq("id", row.id).eq("company_id", scope.p_company).is("reaped_at", null);
    if (removed.error) throw new Error(`Customer export receipt failed: ${removed.error.message}`);
  }
  return rows.length < EXPORTS_PER_CUSTOMER;
}
