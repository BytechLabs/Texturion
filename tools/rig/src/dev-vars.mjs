/**
 * Renders apps/api/.dev.vars.rig from tools/rig/templates/api.dev.vars.rig.
 *
 * The template names a source for every variable; this resolves them. An
 * unresolved required source stops the deploy and is named, never guessed.
 */
import { generateKeyPairSync } from "node:crypto";

import { EDGE_PATHS, GUARD_ROUTES } from "../../rig-protocol/src/index.ts";

const PLACEHOLDER = /\{\{\s*([a-z]+)(\?)?([.:])([A-Za-z0-9_.-]+)\s*\}\}|\{\{\s*(edge)\s*\}\}/g;

/** The seams, built from the shared contract so a renamed edge path moves here too. */
export function seams(edge) {
  const guard = `${edge}${EDGE_PATHS.guardPrefix}`;
  return {
    telnyxApiBase: `${guard}${GUARD_ROUTES.telnyx}`,
    telnyxWebhookUrl: `${edge}${EDGE_PATHS.telnyxMessaging}`,
    telnyxMediaPublicBase: `${edge}${EDGE_PATHS.mediaPrefix.replace(/\/+$/, "")}`,
    resendApiBase: `${guard}${GUARD_ROUTES.resend}`,
    fcmApiBase: `${guard}${GUARD_ROUTES.fcm}`,
    fcmOauthTokenUrl: `${guard}${GUARD_ROUTES.fcmToken}`,
    guardAiUrl: `${guard}${GUARD_ROUTES.ai}`,
  };
}

/** A P-256 pair in the raw base64url shape the web-push spec expects. */
export function generateVapidPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([0x04]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
  return { publicKey: raw.toString("base64url"), privateKey: privateKey.export({ format: "jwk" }).d };
}

/**
 * Well-formed and useless. In rig mode the app sends the guard caller token
 * and never mints a Google token, so this key signs nothing; it exists for
 * the project id in the send path and the schema the app parses.
 */
export function dummyServiceAccount(projectId) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    type: "service_account",
    project_id: projectId,
    private_key_id: "rig-dummy",
    private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
    client_email: `rig-dummy@${projectId}.iam.gserviceaccount.com`,
    client_id: "0",
    token_uri: "https://invalid.rig.internal/token",
  });
}

/**
 * The nonprod Firebase project: firebase-project-id when the store has one,
 * otherwise the project of the nonprod app's google-services.json, which the
 * secret bundle delivers.
 */
export function firebaseProjectId(store) {
  const explicit = store.readOptional("firebase-project-id");
  if (explicit) return explicit;
  const id = store.readJson("android-nonprod-google-services.json").project_info?.project_id;
  if (typeof id !== "string" || id === "") {
    throw new Error("rig: android-nonprod-google-services.json names no project_info.project_id");
  }
  return id;
}

/**
 * The rig's Sentry DSN pointed at rigd's relay, which forwards within the
 * caps. Key and project stay; the host becomes the relay.
 */
export function relayDsn(dsn, relayOrigin) {
  const original = new URL(dsn);
  const relay = new URL(relayOrigin);
  original.protocol = relay.protocol;
  original.host = relay.host;
  return original.toString();
}

/** One `.dev.vars` value, quoted the way dotenv reads it back unchanged. */
export function dotenvValue(value) {
  if (/^[A-Za-z0-9_./:@+=,%*-]*$/.test(value)) return value;
  if (!value.includes("'") && !value.includes("\n")) return `'${value}'`;
  if (!value.includes('"') && !value.includes("\\")) return `"${value.replace(/\n/g, "\\n")}"`;
  throw new Error("rig dev-vars: a value holds both quote kinds or a backslash beside a newline");
}

function lookup(object, path) {
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
}

/**
 * @param {string} template
 * @param {{ store, catalog?: object, partition: object, edge: string, rig: object, supabase: object, derived: object, deploy: object }} context
 */
export function renderDevVars(template, context) {
  const missing = [];
  const lines = [];
  for (const line of template.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim() === "") {
      lines.push(line);
      continue;
    }
    const eq = line.indexOf("=");
    const key = line.slice(0, eq);
    let dropped = false;
    const value = line.slice(eq + 1).replace(PLACEHOLDER, (whole, kind, optional, sep, name, edge) => {
      let resolved;
      if (edge) resolved = context.edge;
      else if (kind === "secret" && sep === ":") resolved = context.store.readOptional(name);
      else if (kind === "catalog" && sep === ":") resolved = context.catalog?.[name];
      else if (kind === "seam" && sep === ".") resolved = seams(context.edge)[name];
      else if (sep === "." && ["partition", "rig", "supabase", "derived", "deploy"].includes(kind)) {
        resolved = lookup(context[kind], name);
      } else throw new Error(`rig dev-vars: ${whole} is not a source the template may name`);
      if (resolved === undefined || resolved === null || resolved === "") {
        if (optional) dropped = true;
        else missing.push(`${key} (${whole})`);
        return "";
      }
      return String(resolved);
    });
    if (!dropped) lines.push(`${key}=${dotenvValue(value)}`);
  }
  if (missing.length > 0) throw new Error(`rig dev-vars: no value for ${missing.join(", ")}`);
  const body = lines.join("\n");
  refuseLiveSecrets(body);
  return body.endsWith("\n") ? body : `${body}\n`;
}

/**
 * The rig holds a sandbox key and caller tokens, never a live vendor key.
 * Whatever the template says, a file holding one is not written.
 */
export function refuseLiveSecrets(body) {
  for (const [key, value] of Object.entries(parseDevVars(body))) {
    if (/(?:^|[^A-Za-z0-9])(?:sk|rk)_live_/.test(value)) {
      throw new Error(`rig dev-vars: refusing to write a live Stripe key into ${key}`);
    }
    if (/^KEY[0-9A-Z_]{16,}/i.test(value)) {
      throw new Error(`rig dev-vars: refusing to write a raw Telnyx key into ${key}`);
    }
  }
}

/** Parses what renderDevVars wrote, for checks that read a value back. */
export function parseDevVars(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    let value = line.slice(eq + 1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\n/g, "\n");
    vars[line.slice(0, eq)] = value;
  }
  return vars;
}
