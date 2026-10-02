import type { AccountType, Sku } from "./types";

export function skuLabel(s: Pick<Sku, "molecule" | "strength" | "form" | "pack_size">): string {
  const form = (s.form ?? "").toLowerCase();
  const formS = form.charAt(0).toUpperCase() + form.slice(1);
  const pack = s.pack_size ?? "";
  const packS = /^\d+$/.test(pack) ? `Pack of ${pack}` : pack;
  return `${s.molecule} ${s.strength ?? ""} · ${formS} · ${packS}`.replace(/\s+/g, " ").trim();
}

export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function today(): string {
  return ymd(new Date());
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

/** Whole days between a timestamp and now (local). */
export function daysAgo(iso: string): number {
  const a = new Date(iso);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(new Date()) - start(a)) / 86400000);
}

export function lastSeen(iso: string | null): string {
  if (!iso) return "Never visited";
  const n = daysAgo(iso);
  if (n <= 0) return "Seen today";
  if (n === 1) return "Last seen yesterday";
  return `Last seen ${n} days ago`;
}

export function typeLabel(t: AccountType): string {
  return t === "doctor" ? "Doctor" : t === "pharmacy" ? "Pharmacy" : "Hospital";
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Monday 00:00 of the current week (local). */
export function weekStart(): Date {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
