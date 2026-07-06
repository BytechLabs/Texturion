/**
 * Local development helper (dev tooling — never runs in production).
 *
 * Simulates the tail of the §4.3 provisioning saga that a bare local stack
 * can't run for real: Telnyx never buys a number against localhost, so after a
 * live onboarding + test-mode Stripe checkout the setting-up screen's "Creating
 * your number" row sits at provisioning/provision_failed forever. This flips the
 * newest such row to `active` (and approves any pending 10DLC registration) so
 * you can watch the checklist cascade to done and land in the inbox — exactly
 * what real provisioning would do.
 *
 * The setting-up screen polls every 4s until an active number exists, so the
 * change is picked up within a few seconds with no broadcast needed.
 *
 * Run from the repo root (optionally pass a company id to target one company):
 *
 *   node --experimental-strip-types scripts/dev-activate-number.ts [companyId]
 *
 * Pairs with scripts/dev-seed.ts (same local service key / PostgREST edge).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function rest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { ...authHeaders, Prefer: "return=representation", ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

interface NumberRow {
  id: string;
  company_id: string;
  status: string;
  number_e164: string | null;
}

async function main(): Promise<void> {
  const companyId = process.argv[2] ?? null;

  // Newest number row that isn't already active/released — the one the wizard
  // is waiting on. Scope to a company id when one is passed.
  const filter =
    "status=in.(provisioning,provision_failed)" +
    (companyId ? `&company_id=eq.${companyId}` : "");
  const rows = await rest<NumberRow[]>(
    `phone_numbers?${filter}&order=created_at.desc&limit=1`,
  );
  if (rows.length === 0) {
    console.log(
      "No provisioning number found." +
        (companyId ? ` (company ${companyId})` : "") +
        " Complete a checkout first, then re-run.",
    );
    return;
  }

  const row = rows[0];
  const fakeE164 =
    row.number_e164 ?? `+1512555${String(Math.floor(1000 + Date.now() % 9000))}`;
  await rest(`phone_numbers?id=eq.${row.id}`, {
    method: "PATCH",
    body: {
      status: "active",
      number_e164: fakeE164,
      suspended_at: null,
      last_provision_error: null,
    },
  });
  console.log(`✓ Number ${fakeE164} marked active for company ${row.company_id}`);

  // Approve any pending 10DLC registration so the "Registering your business"
  // row also goes green (no-op for CA-only companies, which owe none).
  const approved = await rest<{ id: string }[]>(
    `messaging_registrations?company_id=eq.${row.company_id}` +
      `&status=in.(draft,submitted,pending)`,
    { method: "PATCH", body: { status: "approved", deactivated_at: null } },
  );
  if (approved.length > 0) {
    console.log(`✓ ${approved.length} registration row(s) approved`);
  }
  console.log(
    "\nThe setting-up screen will pick this up within ~4s (it polls until the" +
      " number is active). Refresh if you'd rather not wait.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
