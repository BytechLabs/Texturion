const MONEY = /(?<![\p{L}\p{N}])(?<french>\d+(?:[ \u00A0\u202F]\d{3})*(?:,\d{1,2})?)\s*\$(?:\s*(?:CA|US)(?!\p{L}))?|\$\s*(?<prefixed>\d[\d,]*(?:\.\d{1,2})?)|(?<![\p{L}\p{N}])(?<english>\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars|bucks|usd|cad)(?!\p{L})/giu;

export function moneyAmounts(text: string): Set<string> {
  const found = new Set<string>();
  for (const { groups } of text.matchAll(MONEY)) {
    const french = groups?.french;
    const amount = french
      ? french.replaceAll(/[ \u00A0\u202F]/gu, "").replace(",", ".")
      : (groups?.prefixed ?? groups?.english ?? "").replaceAll(",", "");
    const [units, fraction = ""] = amount.split(".");
    found.add(`${units.replace(/^0+(?=\d)/u, "")}.${fraction.padEnd(2, "0")}`);
  }
  return found;
}
