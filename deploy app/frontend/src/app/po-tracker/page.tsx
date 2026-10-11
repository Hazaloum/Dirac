"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Ship } from "lucide-react";
import { api, type PoTracker, type SupplierOrder, type SupplierOrderLine } from "@/lib/api";
import { ddmmyy, ddmmyyTime } from "@/lib/dates";
import DeliveryStrip, { TRANSIT_DAYS } from "@/components/DeliveryStrip";

const today = () => new Date().toISOString().slice(0, 10);

const fmt = (iso: string | null) => ddmmyy(iso);

function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Days past the requested date, or 0 if not overdue. */
function overdueDays(requested: string | null, completed: boolean) {
  return !completed && requested && requested < today() ? daysBetween(requested, today()) : 0;
}

// ─── One line as two timelines: expected vs actual ───────────────────────────
const DAY = 86400000;
const dayOf = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const AT_FACTORY = "Order Placed to Factory";

/** The dates one line's two timelines are drawn from (day numbers, UTC). */
function lineDates(line: SupplierOrderLine) {
  const ordered = line.accepted_at ? dayOf(line.accepted_at.slice(0, 10)) : null;
  const requested = line.requested_delivery ? dayOf(line.requested_delivery) : null;
  const release = line.factory_confirmation ? dayOf(line.factory_confirmation) : null;
  const factory = line.stage_seen?.[AT_FACTORY] ? dayOf(line.stage_seen[AT_FACTORY]) : null;
  const arrival = release != null ? release + TRANSIT_DAYS * DAY : null;
  return { ordered, requested, release, factory, arrival };
}

/** One date range shared by every line of an order, so their bars line up. */
function orderDomain(order: SupplierOrder): [number, number] | null {
  const now = dayOf(today());
  const ts: number[] = [];
  for (const l of order.lines) {
    const d = lineDates(l);
    for (const t of [d.ordered, d.requested, d.arrival]) if (t != null) ts.push(t);
    if (!order.completed) ts.push(now);
  }
  if (!ts.length) return null;
  const lo = Math.min(...ts), hi = Math.max(...ts);
  return [lo, hi + Math.max(7 * DAY, (hi - lo) * 0.02)];
}

