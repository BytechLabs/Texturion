import type { Context } from "hono";

import { recordAuditFromRequest } from "../../audit/log";
import type { AppEnv } from "../../context";
import type { getDb } from "../../db";
import { ApiError } from "../../http/errors";
import { unwrap } from "./http";

interface OptOutOutcome {
  outcome: "changed" | "unchanged" | "not_found" | "not_opted_out" | "carrier";
  opt_out?: { source: string };
}

export async function changeManualOptOut(
  c: Context<AppEnv>,
  db: ReturnType<typeof getDb>,
  target: { type: "contact" | "conversation"; id: string },
  enabled: boolean,
) {
  const companyId = c.get("companyId");
  const result = unwrap<OptOutOutcome>(await db.rpc("api_change_manual_opt_out", {
    p_company_id: companyId,
    p_user_id: c.get("userId"),
    p_contact_id: target.type === "contact" ? target.id : null,
    p_conversation_id: target.type === "conversation" ? target.id : null,
    p_enabled: enabled,
  }), "change manual opt-out");
  if (result.outcome === "not_found") {
    throw new ApiError("not_found", target.type === "contact" ? "No such contact." : "No such conversation.");
  }
  if (result.outcome === "not_opted_out") {
    throw new ApiError("not_found", "Contact is not opted out.");
  }
  if (result.outcome === "carrier") {
    throw new ApiError(
      "conflict",
      "This customer texted STOP, so their carrier is blocking your texts. Only they can undo it, by texting START to your number.",
    );
  }
  if (!result.opt_out) throw new Error("Manual opt-out returned no row.");
  if (result.outcome === "changed") {
    await recordAuditFromRequest(db, c, {
      companyId,
      action: enabled ? "opt_out.recorded" : "opt_out.revoked",
      targetType: target.type,
      targetId: target.id,
      ...(enabled ? { after: { source: "manual" } } : { before: { source: result.opt_out.source } }),
    });
  }
  return c.json(result.opt_out, enabled && result.outcome === "changed" ? 201 : 200);
}
