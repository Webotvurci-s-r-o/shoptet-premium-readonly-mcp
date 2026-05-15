/**
 * Normalize a user-supplied date (YYYY-MM-DD or ISO string) into the
 * ISO 8601 form that Shoptet expects ("2017-12-12T22:08:01+0100").
 * Bare dates are anchored to start-of-day in the local TZ.
 */
export function toShoptetDate(input: string | undefined, end = false): string | undefined {
  if (!input) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  if (dateOnly) {
    return end ? `${input}T23:59:59+0000` : `${input}T00:00:00+0000`;
  }
  return input;
}

export function parseNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Round to 2 decimals. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function bucketKey(date: string, granularity: "day" | "week" | "month" | "year"): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "unknown";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  if (granularity === "year") return String(yyyy);
  if (granularity === "month") return `${yyyy}-${mm}`;
  if (granularity === "day") return `${yyyy}-${mm}-${dd}`;
  // week: ISO week number
  const target = new Date(Date.UTC(yyyy, d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function topN<T>(items: T[], n: number, scoreOf: (t: T) => number): T[] {
  return [...items].sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, n);
}
