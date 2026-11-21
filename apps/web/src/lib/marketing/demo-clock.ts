import type { MarketingLocale } from "@/i18n/marketing/footer";

type EnglishClock = `${number}:${number} ${"AM" | "PM"}`;

export function demoClock(time: EnglishClock, locale: MarketingLocale): string {
  if (locale === "en") return time;
  const [hour, minute, period] = time.split(/[: ]/);
  const hour24 = (Number(hour) % 12) + (period === "PM" ? 12 : 0);
  return `${hour24} h ${minute}`;
}
