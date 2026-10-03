"use client";

import { useEffect, useMemo, useState } from "react";
import { Ship } from "lucide-react";
import { api, type PoTracker, type SupplierOrder, type SupplierOrderLine } from "@/lib/api";

/** Short names for the portal's four statuses, in order (PoTracker.stages holds the portal's names). */
const STOP_NAMES = ["Registered", "At factory", "With logistics", "Ready for pickup"];
const PORTAL_STATUS = ["Order Registered", "Order Placed to Factory", "Order with Logistics Operator",
  "Completed (Order Available for Pickup)"];

const today = () => new Date().toISOString().slice(0, 10);

function fmt(iso: string | null, withYear = false) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

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
function OrderCard({ order }: { order: SupplierOrder }) {
  const overdue = overdueDays(order.requested_delivery, order.completed);
  return (
    <section className="rounded-xl border border-surface-300 bg-white px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-surface-900">{order.ref}</h2>
        <span className="text-sm text-surface-600">{order.items.join(" · ")}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-surface-500">
          Ordered {fmt(order.accepted_at, true)}
          {order.completed ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">Ready for pickup</span>
          ) : overdue ? (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700"
              title={`Requested ${fmt(order.requested_delivery, true)}`}>
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

  useEffect(() => { api.getPoTracker().then(setData).catch((e: Error) => setError(e.message)); }, []);

  const counts = useMemo(() => ({
    open: data?.orders.filter((o) => !o.completed).length ?? 0,
    completed: data?.orders.filter((o) => o.completed).length ?? 0,
    all: data?.orders.length ?? 0,
  }), [data]);
  const shown = (data?.orders ?? []).filter((o) => filter === "all" || (filter === "open") === !o.completed);

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Ship className="h-7 w-7 text-pharma-700" />
        <h1 className="text-3xl font-semibold text-surface-900">PO Tracker</h1>
        {data?.synced_at && (
          <span className="text-xs text-surface-400">
            Tecnimede · synced {new Date(data.synced_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
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
      {!data && !error && <p className="text-surface-500">Loading orders…</p>}
      {data && data.orders.length === 0 && (
        <div className="rounded-xl border border-surface-300 bg-white p-8 text-center text-sm text-surface-600">
          No orders yet — run <code className="rounded bg-surface-100 px-1">python scripts/sync_tecnimede.py</code> from the backend folder.
        </div>
      )}
      <div className="space-y-4">
        {shown.map((order) => <OrderCard key={order.ref} order={order} />)}
      </div>
    </main>
  );
}
