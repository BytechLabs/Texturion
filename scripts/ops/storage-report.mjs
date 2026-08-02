/**
 * [#240 item 4] What storage and egress actually cost us, per workspace.
 *
 *   node scripts/ops/storage-report.mjs
 *   node scripts/ops/storage-report.mjs --days 7      # a tighter growth window
 *   node scripts/ops/storage-report.mjs --limit 20
 *
 * Read-only, so there is no --apply.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS WHEN `usage_alerts` ALREADY WATCHES STORAGE.
 *
 * That arm is a TRIPWIRE: it emails when a workspace crosses 25, 50, 100 GB.
 * #240 is explicit that a tripwire is not measurement — *"we do not have growth
 * rate per workspace, egress per workspace, or cost per active workspace as
 * standing figures. Those are what a pricing conversation (#255) needs, and the
 * alert ledger is not a substitute."*
 *
 * The gap is a specific workspace: the one at 8 GB adding 2 GB a week. It has
 * crossed nothing, so it is silent, and it will cross every tier in turn. A
 * tripwire can only ever report the past tense.
 *
 * D34 took storage CAPS off the table deliberately — storage is free and
 * uploads never fail. That ruling is what makes this report the control rather
 * than a nice-to-have: when you have decided not to block, seeing the cost is
 * the only lever left.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RANKS BY COST AND NOT BY SIZE.
 *
 * Serving is ~4x the price of keeping ($0.09/GB egress against $0.021/GB/month
 * stored, billing/costs.ts). So a workspace storing 1 GB and serving it a
 * hundred times costs more than one sitting on 20 GB nobody opens, and a
 * size-ordered list buries exactly the one worth looking at. The `EGRESS`
 * column is there to make that visible rather than implied.
 */
import { runScript } from "./lib.mjs";

const GIB = 1024 ** 3;

/** Bytes as a figure a person can compare at a glance. */
function gb(bytes) {
  const value = Number(bytes ?? 0) / GIB;
  if (value >= 100) return `${value.toFixed(0)} GB`;
  if (value >= 1) return `${value.toFixed(1)} GB`;
  return `${(Number(bytes ?? 0) / (1024 * 1024)).toFixed(0)} MB`;
}

/** Cents to dollars. `UNIT_COST_CENTS` is cents, so this is /100, not /1000. */
function usd(cents) {
  return `$${(Number(cents ?? 0) / 100).toFixed(2)}`;
}

/**
 * Growth as a share of what is already there.
 *
 * A rate rather than a raw figure because the raw figure is already in the
 * ADDED column and says nothing on its own: 2 GB added is routine at 200 GB and
 * an alarm at 4 GB. Withheld below a floor — a workspace that added 40 MB to
 * 50 MB is up 80% and means nothing, and a percentage that large next to a
 * number that small is the kind of thing that drives a bad decision.
 */
function growth(row) {
  const stored = Number(row.stored_bytes ?? 0);
  const added = Number(row.added_bytes ?? 0);
  if (stored < GIB) return "";
  const before = stored - added;
  if (before <= 0) return "new";
  return `+${((added / before) * 100).toFixed(0)}%`;
}

await runScript(
  "storage-report",
  async ({ args, db }) => {
    const days = Number(args.days ?? 30);
    const window = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
    const limitArg = Number(args.limit ?? 50);
    const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : 50;

    const rows = await db.rpc("api_storage_fleet", {
      p_days: window,
      p_limit: limit,
    });

    if (!rows || rows.length === 0) {
      console.log(
        "\n  No workspace is storing or serving anything yet.\n\n" +
          "  Not an error: workspaces with zero bytes are omitted, because a\n" +
          "  report nobody can scan is one nobody reads.\n",
      );
      return;
    }

    const total = rows.reduce(
      (sum, row) => sum + Number(row.monthly_cost_cents ?? 0),
      0,
    );
    const totalStored = rows.reduce(
      (sum, row) => sum + Number(row.stored_bytes ?? 0),
      0,
    );

    console.log(
      `\n  Storage and egress by workspace — ${window}-day window\n` +
        `  ${rows.length} workspace(s) with bytes, ${gb(totalStored)} stored, ` +
        `${usd(total)}/month at current rates\n` +
        "  Ranked by COST: serving is ~4x the price of keeping, so the top row\n" +
        "  is not always the biggest one.\n",
    );

    const table = rows.map((row) => ({
      workspace: row.company_name ?? row.company_id,
      stored: gb(row.stored_bytes),
      added: gb(row.added_bytes),
      growth: growth(row),
      egress: gb(row.egress_bytes),
      cost: usd(row.monthly_cost_cents),
    }));
    console.table(table);

    console.log(
      "  ADDED and EGRESS cover the window; STORED and COST are the standing\n" +
        "  position. GROWTH is withheld under 1 GB stored, where the percentage\n" +
        "  would be large and meaningless.\n\n" +
        "  D34 keeps storage free and uncapped on purpose, so nothing here is a\n" +
        "  limit to enforce — it is the figure a pricing decision (#255) needs,\n" +
        "  and the way to spot a workspace the 25 GB tripwire will not mention\n" +
        "  for another two months.\n",
    );
  },
  { readOnly: true },
);
