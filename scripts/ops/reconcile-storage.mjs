/**
 * [#479] Find the rows whose bytes are gone, by asking the bytes.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/ops/reconcile-storage.mjs
 *   ... node scripts/ops/reconcile-storage.mjs --apply
 *
 * ---------------------------------------------------------------------------
 * WHY THE SWEEP CANNOT DO THIS.
 *
 * `job:sweep-deleted-attachments` reclaims both directions for all four buckets
 * now, and every one of its passes is an anti-join against `storage.objects`.
 * That is the right tool on an ordinary day and the wrong one on exactly one
 * day: after a point-in-time restore.
 *
 * Supabase Storage keeps its object index in `storage.objects` — a table in the
 * same Postgres cluster we restore. A restore rewinds our knowledge of which
 * objects exist while the bytes stay where they are, and the two halves drift
 * apart in both directions:
 *
 *   A row whose object was DELETED after the restore point comes back, and its
 *   `storage.objects` row comes back with it. The ghost scan sees a matched
 *   pair and reports nothing. The customer clicks and gets a 404.
 *
 *   An object UPLOADED after the restore point keeps its bytes and loses both
 *   rows. The orphan scan enumerates from `storage.objects`, so it cannot see
 *   it — and `storage.remove()` resolves paths through the same table, so it
 *   cannot be deleted either.
 *
 * `DISASTER-RECOVERY.md` §4 calls that "a genuine gap, not a procedure to
 * follow". This script closes the half that is closable: it ignores
 * `storage.objects` entirely and asks the storage backend whether each live
 * row's object is really there.
 *
 * THE OTHER HALF IS NOT CLOSABLE ON THIS PLAN, and that is a checked fact
 * rather than an assumption. Supabase's S3-compatible endpoint is served at
 * `project_ref.storage.supabase.co/storage/v1/s3` — Supabase's own service
 * speaking the S3 protocol, not credentials for the bucket underneath. Every
 * listing it can do is a listing of what `storage.objects` knows. There is no
 * inventory of the backing store available to us at any price we can buy, so
 * unreferenced bytes after a restore are a bounded, documented cost leak rather
 * than something a tool can find. §4 carries the bound.
 *
 * ---------------------------------------------------------------------------
 * HOW IT PROBES, and why it is a ranged GET rather than a HEAD.
 *
 * Every check has to reach the BACKEND, or it re-asks the question we already
 * know is unreliable. A signed URL is minted through `storage.objects`, so
 * minting one proves nothing — it is the fetch that either finds bytes or does
 * not. `Range: bytes=0-0` asks for one byte: enough to force a real read, small
 * enough that probing an entire workspace's media costs nothing worth counting.
 *
 * Read-only until `--apply`, like every script in this directory.
 *
 * WHAT --apply DOES, per bucket, and the third one is deliberately different:
 *
 *   attachments / mms-media  the row describes an object and nothing else, so a
 *                            row with no object is meaningless. Deleted.
 *   voicemails               `calls` is a business record. Somebody phoned this
 *                            business and that stays true without the audio, so
 *                            only the POINTER is cleared and the transcript is
 *                            kept — it is the words of a customer who rang, and
 *                            the only remaining record of what they wanted.
 *   exports                  stamped `reaped_at`, not deleted. The row is the
 *                            record of a request; #378 keeps it deliberately so
 *                            a customer sees they asked and it expired, rather
 *                            than a gap. Stamping stops the UI offering a
 *                            download that cannot work.
 */
import {
  fail,
  recordPlatformAudit,
  runScript,
  showRows,
} from "./lib.mjs";

/** Rows read per page. The probe is the slow part, not the query. */
const PAGE = 500;

/** Probes in flight at once. Enough to be quick, few enough to be polite. */
const CONCURRENCY = 8;

/**
 * The four buckets, each with the table that points at it and what to do when
 * the bytes are missing.
 *
 * `pathColumn` is the column holding the object key. `exports` has none — it
 * stores a PREFIX and writes one file per table under it — so it is probed
 * differently and carries a null here.
 */
const BUCKETS = [
  {
    bucket: "attachments",
    table: "attachments",
    pathColumn: "storage_path",
    select: "id,company_id,storage_path",
    // Soft-deleted rows are already the sweep's job and their objects are
    // SUPPOSED to be going away; probing them would report the sweep working.
    filter: { deleted_at: "is.null" },
    repair: "delete",
  },
  {
    bucket: "mms-media",
    table: "message_attachments",
    pathColumn: "storage_path",
    select: "id,storage_path",
    filter: {},
    repair: "delete",
  },
  {
    bucket: "voicemails",
    table: "calls",
    pathColumn: "voicemail_path",
    select: "id,company_id,voicemail_path",
    filter: { voicemail_path: "not.is.null" },
    repair: "clear-voicemail",
  },
  {
    bucket: "exports",
    table: "data_exports",
    pathColumn: null,
    select: "id,company_id,storage_prefix",
    // A reaped export SHOULD have no objects — that is what reaped means.
    filter: { reaped_at: "is.null", storage_prefix: "not.is.null" },
    repair: "mark-reaped",
  },
];

