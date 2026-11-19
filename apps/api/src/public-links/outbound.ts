import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "../http/errors";
import type { MessageRow } from "../messaging/types";
import { insertConversationEvents } from "../routes/core/events";
import { generateToken, hashToken } from "./tokens";

const PATH_PURPOSES = { q: "quote_view", pay: "payment", photos: "photo_set" } as const;
const LINK_PLACEHOLDER = "[private link]";

type LinkPath = keyof typeof PATH_PURPOSES;

interface StoredLink {
  purpose: (typeof PATH_PURPOSES)[LinkPath];
  token_hash: string;
}

function escapePattern(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function linkPattern(origin: string, segment: string): RegExp {
  const prefix = escapePattern(origin.replace(/\/$/, ""));
  return new RegExp(`(^|[^\\w./@-])(${prefix}/(q|pay|photos)/)(${segment})`, "g");
}

export async function concealOutboundLinks(origin: string, text: string) {
  const links: Promise<StoredLink>[] = [];
  const body = text.replaceAll(
    linkPattern(origin, "[A-Za-z0-9_-]{40,64}(?![A-Za-z0-9_/-])"),
    (_match: string, preceding: string, prefix: string, path: LinkPath, token: string) => {
      links.push(hashToken(token).then((token_hash) => ({ purpose: PATH_PURPOSES[path], token_hash })));
      return `${preceding}${prefix}${LINK_PLACEHOLDER}`;
    },
  );
  return { body, links: await Promise.all(links) };
}

export async function remintOutboundLinks(
  db: SupabaseClient,
  origin: string,
  message: MessageRow,
): Promise<string> {
  const pattern = linkPattern(origin, escapePattern(LINK_PLACEHOLDER));
  const matches = [...message.body.matchAll(pattern)];
  if (matches.length === 0) return message.body;

  const ids = message.public_link_ids ?? [];
  const unavailable = () => new ApiError("conflict", "Send a new private link to this customer.", {
    key: "apiRefusals.privateLinkRetryUnavailable",
  });
  if (ids.length !== matches.length || ids.some((id) => !id)) throw unavailable();

  const minted = await Promise.all(matches.map(async (match, index) => {
    const token = generateToken();
    const { data, error } = await db.rpc("api_remint_outbound_link", {
      p_company_id: message.company_id,
      p_link_id: ids[index],
      p_purpose: PATH_PURPOSES[match[3] as LinkPath],
      p_token_hash: await hashToken(token),
      p_actor: message.sent_by_user_id,
    });
    if (error) throw new Error(`private links for message retry failed: ${error.message}`);
    if (data !== true) throw unavailable();
    return token;
  }));
  let index = 0;
  return message.body.replaceAll(pattern, (_match: string, preceding: string, prefix: string) => {
    const token = minted[index];
    index += 1;
    return `${preceding}${prefix}${token}`;
  });
}

export async function recordRetriedQuoteSend(db: SupabaseClient, message: MessageRow): Promise<void> {
  const { data, error } = await db.from("quotes")
    .update({ status: "sent", sent_at: new Date().toISOString(), sending_at: null })
    .eq("company_id", message.company_id)
    .eq("message_id", message.id)
    .eq("status", "draft")
    .select("id,amount_cents,currency,description")
    .maybeSingle();
  if (error) throw new Error(`quote retry status update failed: ${error.message}`);
  if (!data) return;
  await insertConversationEvents(db, [{
    company_id: message.company_id,
    conversation_id: message.conversation_id,
    actor_user_id: message.sent_by_user_id,
    type: "quote_sent",
    payload: {
      quote_id: data.id, amount_cents: data.amount_cents,
      currency: data.currency, description: data.description,
    },
  }]);
}
