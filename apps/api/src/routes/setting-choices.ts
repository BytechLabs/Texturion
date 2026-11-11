/**
 * #749: for each setting that can lose a customer and is not at its default,
 * who chose the current value and when, so Settings can say "Take a message,
 * set by Dana on Aug 8" rather than look like the product's own choice.
 */
import {
  COMPANY_SETTING_DEFAULTS,
  REVENUE_SETTING_KEYS,
  type CompanySettingKey,
} from "@loonext/shared";
import { Hono } from "hono";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";

/** REVENUE_SETTING_KEYS, written out so the schema check can read the select. */
export const REVENUE_SETTING_COLUMNS =
  "after_hours_calls,ring_strategy,ring_seconds,away_enabled,call_screening," +
  "emergency_keyword_enabled,emergency_reply_enabled,overage_cap_multiplier";

export interface SettingChoice {
  key: CompanySettingKey;
  value: unknown;
  default_value: unknown;
  /** Null when no settings change on record touched it. */
  chosen_by: string | null;
  chosen_at: string | null;
}

interface LatestChange {
  key: string;
  actor_name: string | null;
  occurred_at: string;
}

export const settingChoicesRoutes = new Hono<AppEnv>();

settingChoicesRoutes.get(
  "/company/setting-choices",
  requireCapability("settings.manage"),
  async (c) => {
    const db = getDb(getEnv(c.env));
    const companyId = c.get("companyId");

    const { data: rows, error } = await db
      .from("companies")
      .select(REVENUE_SETTING_COLUMNS)
      .eq("id", companyId)
      .limit(1);
    if (error) throw new Error(`setting choices company read failed: ${error.message}`);
    const company = (rows?.[0] ?? {}) as unknown as Record<string, unknown>;

    const changed = REVENUE_SETTING_KEYS.filter(
      (key) =>
        key in company &&
        JSON.stringify(company[key]) !== JSON.stringify(COMPANY_SETTING_DEFAULTS[key].value),
    );
    if (changed.length === 0) return c.json({ data: [] });

    const { data: latest, error: latestError } = await db.rpc("api_latest_setting_changes", {
      p_company_id: companyId,
      p_keys: changed,
    });
    if (latestError) {
      throw new Error(`api_latest_setting_changes failed: ${latestError.message}`);
    }
    const byKey = new Map(((latest ?? []) as LatestChange[]).map((row) => [row.key, row]));

    const data: SettingChoice[] = changed.map((key) => ({
      key,
      value: company[key],
      default_value: COMPANY_SETTING_DEFAULTS[key].value,
      chosen_by: byKey.get(key)?.actor_name ?? null,
      chosen_at: byKey.get(key)?.occurred_at ?? null,
    }));
    return c.json({ data });
  },
);