await runScript("reconcile-storage", async ({ apply, db, script }) => {
  const base = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;

  console.log(
    "  Probing every live row's object against the storage backend.\n" +
      "  This ignores storage.objects on purpose — after a restore that table\n" +
      "  is the thing that is wrong.\n",
  );

  let totalMissing = 0;
  const skipped = [];

  for (const spec of BUCKETS) {
    // Every bucket is independent, and a failure in one must never starve the
    // rest — the same rule the sweep passes follow, for a sharper reason here.
    // This script's whole purpose is to run on the worst day, and the first
    // real dry run against production died on the fourth bucket because prod
    // was a few migrations behind main and `data_exports.reaped_at` did not
    // exist yet. That is an ordinary, expected state between releases, and it
    // must not cost an operator the three buckets that WOULD have reported.
    let rows;
    try {
      rows = await readAll(db, spec);
    } catch (cause) {
      skipped.push(`${spec.bucket}: ${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }
    const missing = [];

    await inBatches(rows, CONCURRENCY, async (row) => {
      const paths = await pathsFor(base, key, spec, row);
      // An export prefix with NO objects at all is missing in the only sense
      // that matters: there is nothing to download. A row with some objects is
      // left alone — a partial export is a different problem, and one this
      // script would be guessing about.
      if (paths.length === 0) {
        missing.push(row);
        return;
      }
      for (const path of paths) {
        if (!(await objectExists(base, key, spec.bucket, path))) {
          missing.push(row);
          return;
        }
      }
    });

    totalMissing += missing.length;
    showRows(
      `${spec.bucket}: rows probed ${rows.length}, bytes missing`,
      missing.map((row) => ({
        id: row.id,
        path: spec.pathColumn ? row[spec.pathColumn] : row.storage_prefix,
      })),
    );

    if (!apply || missing.length === 0) continue;
    await repair(db, spec, missing, script);
  }

  if (skipped.length > 0) {
    // Loud, and not an exception. A bucket this run could not read is a bucket
    // nobody checked, and the operator has to know which — but the answer for
    // the other three is still worth having.
    console.log("  COULD NOT PROBE:");
    for (const line of skipped) console.log(`    ${line}`);
    console.log(
      "\n    Usually this is production being a few migrations behind main.\n" +
        "    Re-run after the release lands; the buckets above are unaffected.\n",
    );
  }

  if (totalMissing === 0) {
    console.log("  Every live row's object is really there.\n");
  } else if (apply) {
    console.log(`  Repaired ${totalMissing} row(s).\n`);
  }
});

/** Page through every live row for one bucket. */
async function readAll(db, spec) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await db.select(spec.table, spec.select, {
      ...spec.filter,
      order: "id.asc",
      offset: String(offset),
      limit: String(PAGE),
    });
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/**
 * The object keys this row claims. One for the three path-column tables; a
 * listing for `exports`, whose row names a prefix rather than a file.
 *
 * The export listing goes through the Storage list API, which reads
 * `storage.objects` — acceptable here and nowhere else in this script, because
 * for exports we are asking "does this row still own anything", and a prefix
 * whose metadata AND bytes both vanished is missing by either measure.
 */
async function pathsFor(base, key, spec, row) {
  if (spec.pathColumn) {
    const path = row[spec.pathColumn];
    return path ? [path] : [];
  }
  const response = await fetch(`${base}/storage/v1/object/list/${spec.bucket}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: row.storage_prefix, limit: 200 }),
  });
  if (!response.ok) return [];
  const entries = await response.json();
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.name?.includes("."))
    .map((entry) => `${row.storage_prefix}/${entry.name}`);
}

/**
 * Does this object really exist?
 *
 * Signed URL, then a one-byte ranged GET through it. The signing step proves
 * nothing on its own (it resolves through `storage.objects`); the fetch is the
 * answer. 200 and 206 both mean bytes came back — some backends ignore Range
 * and return the whole object, which is a slower yes rather than a no.
 */
async function objectExists(base, key, bucket, path) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const signed = await fetch(
    `${base}/storage/v1/object/sign/${bucket}/${encodeURI(path)}`,
    { method: "POST", headers, body: JSON.stringify({ expiresIn: 60 }) },
  );
  // No signed URL means no `storage.objects` row. On an ordinary day the sweep
  // owns that case; here it still means the row cannot be served, which is what
  // this script reports.
  if (!signed.ok) return false;
  const { signedURL } = await signed.json();
  if (!signedURL) return false;

  const probe = await fetch(`${base}/storage/v1${signedURL}`, {
    headers: { Range: "bytes=0-0" },
  });
  return probe.status === 200 || probe.status === 206;
}

/** Apply the per-bucket repair, with an audit row for every workspace touched. */
async function repair(db, spec, missing, script) {
  const ids = missing.map((row) => row.id);

  switch (spec.repair) {
    case "delete":
      // One at a time, which is the right speed for a repair that REMOVES
      // rows: a mistake costs one row rather than a table, and the id filter
      // is built from a row this script just read rather than from an argument.
      for (const row of missing) {
        await db.remove(spec.table, { id: `eq.${row.id}` });
      }
      break;
    case "clear-voicemail":
      for (const row of missing) {
        await db.patch(
          spec.table,
          { id: `eq.${row.id}` },
          { voicemail_path: null, voicemail_seconds: null },
        );
      }
      break;
    case "mark-reaped":
      for (const row of missing) {
        await db.patch(
          spec.table,
          { id: `eq.${row.id}` },
          { reaped_at: new Date().toISOString() },
        );
      }
      break;
    default:
      fail(`unknown repair "${spec.repair}"`);
  }

  for (const row of missing) {
    if (!row.company_id) continue;
    await recordPlatformAudit(db, {
      companyId: row.company_id,
      script,
      action: "storage.reconciled",
      targetType: spec.table,
      targetId: row.id,
      after: { bucket: spec.bucket, repair: spec.repair },
    });
  }
  console.log(`    repaired ${ids.length} ${spec.table} row(s)\n`);
}

/** Run `work` over `items` with a bounded number in flight. */
async function inBatches(items, size, work) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((item) => work(item)));
  }
}
