import { EDGE_PATHS } from "@loonext/rig-protocol";

import type { Ctx } from "../context";
import { Refusal } from "../refusal";
import { KEYS } from "../telnyx/partition";
import { connectionOfResource, rememberCredential } from "../telnyx/targets";
import { runSafetyChecks } from "./safety";
import type { SafetyState } from "./safety";
import { edgeUrl, SPEC } from "./spec";
import type { TelnyxSpec } from "./spec";

/**
 * The setup routine (docs/RIG.md), for the admin class. It makes
 * the partition match tools/guard/telnyx-spec.json: each resource is found by
 * its exact name and created only when missing, then its limits and webhooks
 * are set to the spec's values, so a second run changes nothing and a run
 * after a spec change converges. Numbers are not ordered here; that is
 * /admin/numbers/order-standing, behind the ordering gate.
 */
export interface SetupStep {
  resource: string;
  name: string;
  action: "created" | "updated" | "exists" | "skipped";
  reason?: string;
}

export interface SetupReport {
  steps: SetupStep[];
  safety: SafetyState;
}

type Item = Record<string, unknown>;

function idOf(item: Item | undefined): string | null {
  return item && typeof item.id === "string" ? item.id : null;
}

function randomSecret(length: number): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const sample = new Uint8Array(1);
  let secret = "";
  while (secret.length < length) {
    const [byte] = crypto.getRandomValues(sample);
    // Six random bits cover the alphabet. Retry values outside it.
    const index = byte & 63;
    if (index < alphabet.length) secret += alphabet.charAt(index);
  }
  return secret;
}

export async function runSetup(ctx: Ctx, spec: TelnyxSpec = SPEC): Promise<SetupReport> {
  const { telnyx } = ctx;
  if (!telnyx) throw new Refusal("telnyx.key_missing");
  const edge = ctx.config.edgeOrigin;
  if (!edge) throw new Refusal("startup.unconfigured");
  const steps: SetupStep[] = [];

  if ((await runSafetyChecks(ctx)).state === "unsafe") throw new Refusal("startup.unsafe");

  async function ensure(
    resource: string,
    listPath: string,
    nameField: string,
    name: string,
    create: Item,
    update: Item | null,
  ): Promise<string> {
    const items = await telnyx!.listAll<Item>(listPath);
    const found = items.filter((item) => item[nameField] === name);
    if (found.length > 1) throw new Error(`setup: more than one ${resource} named ${name}`);
    if (found.length === 0) {
      const created = await telnyx!.call<{ data?: Item }>("POST", listPath, { [nameField]: name, ...create });
      const id = idOf(created?.data);
      if (!id) throw new Error(`setup: creating ${resource} ${name} returned no id`);
      steps.push({ resource, name, action: "created" });
      return id;
    }
    const id = idOf(found[0]);
    if (!id) throw new Error(`setup: ${resource} ${name} has no id`);
    if (update) {
      await telnyx!.call("PATCH", `${listPath}/${encodeURIComponent(id)}`, update);
      steps.push({ resource, name, action: "updated" });
    } else {
      steps.push({ resource, name, action: "exists" });
    }
    return id;
  }

  const groupId = await ensure("billing_group", "/v2/billing_groups", "name", spec.billing_group.name, {}, null);

  const ovpIds: Record<string, string> = {};
  for (const profile of spec.outbound_voice_profiles) {
    const settings: Item = {
      daily_spend_limit_enabled: false,
      max_destination_rate: null,
      whitelisted_destinations: profile.whitelisted_destinations,
      concurrent_call_limit: null,
      billing_group_id: groupId,
      calling_window: null,
    };
    ovpIds[profile.key] = await ensure(
      "outbound_voice_profile",
      "/v2/outbound_voice_profiles",
      "name",
      profile.name,
      settings,
      { name: profile.name, ...settings },
    );
  }

  for (const app of spec.call_control_applications) {
    const settings: Item = {
      call_cost_in_webhooks: app.call_cost_in_webhooks,
      webhook_event_url: edgeUrl(edge, app.webhook),
      webhook_event_failover_url: app.failover ? edgeUrl(edge, app.failover) : null,
      webhook_timeout_secs: app.webhook_timeout_secs,
      webhook_api_version: "2",
      outbound: { outbound_voice_profile_id: ovpIds[app.outbound_voice_profile], channel_limit: null },
      inbound: { channel_limit: null },
    };
    await ensure("call_control_application", "/v2/call_control_applications", "application_name", app.application_name, settings, settings);
  }

  for (const connection of spec.credential_connections) {
    const settings: Item = {
      sip_uri_calling_preference: connection.sip_uri_calling_preference,
      webhook_event_url: edgeUrl(edge, connection.webhook),
      webhook_api_version: "2",
    };
    const id = await ensure(
      "credential_connection",
      "/v2/credential_connections",
      "connection_name",
      connection.connection_name,
      {
        ...settings,
        user_name: `loonextnp${randomSecret(12).toLowerCase()}`,
        password: randomSecret(32),
      },
      settings,
    );
    if (connection.key === "sentinel") await ensureSentinelCredential(ctx, id, steps);
  }

  const profiles = spec.messaging_profiles;
  for (const profile of profiles.profiles) {
    const settings: Item = {
      enabled: true,
      webhook_url: edgeUrl(edge, profile.webhook),
      webhook_failover_url: edgeUrl(edge, profile.webhook),
      webhook_api_version: "2",
      whitelisted_destinations: profiles.whitelisted_destinations,
      daily_spend_limit_enabled: false,
    };
    await ensure("messaging_profile", "/v2/messaging_profiles", "name", profile.name, settings, settings);
  }

  const appProfiles = new Set(await ctx.store.get<string[]>(KEYS.appProfiles));
  for (const profile of await telnyx.listAll<Item>("/v2/messaging_profiles")) {
    const id = idOf(profile);
    if (id && appProfiles.has(id) && profile.daily_spend_limit_enabled === true) {
      await telnyx.call("PATCH", `/v2/messaging_profiles/${encodeURIComponent(id)}`, { daily_spend_limit_enabled: false });
      steps.push({ resource: "messaging_profile", name: "app-created", action: "updated" });
    }
  }

  steps.push(await ensureNotifications(ctx, spec));

  const safety = await runSafetyChecks(ctx);
  return { steps, safety };
}

