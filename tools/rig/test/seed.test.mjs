import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkTenantIds,
  completeTenantIds,
  generateTenantIds,
  seedGapsSql,
  seedSql,
  stableUuid,
  totpCode,
} from "../../../scripts/rig/seed.mjs";
import { TENANTS } from "../../../scripts/rig/tenants.mjs";
import { STANDING_ROLES, standingNumbers } from "../src/guard.mjs";
import { secretStore } from "../src/secrets.mjs";
import { STUB_PROFILES, stubPartition } from "./support/stub-guard.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rig-seed-"));
  try {
    const standing = standingNumbers(stubPartition(), secretStore(dir));
    const ids = generateTenantIds();
    const userIds = Object.fromEntries(
      TENANTS.map((tenant) => [
        tenant.key,
        Object.fromEntries(tenant.members.map((member) => [member.key, stableUuid("user", tenant.key, member.key)])),
      ]),
    );
    return { standing, ids, userIds };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the tenants cover every standing role exactly once", () => {
  const roles = TENANTS.flatMap((tenant) => tenant.numbers.map((number) => number.role));
  assert.deepEqual([...roles].sort(), [...STANDING_ROLES].sort());
  for (const tenant of TENANTS) {
    assert.equal(tenant.members.filter((member) => member.role === "owner").length, 1, `${tenant.name} has one owner`);
  }
});

test("generated ids are random UUIDs, never the dev seed's, and mail goes to Resend's test sink", () => {
  const a = generateTenantIds();
  const b = generateTenantIds();
  for (const tenant of TENANTS) {
    assert.match(a[tenant.key].company_id, /^[0-9a-f-]{36}$/);
    assert.notEqual(a[tenant.key].company_id, b[tenant.key].company_id);
    assert.notEqual(a[tenant.key].company_id, "11111111-1111-4111-8111-111111111111");
    for (const member of Object.values(a[tenant.key].members)) {
      assert.match(member.email, /^delivered\+rig-[a-z-]+@resend\.dev$/);
      assert.ok(member.password.length >= 20);
    }
  }
});

test("a stored member address off Resend's test domain is refused before any user is written", () => {
  const ids = generateTenantIds();
  assert.doesNotThrow(() => checkTenantIds(ids));
  const edited = structuredClone(ids);
  edited["qa-c"].members.owner.email = "owner@rig.invalid";
  assert.throws(() => checkTenantIds(edited), /qa-c owner's email in tenants\.json is not a Resend test address/);
  edited["qa-c"].members.owner.email = "owner@resend.dev.example";
  assert.throws(() => checkTenantIds(edited), /not a Resend test address/);
  const older = structuredClone(ids);
  delete older.robot;
  assert.throws(() => checkTenantIds(older), /tenants\.json has no entry for robot/);
});

test("a store made before a tenant or member existed gains them and keeps every stored id", () => {
  const ids = generateTenantIds();
  const before = structuredClone(ids);
  assert.equal(completeTenantIds(ids), false);
  assert.deepEqual(ids, before);

  const older = structuredClone(ids);
  delete older.robot;
  delete older["qa-w"].members["mfa-member"];
  assert.equal(completeTenantIds(older), true);
  assert.deepEqual(older["qa-w"].members.owner, before["qa-w"].members.owner);
  assert.equal(older["qa-a"].company_id, before["qa-a"].company_id);
  assert.notEqual(older.robot.company_id, before.robot.company_id);
  assert.match(older["qa-w"].members["mfa-member"].email, /@resend\.dev$/);
  assert.doesNotThrow(() => checkTenantIds(older));
});

test("each number's audience at rest is everyone at note level plus the listed members", () => {
  const { standing, ids, userIds } = fixture();
  const sql = seedSql({ ids, userIds, standing, profiles: STUB_PROFILES, voiceConnectionId: "stub-voice" });
  const qaW = TENANTS.find((tenant) => tenant.key === "qa-w");
  const devW1 = stableUuid(ids["qa-w"].company_id, "DEV-W1");
  const devW2 = stableUuid(ids["qa-w"].company_id, "DEV-W2");
  const userRules = (numberId) =>
    [...sql.matchAll(new RegExp(`'${numberId}', 'user', '([0-9a-f-]+)', 'text'`, "g"))].map((match) => match[1]);

  // The owner rings by role and never needs a rule; the technician only on W2.
  assert.deepEqual(userRules(devW1), []);
  assert.deepEqual(userRules(devW2), [userIds["qa-w"].technician]);
  for (const numberId of [devW1, devW2]) {
    assert.match(sql, new RegExp(`delete from public.number_access where phone_number_id = '${numberId}'`));
    assert.match(sql, new RegExp(`'${numberId}', 'all', null, 'note'`));
  }
  assert.ok(qaW.members.some((member) => member.key === "note-member"));
  assert.doesNotMatch(sql, new RegExp(userIds["qa-w"]["note-member"] + "', 'text'"));
  // The dispatcher rings only under a lease.
  assert.doesNotMatch(sql, new RegExp(userIds["qa-a"].dispatcher + "', 'text'"));
  assert.match(sql, new RegExp(userIds["qa-a"].technician + "', 'text'"));
});

test("numbers carry the guard's ids and profiles, and only tenants' numbers get the voice app", () => {
  const { standing, ids, userIds } = fixture();
  const sql = seedSql({ ids, userIds, standing, profiles: STUB_PROFILES, voiceConnectionId: "stub-voice" });
  assert.match(sql, /'stub-profile-qa-w', false\)/);
  assert.match(sql, /'DEV-W1',\s+'stub-voice', true\)/);
  assert.match(sql, /'ROBOT-1',\s+null, false\)/);
  assert.match(sql, /'STRANGER-1',\s+null, false\)/);
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;$/);
});