function Timeline({ line, domain }: { line: SupplierOrderLine; domain: [number, number] | null }) {
  const done = !line.open;
  const d = lineDates(line);
  const now = dayOf(today());
  const pct = (t: number) => domain ? `${((t - domain[0]) / (domain[1] - domain[0])) * 100}%` : "0%";
  const span = (a: number, b: number) => ({ left: pct(Math.min(a, b)), width: `calc(${pct(Math.max(a, b))} - ${pct(Math.min(a, b))})` });
  const days = (a: number, b: number) => Math.round((b - a) / DAY);
  const delay = d.arrival != null && d.requested != null ? days(d.requested, d.arrival) : null;
  const showToday = !done && domain && now >= domain[0] && now <= domain[1];
  const predicted = !done;   // an open line's factory date is Tecnimede's forecast

  const label = "w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide text-surface-500";
  const track = "relative h-5 flex-1";
  const dot = "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white";

  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-4 py-3">
      <div className="pt-0.5">
        <p className="text-sm font-medium text-surface-900">{line.item_description}</p>
        <p className="text-xs text-surface-500">
          Line {line.order_line.split("|")[1]?.trim() ?? line.order_line} · {(line.order_quantity ?? 0).toLocaleString()} packs
          {line.pending_quantity ? ` · ${line.pending_quantity.toLocaleString()} pending` : ""}
        </p>
        <p className="mt-0.5 text-[11px] text-surface-500">{line.status ?? "—"}</p>
        {delay != null && (
          <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${delay > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}
            title="Estimated arrival in Dubai vs the requested date">
            {delay > 0 ? `${plural(delay, "day")} late` : delay < 0 ? `${plural(-delay, "day")} early` : "On time"}
            {predicted ? " (pred.)" : ""}
          </span>
        )}
      </div>

      <div className="min-w-0 space-y-2.5">
        {/* Expected: ordered → requested in Dubai */}
        <div>
          <div className="flex items-center gap-2">
            <span className={label}>Expected</span>
            <div className={track}>
              {showToday && <div className="absolute inset-y-[-4px] w-px bg-surface-400" style={{ left: pct(now) }} />}
              {d.ordered != null && d.requested != null && <>
                <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-pharma-200" style={span(d.ordered, d.requested)} />
                <span className={`${dot} bg-pharma-400`} style={{ left: pct(d.ordered) }} title={`Ordered ${fmt(isoOf(d.ordered))}`} />
                <span className={`${dot} bg-pharma-700`} style={{ left: pct(d.requested) }} title={`Requested in Dubai ${fmt(isoOf(d.requested))}`} />
              </>}
            </div>
          </div>
          <p className="ml-[4.5rem] text-[11px] text-surface-500">
            Ordered {fmt(line.accepted_at)} → in Dubai {fmt(line.requested_delivery)}
            {d.ordered != null && d.requested != null ? ` · ${days(d.ordered, d.requested)} d` : ""}
          </p>
        </div>

        {/* Actual: ordered → at factory → batch release → in Dubai (release + transit) */}
        <div>
          <div className="flex items-center gap-2">
            <span className={label}>Actual</span>
            <div className={track}>
              {showToday && <div className="absolute inset-y-[-4px] w-px bg-surface-400" style={{ left: pct(now) }} title={`Today ${fmt(today())}`} />}
              {d.ordered != null && d.arrival != null && d.release != null ? <>
                {/* gap between requested and arrival: the delay (red) or the margin (green) */}
                {d.requested != null && delay !== 0 && (
                  <div className={`absolute top-1/2 h-4 -translate-y-1/2 ${delay! > 0 ? "bg-rose-100" : "bg-emerald-100"}`}
                    style={span(d.requested, d.arrival)} />
                )}
                <div className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${predicted ? "border border-dashed border-pharma-700 bg-pharma-100" : "bg-pharma-700"}`}
                  style={span(d.ordered, d.release)} />
                <div className="absolute top-1/2 h-0 -translate-y-1/2 border-t-2 border-dotted border-pharma-700" style={span(d.release, d.arrival)} />
                <span className={`${dot} bg-pharma-400`} style={{ left: pct(d.ordered) }} title={`Ordered ${fmt(isoOf(d.ordered))}`} />
                {d.factory != null && <span className={`${dot} bg-pharma-500`} style={{ left: pct(d.factory) }} title={`At factory ${fmt(isoOf(d.factory))}`} />}
                <span className={`${dot} bg-pharma-700`} style={{ left: pct(d.release) }}
                  title={`Batch release ${fmt(isoOf(d.release))}${predicted ? " (pred.)" : ""}`} />
                <span className={`${dot} ${delay! > 0 ? "bg-rose-700" : "bg-emerald-700"}`} style={{ left: pct(d.arrival) }}
                  title={`In Dubai ≈ ${fmt(isoOf(d.arrival))}`} />
                {delay !== 0 && d.requested != null && (
                  <span className={`absolute -top-3 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold ${delay! > 0 ? "text-rose-700" : "text-emerald-700"}`}
                    style={{ left: pct((d.requested + d.arrival) / 2) }}>
                    {delay! > 0 ? "+" : "−"}{Math.abs(delay!)} d
                  </span>
                )}
              </> : d.ordered != null && <>
                <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-300" style={span(d.ordered, done ? d.ordered : now)} />
                <span className={`${dot} bg-pharma-400`} style={{ left: pct(d.ordered) }} />
                {d.factory != null && <span className={`${dot} bg-pharma-500`} style={{ left: pct(d.factory) }} title={`At factory ${fmt(isoOf(d.factory))}`} />}
              </>}
            </div>
          </div>
          <p className="ml-[4.5rem] text-[11px] text-surface-500">
            {d.release != null && d.arrival != null ? <>
              Ordered {fmt(line.accepted_at)}
              {d.factory != null ? ` · at factory ${fmt(isoOf(d.factory))}` : ""}
              {` · batch release ${fmt(line.factory_confirmation)}${predicted ? " (pred.)" : ""}`}
              {` → in Dubai ≈ ${fmt(isoOf(d.arrival))}`}
              {d.ordered != null ? ` · ${days(d.ordered, d.arrival)} d` : ""}
            </> : done ? "No factory date given" : "Awaiting factory date"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── One order (customer reference) ──────────────────────────────────────────
const title = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();

function MoleculeLink({ order, portfolio, onLinked }: {
  order: SupplierOrder; portfolio: string[]; onLinked: (ref: string, molecule: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const molecule = order.molecule ?? "";
  // Keep a linked molecule selectable even if it has since left the portfolio.
  const options = molecule && !portfolio.includes(molecule) ? [molecule, ...portfolio] : portfolio;

  async function change(value: string) {
    setSaving(true); setFailed(false);
    try {
      await api.setPoMolecule(order.ref, value || null);
      onLinked(order.ref, value || null);   // moves the card into its molecule's group
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-surface-500">
      <select value={molecule} onChange={(e) => change(e.target.value)} disabled={saving}
        title="Link this order to a molecule in My Portfolio"
        className={`rounded-lg border px-2 py-1 text-xs ${molecule ? "border-pharma-700 bg-pharma-50 font-medium text-pharma-800" : "border-dashed border-surface-300 text-surface-500"}`}>
        <option value="">Link molecule…</option>
        {options.map((m) => <option key={m} value={m}>{title(m)}</option>)}
      </select>
      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {failed && <span className="text-rose-700">Couldn&apos;t save</span>}
    </label>
  );
}

function OrderCard({ order, portfolio, onLinked }: {
  order: SupplierOrder; portfolio: string[]; onLinked: (ref: string, molecule: string | null) => void;
}) {
  const overdue = overdueDays(order.requested_delivery, order.completed);
  const domain = orderDomain(order);
  return (
    <section className="rounded-xl border border-surface-300 bg-white px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-surface-900">{order.ref}</h2>
        <MoleculeLink order={order} portfolio={portfolio} onLinked={onLinked} />
        <span className="text-sm text-surface-600">{order.items.join(" · ")}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-surface-500">
          Ordered {fmt(order.accepted_at)}
          {order.completed ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">Ready for pickup</span>
          ) : overdue ? (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700"
              title={`Requested ${fmt(order.requested_delivery)}`}>
              Overdue by {plural(overdue, "day")} · requested {fmt(order.requested_delivery)}
            </span>
          ) : (
            <span className="rounded-full bg-surface-100 px-2 py-0.5 font-medium text-surface-700">Requested {fmt(order.requested_delivery)}</span>
          )}
        </span>
      </div>
      <div className="mt-1 divide-y divide-surface-100">
        {order.lines.map((line) => <Timeline key={line.id} line={line} domain={domain} />)}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
type Filter = "open" | "completed" | "all";

export default function PoTrackerPage() {
  const [data, setData] = useState<PoTracker | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [syncing, setSyncing] = useState(false);

  const load = () => api.getPoTracker().then(setData).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function syncNow() {
    setSyncing(true); setError("");
    try {
      await api.syncPoTracker();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }
  const failed = data?.last_sync && !data.last_sync.ok ? data.last_sync : null;

  const counts = useMemo(() => ({
    open: data?.orders.filter((o) => !o.completed).length ?? 0,
    completed: data?.orders.filter((o) => o.completed).length ?? 0,
    all: data?.orders.length ?? 0,
  }), [data]);
  const shown = (data?.orders ?? []).filter((o) => filter === "all" || (filter === "open") === !o.completed);

  // Linked orders grouped by molecule (A–Z), unlinked ones last; order within a group is kept.
  const byMolecule = new Map<string, SupplierOrder[]>();
  for (const o of shown) byMolecule.set(o.molecule ?? "", [...(byMolecule.get(o.molecule ?? "") ?? []), o]);
  const groups = Array.from(byMolecule.entries())
    .sort(([a], [b]) => (a === "") === (b === "") ? a.localeCompare(b) : a === "" ? 1 : -1);
  const anyLinked = groups.some(([m]) => m !== "");

  const onLinked = (ref: string, molecule: string | null) =>
    setData((d) => d && { ...d, orders: d.orders.map((o) => (o.ref === ref ? { ...o, molecule } : o)) });

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Ship className="h-7 w-7 text-pharma-700" />
        <h1 className="text-3xl font-semibold text-surface-900">PO Tracker</h1>
        {data?.synced_at && (
          <span className="text-xs text-surface-400">
            Tecnimede · synced {ddmmyyTime(data.synced_at)}
          </span>
        )}
        <button onClick={syncNow} disabled={syncing}
          title="Pull the latest from the Tecnimede portal (also runs every day at 09:00)"
          className="flex items-center gap-1.5 rounded-lg border border-pharma-700 px-3 py-1.5 text-xs font-medium text-pharma-800 hover:bg-pharma-50 disabled:opacity-60">
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {syncing ? "Syncing… (up to a minute)" : "Sync"}
        </button>
        <div className="ml-auto flex gap-1 rounded-full bg-surface-100 p-1">
          {(["open", "completed", "all"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${filter === f ? "bg-pharma-700 text-white" : "text-surface-600 hover:text-surface-900"}`}>
              {f} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!error && failed && (
        <div role="alert" className="mb-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          The {failed.trigger === "schedule" ? "09:00" : "last"} sync on {ddmmyyTime(failed.at)} failed: {failed.error}
        </div>
      )}
      {!data && !error && <p className="text-surface-500">Loading orders…</p>}
      {data && data.orders.length === 0 && (
        <div className="rounded-xl border border-surface-300 bg-white p-8 text-center text-sm text-surface-600">
          No orders yet — run <code className="rounded bg-surface-100 px-1">python scripts/sync_tecnimede.py</code> from the backend folder.
        </div>
      )}
      {data && <DeliveryStrip orders={data.orders} />}
      <div className="space-y-8">
        {groups.map(([molecule, orders]) => (
          <section key={molecule || "unlinked"}>
            {anyLinked && (
              <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-surface-600">
                {molecule ? title(molecule) : "Not linked yet"}
                <span className="font-normal normal-case tracking-normal text-surface-400">{plural(orders.length, "order")}</span>
              </h2>
            )}
            <div className="space-y-4">
              {orders.map((order) => (
                <OrderCard key={order.ref} order={order} portfolio={data?.portfolio ?? []} onLinked={onLinked} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
