"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Ship } from "lucide-react";
import { api, type PoTracker, type SupplierOrder, type SupplierOrderLine } from "@/lib/api";
import { ddmmyy, ddmmyyTime } from "@/lib/dates";
import DeliveryStrip from "@/components/DeliveryStrip";

/** Short names for the portal's four statuses, in order (PoTracker.stages holds the portal's names). */
const STOP_NAMES = ["Registered", "At factory", "Batch release", "Ready for pickup"];
const PORTAL_STATUS = ["Order Registered", "Order Placed to Factory", "Order with Logistics Operator",
  "Completed (Order Available for Pickup)"];

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

// ─── One line as bus stops ────────────────────────────────────────────────────
function Stops({ line }: { line: SupplierOrderLine }) {
  const stage = line.stage ?? -1;
  const done = line.stage === STOP_NAMES.length - 1;
  const overdue = overdueDays(line.requested_delivery, done);
  const lateBy = line.factory_confirmation && line.requested_delivery
    ? daysBetween(line.requested_delivery, line.factory_confirmation) : 0;
  const seen = (i: number) => line.stage_seen?.[PORTAL_STATUS[i]];
  const muted = "text-surface-400";

  // A date under every stop: what the portal gives, or the day our sync saw the line get there.
  const under: JSX.Element[] = [
    <span key="0" title="Acceptance date — when the order was placed">{fmt(line.accepted_at)}</span>,
    seen(1)
      ? <span key="1" title="First seen at the factory">{fmt(seen(1)!)}</span>
      : <span key="1" className={muted} title="The portal gives no date for this step">—</span>,
    line.factory_confirmation
      ? <span key="2" title="Factory confirmation — predicted batch release">
          {stage >= 2 && seen(2) ? fmt(seen(2)!) : `batch ${fmt(line.factory_confirmation)}`}{stage < 2 ? " (pred.)" : ""}
        </span>
      : seen(2) ? <span key="2">{fmt(seen(2)!)}</span> : <span key="2" className={muted}>—</span>,
    done
      ? <span key="3">{seen(3) ? fmt(seen(3)!) : "done"}</span>
      : <span key="3" className={overdue ? "font-medium text-rose-700" : ""} title="Requested delivery date">
          req. {fmt(line.requested_delivery)}{overdue ? ` · ${overdue}d late` : ""}
        </span>,
  ];

  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-4 py-3">
      <div className="pt-0.5">
        <p className="text-sm font-medium text-surface-900">{line.item_description}</p>
        <p className="text-xs text-surface-500">
          Line {line.order_line.split("|")[1]?.trim() ?? line.order_line} · {(line.order_quantity ?? 0).toLocaleString()} packs
          {line.pending_quantity != null && line.pending_quantity !== line.order_quantity && !done
            ? ` · ${line.pending_quantity.toLocaleString()} pending` : ""}
        </p>
        {!done && lateBy > 0 && (
          <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
            {lateBy} days after requested
          </span>
        )}
      </div>
      <div className="relative">
        {/* track: from the first stop's centre to the last's */}
        <div className="absolute left-[12.5%] right-[12.5%] top-[11px] h-1 rounded-full bg-surface-200" />
        <div className="absolute left-[12.5%] top-[11px] h-1 rounded-full bg-pharma-700"
          style={{ width: `${(Math.max(stage, 0) / (STOP_NAMES.length - 1)) * 75}%` }} />
        <div className="relative grid grid-cols-4">
          {STOP_NAMES.map((name, i) => {
            const passed = i < stage || done;
            const here = i === stage && !done;
            return (
              <div key={name} className="flex flex-col items-center text-center">
                {here ? (
                  <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border-[3px] border-pharma-700 bg-white">
                    <span className="h-3 w-3 rounded-full bg-pharma-700" />
                  </span>
                ) : (
                  <span className={`mt-[3px] h-5 w-5 rounded-full border-[3px] ${passed ? "border-pharma-700 bg-pharma-700" : "border-surface-300 bg-white"}`} />
                )}
                <span className={`mt-1.5 text-[11px] ${here ? "font-semibold text-pharma-800" : passed ? "text-surface-700" : "text-surface-400"}`}>{name}</span>
                <span className="text-[11px] text-surface-500">{under[i]}</span>
              </div>
            );
          })}
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
        {order.lines.map((line) => <Stops key={line.id} line={line} />)}
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