test("every standing number gets the live row the 15-minute number sweep knows it by", () => {
  // reconcileNumbers (apps/api/src/telnyx/provisioning.ts) flags, once per
  // run, every group number that no row outside 'released' claims by Telnyx
  // id or E.164. The robot's three numbers are in the rig's group too.
  const { standing, ids, userIds } = fixture();
  const sql = seedSql({ ids, userIds, standing, profiles: STUB_PROFILES, voiceConnectionId: "stub-voice" });
  const rows = [...sql.matchAll(/insert into public\.phone_numbers[\s\S]*?values\s*\(([\s\S]*?)\)\s*on conflict \(id\) do update set([\s\S]*?);/g)];
  assert.equal(rows.length, STANDING_ROLES.length);
  for (const role of STANDING_ROLES) {
    const { e164, telnyx_phone_number_id: telnyxId } = standing.get(role);
    const row = rows.find(([, values]) => values.includes(`'rig-seed-${role}'`));
    assert.ok(row, `${role} has a phone_numbers row`);
    const [, values, update] = row;
    assert.match(values, new RegExp(`'active', 'rig-seed-${role}', '\\d{3}',\\s+'CA', '\\${e164}', '${telnyxId}', 'provisioned'`));
    // A reseed brings back a row a scenario released or suspended.
    assert.match(update, /status = 'active'/);
    assert.match(update, /number_e164 = excluded\.number_e164/);
    assert.match(update, /telnyx_phone_number_id = excluded\.telnyx_phone_number_id/);
  }
});

test("deploy's seed check asks for every company, membership and number row as the partition has it now", () => {
  const { standing, ids } = fixture();
  const sql = seedGapsSql({ ids, standing });
  for (const tenant of TENANTS) {
    const companyId = ids[tenant.key].company_id;
    assert.ok(sql.includes(`('${companyId}'::uuid)`), `${tenant.name}'s company`);
    for (const member of tenant.members) {
      const email = ids[tenant.key].members[member.key].email;
      assert.ok(sql.includes(`('${companyId}'::uuid, '${email}')`), `${tenant.name} ${member.key}`);
    }
  }
  for (const role of STANDING_ROLES) {
    const tenant = TENANTS.find((candidate) => candidate.numbers.some((number) => number.role === role));
    const { e164, telnyx_phone_number_id: telnyxId } = standing.get(role);
    const row = `('${stableUuid(ids[tenant.key].company_id, role)}'::uuid, '${e164}', '${telnyxId}'::text)`;
    assert.ok(sql.includes(row), `${role} by its row id, number and Telnyx id`);
  }
  // The number sweep still knows a suspended row; only a released one is gone.
  assert.match(sql, /p\.status <> 'released'/);
});

test("a store that does not name every tenant and member always seeds", () => {
  const { standing, ids } = fixture();
  assert.notEqual(seedGapsSql({ ids, standing }), null);
  const older = structuredClone(ids);
  delete older.robot;
  assert.equal(seedGapsSql({ ids: older, standing }), null);
  const fewer = structuredClone(ids);
  delete fewer["qa-w"].members["mfa-member"];
  assert.equal(seedGapsSql({ ids: fewer, standing }), null);
});

test("a tenant split across messaging profiles is refused", () => {
  const { standing, ids, userIds } = fixture();
  standing.set("DEV-W2", { ...standing.get("DEV-W2"), messaging_profile_id: "stub-profile-qa-a" });
  assert.throws(() => seedSql({ ids, userIds, standing, profiles: STUB_PROFILES, voiceConnectionId: "v" }), /different messaging profiles/);
});

test("a ring audience naming a stranger to the tenant is refused", () => {
  const { standing, ids, userIds } = fixture();
  const tenants = [{ ...TENANTS[0], numbers: [{ role: "DEV-W1", rings: ["nobody"] }] }];
  assert.throws(() => seedSql({ tenants, ids, userIds, standing, profiles: STUB_PROFILES, voiceConnectionId: "v" }), /rings nobody/);
});

