/**
 * How the rig starts Chromium for a call lane.
 *
 * The fake microphone plays the member's code from a WAV and the permission
 * prompt is answered yes (chromium media_switches.cc). Production's hosts do
 * not resolve at all: a page that tried to reach the production API, web app
 * or any hosted Supabase project fails to look the name up, before a
 * connection exists. The rig's DNS blocks the same names; this is the second
 * lock on the same door.
 */

export const BLOCKED_HOSTS = ["loonext.com", "*.loonext.com", "supabase.co", "*.supabase.co"] as const;

/** Chromium's `--host-resolver-rules` value: every listed pattern fails to resolve. */
export function hostResolverRules(blocked: readonly string[] = BLOCKED_HOSTS): string {
  for (const host of blocked) {
    if (!/^(\*\.)?[a-z0-9.-]+$/.test(host)) throw new Error(`hostResolverRules: "${host}" is not a host pattern`);
  }
  return blocked.map((host) => `MAP ${host} ~NOTFOUND`).join(", ");
}

export interface ChromiumArgOptions {
  /** The member's code, from writeFakeMicWavs. */
  fakeMicWav: string;
  blocked?: readonly string[];
}

export function chromiumArgs(options: ChromiumArgOptions): string[] {
  if (/[\s"]/.test(options.fakeMicWav)) throw new Error("chromiumArgs: the fake microphone path must not contain spaces or quotes");
  return [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${options.fakeMicWav}`,
    `--host-resolver-rules=${hostResolverRules(options.blocked)}`,
    // The judge's audio element and context start without a click.
    "--autoplay-policy=no-user-gesture-required",
  ];
}
