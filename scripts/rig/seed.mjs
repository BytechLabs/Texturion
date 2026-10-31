#!/usr/bin/env node
/**
 * Seeds the rig's tenants into the rig's own local Supabase.
 *
 *   node scripts/rig/seed.mjs [--workdir <supabase workdir>]
 *   rig seed                      (the same, with the rig's own workdir)
 *
 * WHERE IT WRITES. Only to the stack `supabase status` reports, refused unless
 * that is this machine (scripts/local-supabase.mjs), and through that stack's
 * own container. No environment variable can point it anywhere else.
 *
 * WHAT IT WRITES. QA-W, QA-A, QA-C, QA-E and the robot's workspace, each with
 * a fixed company id that is random, generated on the first run and kept in
 * the rig's secret store (tenants.json), never the dev seed's. The standing
 * numbers and their messaging profiles are re-attached from the guard's live
 * partition, and each number's ring audience is reset to the fewest surfaces
 * the scenarios need, which also undoes anything a lease left behind.
 *
 * Idempotent: a rerun converges on the same rows.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { TENANTS, memberEmail } from "./tenants.mjs";
import { localSupabaseUrl } from "../local-supabase.mjs";
import { fetchPartition, recordStanding, standingNumbers } from "../../tools/rig/src/guard.mjs";
import { rigLayout } from "../../tools/rig/src/layout.mjs";
import { secretStore } from "../../tools/rig/src/secrets.mjs";
import { projectIdOf } from "../../tools/rig/src/supabase-config.mjs";
import { localStatus, psql } from "../../tools/rig/src/supabase.mjs";

/** A UUID fixed by its inputs, so a number's row id survives a reseed. */
export function stableUuid(...parts) {
  const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Generated once per store: the rig-only ids and the members' passwords. */
export function generateTenantIds(tenants = TENANTS) {
  return Object.fromEntries(
    tenants.map((tenant) => [
      tenant.key,
      {
        company_id: randomUUID(),
        members: Object.fromEntries(
          tenant.members.map((member) => [
            member.key,
            { email: memberEmail(tenant.key, member.key), password: randomBytes(18).toString("base64url") },
          ]),
        ),
      },
    ]),
  );
}

function lit(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function npaOf(e164) {
  return e164.slice(2, 5);
}

/**
 * One transaction for every tenant.
 *
 * @param {{ tenants, ids, userIds: Record<string, Record<string, string>>, standing: Map, voiceConnectionId: string }} input
 *   userIds: tenant key -> member key -> auth user id
 */
export function seedSql({ tenants = TENANTS, ids, userIds, standing, voiceConnectionId }) {
  const statements = ["begin;"];
  for (const tenant of tenants) {
    const companyId = ids[tenant.key]?.company_id;
    if (!UUID.test(companyId ?? "")) throw new Error(`rig seed: tenants.json has no company id for ${tenant.key}`);
    const users = userIds[tenant.key];
    const owner = tenant.members.find((member) => member.role === "owner");
    const numbers = tenant.numbers.map((number) => ({ ...number, ...standing.get(number.role) }));
    const profiles = [...new Set(numbers.map((number) => number.messaging_profile_id))];
    if (profiles.length > 1) {
      throw new Error(`rig seed: ${tenant.name}'s numbers are on different messaging profiles`);
    }
    const first = numbers[0];

    statements.push(`
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, plan,
   subscription_status, us_texting_enabled, timezone, current_period_start,
   current_period_end, telnyx_messaging_profile_id, caller_id_lookup)
values
  (${lit(companyId)}, ${lit(tenant.name)}, ${lit(users[owner.key])}, 'CA', ${lit(npaOf(first.e164))},
   now(), 'pro', 'active', false, 'America/Toronto', date_trunc('month', now()),
   date_trunc('month', now()) + interval '1 month', ${lit(profiles[0])}, ${lit(tenant.callerIdLookup)})
on conflict (id) do update set
  name = excluded.name,
  owner_user_id = excluded.owner_user_id,
  subscription_status = excluded.subscription_status,
  telnyx_messaging_profile_id = excluded.telnyx_messaging_profile_id,
  caller_id_lookup = excluded.caller_id_lookup,
  deleted_at = null;`);

    for (const member of tenant.members) {
      statements.push(`
insert into public.company_members (company_id, user_id, role)
values (${lit(companyId)}, ${lit(users[member.key])}, ${lit(member.role)})
on conflict (company_id, user_id) do update set role = excluded.role, deactivated_at = null;`);
    }

    // Every number is Canadian and takes calls. MMS is no longer a module.
    for (const module of ["voice", "regions_ca"]) {
      statements.push(`
insert into public.company_modules (company_id, module) values (${lit(companyId)}, ${lit(module)})
on conflict (company_id, module) do update set disabled_at = null;`);
    }

    for (const number of numbers) {
      const numberId = stableUuid(companyId, number.role);
      const voice = number.voice !== false;
      statements.push(`
insert into public.phone_numbers
  (id, company_id, status, provisioning_key, requested_area_code, country, number_e164,
   telnyx_phone_number_id, source, label, voice_connection_id, voice_enabled)
values
  (${lit(numberId)}, ${lit(companyId)}, 'active', ${lit(`rig-seed-${number.role}`)}, ${lit(npaOf(number.e164))},
   'CA', ${lit(number.e164)}, ${lit(number.telnyx_phone_number_id)}, 'provisioned', ${lit(number.role)},
   ${voice ? lit(voiceConnectionId) : "null"}, ${lit(voice)})
on conflict (id) do update set
  status = 'active',
  number_e164 = excluded.number_e164,
  telnyx_phone_number_id = excluded.telnyx_phone_number_id,
  label = excluded.label,
  voice_connection_id = excluded.voice_connection_id,
  voice_enabled = excluded.voice_enabled;`);

      // The audience at rest. Every member is note level unless listed, and
      // a rule naming a member beats the rule for everyone (#106).
      statements.push(`delete from public.number_access where phone_number_id = ${lit(numberId)};`);
      statements.push(`
insert into public.number_access (company_id, phone_number_id, principal_kind, principal, level)
values (${lit(companyId)}, ${lit(numberId)}, 'all', null, 'note');`);
      for (const memberKey of number.rings) {
        const member = tenant.members.find((candidate) => candidate.key === memberKey);
        if (!member) throw new Error(`rig seed: ${number.role} rings ${memberKey}, who is not in ${tenant.name}`);
        if (member.role === "owner" || member.role === "admin") continue;
        statements.push(`
insert into public.number_access (company_id, phone_number_id, principal_kind, principal, level)
values (${lit(companyId)}, ${lit(numberId)}, 'user', ${lit(users[member.key])}, 'text');`);
      }
    }
  }
  statements.push("commit;");
  return statements.join("\n");
}

/** RFC 6238 code for a base32 secret: SHA-1, six digits, 30-second steps. */
export function totpCode(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error("rig seed: the TOTP secret is not base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

async function auth(status, path, { method = "POST", token, body }) {
  const response = await fetch(`${status.apiUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: token ? status.publishableKey : status.secretKey,
      authorization: `Bearer ${token ?? status.secretKey}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`rig seed: auth ${path.split("?")[0]} answered ${response.status}`);
  return parsed;
}

function userIdFor(projectId, email) {
  return psql(projectId, `select id from auth.users where email = ${lit(email)};`).trim() || null;
}

async function ensureUser(status, projectId, { email, password }, displayName) {
  const existing = userIdFor(projectId, email);
  if (existing) {
    // The store's password is the one scenarios sign in with.
    await auth(status, `/admin/users/${existing}`, { method: "PUT", body: { password } });
    return existing;
  }
  const created = await auth(status, "/admin/users", {
    body: { email, password, email_confirm: true, user_metadata: { display_name: displayName } },
  });
  return created.id;
}

/** Enrols a TOTP factor for a member who has none, and keeps its secret in the store. */
async function ensureTotp(status, projectId, credentials) {
  const verified = psql(
    projectId,
    `select count(*) from auth.mfa_factors f join auth.users u on u.id = f.user_id
      where u.email = ${lit(credentials.email)} and f.factor_type = 'totp' and f.status = 'verified';`,
  ).trim();
  if (verified !== "0" && credentials.totp_secret) return false;
  psql(projectId, `delete from auth.mfa_factors where user_id = (select id from auth.users where email = ${lit(credentials.email)});`);
  const session = await auth(status, "/token?grant_type=password", {
    token: status.publishableKey,
    body: { email: credentials.email, password: credentials.password },
  });
  const factor = await auth(status, "/factors", {
    token: session.access_token,
    body: { factor_type: "totp", friendly_name: "rig" },
  });
  const challenge = await auth(status, `/factors/${factor.id}/challenge`, { token: session.access_token, body: {} });
  await auth(status, `/factors/${factor.id}/verify`, {
    token: session.access_token,
    body: { challenge_id: challenge.id, code: totpCode(factor.totp.secret) },
  });
  credentials.totp_secret = factor.totp.secret;
  return true;
}

function totpEnabled(workdir) {
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  const table = /\[auth\.mfa\.totp\]([^[]*)/.exec(config)?.[1] ?? "";
  return /^\s*verify_enabled\s*=\s*true/m.test(table);
}

/**
 * @param {{ workdir: string, store, partition?: object, log?: (line: string) => void }} options
 */
export async function seed({ workdir, store, partition, log = console.log }) {
  const status = localStatus(workdir);
  if (status === null) throw new Error("rig seed: the local stack is not running (supabase status failed)");
  localSupabaseUrl({ SUPABASE_URL: status.apiUrl });
  const projectId = projectIdOf(readFileSync(join(workdir, "supabase", "config.toml"), "utf8"));

  const live = partition ?? (await fetchPartition(store));
  const standing = standingNumbers(live, store);
  // rigd and the robot find the numbers by role in this file.
  recordStanding(store, standing);
  const ids = store.ensureJson("tenants.json", () => generateTenantIds());
  for (const tenant of TENANTS) {
    if (!ids[tenant.key]) throw new Error(`rig seed: tenants.json has no entry for ${tenant.key}`);
  }

  const userIds = {};
  for (const tenant of TENANTS) {
    userIds[tenant.key] = {};
    for (const member of tenant.members) {
      const credentials = ids[tenant.key].members[member.key];
      if (!credentials) throw new Error(`rig seed: tenants.json has no ${tenant.key} ${member.key}`);
      userIds[tenant.key][member.key] = await ensureUser(status, projectId, credentials, member.displayName);
    }
  }

  psql(projectId, seedSql({ ids, userIds, standing, voiceConnectionId: live.connection_ids.voice }));

  if (totpEnabled(workdir)) {
    let changed = false;
    for (const tenant of TENANTS) {
      for (const member of tenant.members.filter((candidate) => candidate.totp)) {
        changed = (await ensureTotp(status, projectId, ids[tenant.key].members[member.key])) || changed;
      }
    }
    if (changed) store.write("tenants.json", ids);
  } else {
    log("seed: two-factor sign-in is off in this stack's config, so the two-factor member has no factor");
  }

  for (const tenant of TENANTS) {
    log(`seeded ${tenant.name}: ${tenant.members.length} member(s), ${tenant.numbers.map((n) => n.role).join(", ")}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf("--workdir");
  const layout = rigLayout();
  const workdir = at === -1 ? layout.supabaseWorkdir : process.argv[at + 1];
  seed({ workdir, store: secretStore(layout.secrets) }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