async function ensureSentinelCredential(ctx: Ctx, connectionId: string, steps: SetupStep[]): Promise<void> {
  const telnyx = ctx.telnyx!;
  const existing = await telnyx.listAll<Item>("/v2/telephony_credentials", {
    "filter[resource_id]": `connection:${connectionId}`,
  });
  const mine = existing.filter((item) => connectionOfResource(item.resource_id) === connectionId);
  if (mine.length > 0) {
    for (const item of mine) {
      if (typeof item.id !== "string") continue;
      await rememberCredential(ctx, {
        id: item.id,
        connection_id: connectionId,
        sip_username: typeof item.sip_username === "string" ? item.sip_username : null,
        created_at: ctx.now(),
      });
    }
    steps.push({ resource: "telephony_credential", name: "nonprod-sentinel", action: "exists" });
    return;
  }
  const created = await telnyx.call<{ data?: Item }>("POST", "/v2/telephony_credentials", {
    connection_id: connectionId,
    name: "nonprod-sentinel",
  });
  const id = idOf(created?.data);
  if (id) {
    await rememberCredential(ctx, {
      id,
      connection_id: connectionId,
      sip_username: typeof created?.data?.sip_username === "string" ? created.data.sip_username : null,
      created_at: ctx.now(),
    });
  }
  steps.push({ resource: "telephony_credential", name: "nonprod-sentinel", action: "created" });
}

/**
 * The account-signal channel: a notification profile, a webhook channel to
 * the edge's secret path, and one setting per event condition the spec names.
 * The notification API's shapes are the least confirmed of any here (see
 * docs/RIG.md, "Verify"), so each part reports what it did rather than
 * failing the whole setup.
 */
async function ensureNotifications(ctx: Ctx, spec: TelnyxSpec): Promise<SetupStep> {
  const telnyx = ctx.telnyx!;
  const name = spec.notifications.profile_name;
  if (!ctx.config.notificationSecret || !ctx.config.edgeOrigin) {
    return { resource: "notifications", name, action: "skipped", reason: "NOTIFICATION_PATH_SECRET unset" };
  }
  try {
    const profiles = await telnyx.listAll<Item>("/v2/notification_profiles");
    let profileId = idOf(profiles.find((item) => item.name === name));
    let action: SetupStep["action"] = "exists";
    if (!profileId) {
      profileId = idOf((await telnyx.call<{ data?: Item }>("POST", "/v2/notification_profiles", { name }))?.data);
      action = "created";
    }
    if (!profileId) return { resource: "notifications", name, action: "skipped", reason: "profile create returned no id" };

    const destination = `${ctx.config.edgeOrigin}${EDGE_PATHS.telnyxNotificationsPrefix}${ctx.config.notificationSecret}`;
    const channels = await telnyx.listAll<Item>("/v2/notification_channels", {
      "filter[notification_profile_id][eq]": profileId,
    });
    let channelId = idOf(channels.find((item) => item.channel_destination === destination));
    if (!channelId) {
      channelId = idOf(
        (
          await telnyx.call<{ data?: Item }>("POST", "/v2/notification_channels", {
            notification_profile_id: profileId,
            channel_type_id: "webhook",
            channel_destination: destination,
          })
        )?.data,
      );
      action = "created";
    }
    if (!channelId) return { resource: "notifications", name, action: "skipped", reason: "channel create returned no id" };

    const conditions = await telnyx.listAll<Item>("/v2/notification_event_conditions");
    const settings = await telnyx.listAll<Item>("/v2/notification_settings", {
      "filter[notification_profile_id][eq]": profileId,
    });
    const wanted = spec.notifications.event_conditions.map((label) => label.toLowerCase());
    let missing = 0;
    for (const label of wanted) {
      const condition = conditions.find((item) => typeof item.name === "string" && item.name.toLowerCase().includes(label));
      const conditionId = idOf(condition);
      if (!conditionId) {
        missing += 1;
        continue;
      }
      if (settings.some((item) => item.notification_event_condition_id === conditionId)) continue;
      await telnyx.call("POST", "/v2/notification_settings", {
        notification_profile_id: profileId,
        notification_channel_id: channelId,
        notification_event_condition_id: conditionId,
      });
      action = "created";
    }
    return missing > 0
      ? { resource: "notifications", name, action, reason: `${missing} event condition(s) not found by name` }
      : { resource: "notifications", name, action };
  } catch (error) {
    return {
      resource: "notifications",
      name,
      action: "skipped",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
