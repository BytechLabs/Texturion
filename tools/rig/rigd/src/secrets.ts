/**
 * Secret delivery (`/ctl/secrets`): the `rig` GitHub
 * environment's secrets, sealed to a key whose private half lives only in the
 * rig's store, kept on the edge as ciphertext and opened here.
 *
 * The format and the opening are the edge's (tools/edge/scripts/seal-bundle.mjs:
 * X25519, HKDF-SHA-256, AES-256-GCM); rigd loads that module rather than keep
 * a second copy of the cryptography. Each secret is written to the store as
 * its own file. No value is ever logged; the result lists names only.
 */
import { EDGE_PATHS } from "@loonext/rig-protocol";
import { storeNameOf, type SecretFiles } from "@loonext/rig-robot";

/** The rig's half of the bundle key: an X25519 private JWK, made at bootstrap. */
export const BUNDLE_KEY_SECRET = "bundle-private-key.json";
export const CONTROL_TOKEN_SECRET = "control-token-rig";

export interface OpenedBundle {
  sealed_at?: string;
  secrets: Record<string, string>;
  absent?: string[];
}

export type BundleOpener = (privateKeyJwk: JsonWebKey, bundle: unknown) => Promise<OpenedBundle>;

/** The edge's own opener, loaded where the repository has it. */
export const edgeOpener: BundleOpener = async (privateKeyJwk, bundle) => {
  const module = (await import(new URL("../../../edge/scripts/seal-bundle.mjs", import.meta.url).href)) as {
    importRecipientKey(jwk: JsonWebKey): Promise<CryptoKey>;
    openBundle(key: CryptoKey, bundle: unknown): Promise<OpenedBundle>;
  };
  return module.openBundle(await module.importRecipientKey(privateKeyJwk), bundle);
};

export interface DeliveryResult {
  written: string[];
  absent: string[];
  sealed_at?: string;
}

export async function deliverSecrets(options: {
  edgeOrigin: string;
  store: SecretFiles;
  open?: BundleOpener;
  fetch?: typeof fetch;
}): Promise<DeliveryResult> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(`${options.edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.ctlSecrets}`, {
    headers: { authorization: `Bearer ${options.store.read(CONTROL_TOKEN_SECRET)}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`rigd: /ctl/secrets answered ${response.status}`);
  const bundle: unknown = await response.json();
  const opened = await (options.open ?? edgeOpener)(options.store.readJson<JsonWebKey>(BUNDLE_KEY_SECRET), bundle);
  if (!opened || typeof opened.secrets !== "object" || opened.secrets === null) {
    throw new Error("rigd: the bundle holds no secrets");
  }
  const written: string[] = [];
  for (const [name, value] of Object.entries(opened.secrets)) {
    if (typeof value !== "string" || value === "") continue;
    const file = storeNameOf(name);
    // The key that opens the bundle is never replaced from inside it.
    if (file === BUNDLE_KEY_SECRET) continue;
    options.store.write(file, value);
    written.push(file);
  }
  return { written: written.sort(), absent: opened.absent ?? [], sealed_at: opened.sealed_at };
}
