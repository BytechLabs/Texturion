const DIAL_ENDPOINTS: ReadonlySet<string> = new Set(["POST /v2/calls", "POST /v2/calls/:id/actions/transfer"]);

// Unknown outcomes may have placed a dial. Guard refusals and Telnyx 4xx responses did not.
export function dialsInLog(activity: Readonly<Record<string, number>>): number {
  let total = 0;
  for (const [key, count] of Object.entries(activity)) {
    const [, method = "", path = "", outcome = ""] = key.split(" ");
    if (!DIAL_ENDPOINTS.has(`${method} ${path}`)) continue;
    if (/^4\d\d$/.test(outcome) || !(/^\d+$/.test(outcome) || outcome === "error")) continue;
    total += count;
  }
  return total;
}
