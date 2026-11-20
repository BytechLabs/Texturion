export function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function requireString(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected a string in the test fixture");
  return value;
}
