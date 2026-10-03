/** All dates in Dirac are shown as DD/MM/YY (times as DD/MM/YY HH:MM). */

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parse what the backend sends: "YYYY-MM-DD" (a calendar date, no timezone),
 * "YYYY-MM-DD HH:MM" (saved in UTC) or a full ISO timestamp.
 */
function parse(value: string): Date | null {
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const utc = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  const d = new Date(utc ? `${utc[1]}-${utc[2]}-${utc[3]}T${utc[4]}:${utc[5]}:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ddmmyy(value: string | null | undefined): string {
  if (!value) return "—";
  const d = parse(value);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}` : value;
}

export function ddmmyyTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = parse(value);
  return d ? `${ddmmyy(value)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : value;
}