test("stable UUIDs are stable, distinct and version 4 shaped", () => {
  assert.equal(stableUuid("a", "b"), stableUuid("a", "b"));
  assert.notEqual(stableUuid("a", "b"), stableUuid("a", "c"));
  assert.match(stableUuid("x"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // rigd's app probe derives the same ids with its own copy, and its contract
  // test pins this vector too (tools/rig/rigd/src/contracts.test.ts).
  assert.equal(stableUuid("00000000-0000-4000-8000-000000000001", "DEV-W1"), "7de34ea1-d188-4bcf-ad8e-be2efe86bdfe");
});

test("TOTP matches RFC 6238's SHA-1 vectors", () => {
  // The RFC's secret, "12345678901234567890", in base32; six-digit truncations.
  const rfcSeed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totpCode(rfcSeed, 59_000), "287082");
  assert.equal(totpCode(rfcSeed, 1_111_111_109_000), "081804");
  assert.equal(totpCode(rfcSeed, 2_000_000_000_000), "279037");
});

test("the grace workspace holds no standing number, has its own messaging profile, and a reseed lifts a cancellation", () => {
  const { standing, ids, userIds } = fixture();
  const grace = TENANTS.find((tenant) => tenant.key === "qa-g");
  assert.ok(grace, "QA-G is a tenant");
  assert.deepEqual(grace.numbers, []);
  const anchor = standing.get(grace.anchor);
  const sql = seedSql({ ids, userIds, standing, profiles: STUB_PROFILES, voiceConnectionId: "stub-voice" });
  const values = sql.slice(sql.indexOf(`('${ids["qa-g"].company_id}', 'QA-G'`)).split("on conflict")[0];
  assert.ok(values.startsWith(`('${ids["qa-g"].company_id}', 'QA-G', '${userIds["qa-g"].owner}', 'CA', '${anchor.e164.slice(2, 5)}',`));
  assert.equal(grace.messagingProfile, "qa-g");
  assert.ok(values.includes(`'${STUB_PROFILES["qa-g"]}', false)`), "QA-G is on its own messaging profile");
  assert.notEqual(STUB_PROFILES["qa-g"], anchor.messaging_profile_id);
  assert.ok(!sql.includes(`, '${ids["qa-g"].company_id}', 'active', 'rig-seed-`), "no phone_numbers row is seeded into QA-G");
  assert.match(sql, /subscription_status = excluded\.subscription_status,\s+canceled_at = null,/);
  const gaps = seedGapsSql({ ids, standing });
  assert.ok(gaps.includes(`('${ids["qa-g"].company_id}'::uuid)`));
  assert.ok(gaps.includes(`('${ids["qa-g"].company_id}'::uuid, '${ids["qa-g"].members.owner.email}')`));
});

test("a tenant with no standing number and no anchor in the partition is refused", () => {
  const { standing, ids, userIds } = fixture();
  const tenants = TENANTS.map((tenant) => (tenant.key === "qa-g" ? { ...tenant, anchor: "DEV-Z9" } : tenant));
  const profiles = STUB_PROFILES;
  assert.throws(() => seedSql({ tenants, ids, userIds, standing, profiles, voiceConnectionId: "v" }), /QA-G has no standing number and names no anchor/);
});

test("no two tenants are seeded onto one messaging profile, since a company's profile is unique", () => {
  const { standing, ids, userIds } = fixture();
  const profiles = (sql) => [...sql.matchAll(/'(stub-profile-[a-z-]+)', (?:true|false)\)/g)].map((match) => match[1]);
  const seeded = profiles(seedSql({ ids, userIds, standing, profiles: STUB_PROFILES, voiceConnectionId: "v" }));
  assert.equal(seeded.length, TENANTS.length);
  assert.equal(new Set(seeded).size, seeded.length, "every company has a profile of its own");

  // QA-G on DEV-C1's profile, which the unique column refuses.
  const shared = { ...STUB_PROFILES, "qa-g": standing.get("DEV-C1").messaging_profile_id };
  assert.throws(() => seedSql({ ids, userIds, standing, profiles: shared, voiceConnectionId: "v" }), /QA-G and QA-C share a messaging profile/);
});

test("every tenant's messaging profile is a distinct profile the guard's spec creates", () => {
  const spec = JSON.parse(readFileSync(new URL("../../guard/telnyx-spec.json", import.meta.url), "utf8"));
  const specKeys = spec.messaging_profiles.profiles.map((profile) => profile.key);
  const keyOfRole = new Map(spec.numbers.standing.map((entry) => [entry.role, entry.messaging_profile]));
  const keys = TENANTS.map((tenant) => tenant.messagingProfile ?? keyOfRole.get(tenant.numbers[0]?.role));
  assert.ok(keys.every((key) => specKeys.includes(key)), `every tenant's profile is in the spec: ${keys}`);
  assert.equal(new Set(keys).size, keys.length, "no two tenants share a profile");
  assert.ok(specKeys.includes("qa-g"), "the spec creates QA-G's profile");
});

test("the grace workspace is refused when the guard sends no profile for it", () => {
  const { standing, ids, userIds } = fixture();
  const { "qa-g": _, ...without } = STUB_PROFILES;
  assert.throws(() => seedSql({ ids, userIds, standing, profiles: without, voiceConnectionId: "v" }), /no messaging profile for QA-G/);
  assert.throws(() => seedSql({ ids, userIds, standing, voiceConnectionId: "v" }), /no messaging profile for QA-G/);
});
