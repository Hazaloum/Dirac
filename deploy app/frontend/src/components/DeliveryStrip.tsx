"use client";

import { useMemo, useState } from "react";
import type { SupplierOrder } from "@/lib/api";
import { ddmmyy } from "@/lib/dates";

/** Days from batch release to the goods being in Dubai. */
export const TRANSIT_DAYS = 30;

const DAY = 86400000;
const toDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
const title = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();

type State = "arrived" | "transit" | "forecast";
interface Delivery {
  order: SupplierOrder;
  released: string;   // batch release (factory confirmation; a prediction while the order is open)
  arrival: string;    // released + TRANSIT_DAYS
  late: number;       // arrival − requested, days
  lead: number;       // arrival − ordered, days
  planned: number;    // requested − ordered, days
  state: State;
}

/** One entry per order that has an order date, a requested date and a factory date. */
function deliveries(orders: SupplierOrder[]): { list: Delivery[]; noDate: number; unconfirmed: number } {
  const now = Date.now();
  const list: Delivery[] = [];
  let noDate = 0, unconfirmed = 0;
  for (const order of orders) {
    const confirmations = order.lines.map((l) => l.factory_confirmation).filter((d): d is string => !!d);
    if (!confirmations.length || !order.accepted_at || !order.requested_delivery) {
      if (order.completed) noDate++; else unconfirmed++;
      continue;
    }
    const released = confirmations.sort()[confirmations.length - 1];   // in Dubai when its last line is
    const arrivalT = toDay(released) + TRANSIT_DAYS * DAY;
    const ordered = toDay(order.accepted_at.slice(0, 10)), requested = toDay(order.requested_delivery);
    list.push({
      order, released, arrival: isoOf(arrivalT),
      late: Math.round((arrivalT - requested) / DAY),
      lead: Math.round((arrivalT - ordered) / DAY),
      planned: Math.round((requested - ordered) / DAY),
      state: !order.completed ? "forecast" : arrivalT > now ? "transit" : "arrived",
    });
  }
  list.sort((a, b) => (a.order.accepted_at ?? "").localeCompare(b.order.accepted_at ?? ""));
  return { list, noDate, unconfirmed };
}

function summary(list: Delivery[]) {
  const arrived = list.filter((d) => d.state === "arrived");
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  return {
    arrived,
    late: avg(arrived.map((d) => d.late)),
    onTime: arrived.filter((d) => d.late <= 0).length,
    lead: avg(arrived.map((d) => d.lead)),
    planned: avg(arrived.map((d) => d.planned)),
    worst: [...arrived].sort((a, b) => b.late - a.late)[0],
  };
}

const COLOR: Record<State | "early", string> = {
  arrived: "#be123c",   // rose-700 — arrived late
  early: "#047857",     // emerald-700 — arrived on time
  transit: "#b45309",   // amber-700
  forecast: "none",
};

function Chart({ list, onHover }: { list: Delivery[]; onHover: (d: Delivery | null) => void }) {
  const W = Math.max(560, list.length * 22 + 60), H = 210, L = 44, R = 8, T = 10, B = 26;
  const lo = Math.min(-60, Math.floor(Math.min(...list.map((d) => d.late)) / 60) * 60);
  const hi = Math.max(60, Math.ceil(Math.max(...list.map((d) => d.late)) / 60) * 60);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const slot = (W - L - R) / list.length;
  const bw = Math.min(14, slot - 6);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 60) ticks.push(v);
  let lastYear = "";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Days late in Dubai per order">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#737f79" : "#e7e9e5"}
            strokeDasharray={v === 0 ? undefined : "2 3"} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#737f79">{v === 0 ? "0" : signed(v)}</text>
        </g>
      ))}
      {list.map((d, i) => {
        const x = L + i * slot + (slot - bw) / 2;
        const top = Math.min(y(0), y(d.late)), h = Math.max(1.5, Math.abs(y(d.late) - y(0)));
        const fill = d.state === "arrived" && d.late <= 0 ? COLOR.early : COLOR[d.state];
        const year = (d.order.accepted_at ?? "").slice(0, 4);
        const newYear = year !== lastYear;
        lastYear = year;
        return (
          <g key={d.order.ref}>
            {newYear && <text x={x} y={H - 6} fontSize={10} fill="#737f79">{year}</text>}
            <rect x={x} y={top} width={bw} height={h} rx={2} fill={fill}
              stroke={d.state === "forecast" ? "#737f79" : undefined}
              strokeDasharray={d.state === "forecast" ? "3 2" : undefined}
              onMouseEnter={() => onHover(d)} onMouseLeave={() => onHover(null)} />
          </g>
        );
      })}
    </svg>
  );
}

/** Delivery performance across all orders: estimated arrival in Dubai vs the requested date. */
export default function DeliveryStrip({ orders }: { orders: SupplierOrder[] }) {
  const [molecule, setMolecule] = useState("");
  const [hover, setHover] = useState<Delivery | null>(null);

  const all = useMemo(() => deliveries(orders), [orders]);
  const molecules = useMemo(
    () => Array.from(new Set(all.list.map((d) => d.order.molecule).filter((m): m is string => !!m))).sort(),
    [all]);
  const list = molecule ? all.list.filter((d) => d.order.molecule === molecule) : all.list;
  const s = summary(list);
  const ahead = list.filter((d) => d.state !== "arrived");
  const aheadLate = ahead.filter((d) => d.late > 0).length;
  if (!all.list.length) return null;

  const kpi = "flex min-w-0 flex-col gap-0.5 px-5 py-3.5";
  const label = "text-[11px] font-medium uppercase tracking-wide text-surface-500";
  const value = "font-mono text-2xl font-medium tabular-nums";

  return (
    <section className="mb-8 overflow-hidden rounded-xl border border-surface-300 bg-white" aria-label="Delivery performance">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 border-b border-surface-200 px-5 py-3">
        <h2 className="text-[15px] font-semibold text-surface-900">Delivery vs requested</h2>
        <span className="text-xs text-surface-500">In Dubai = batch release + {TRANSIT_DAYS} days</span>
        <div className="ml-auto flex gap-1 rounded-full bg-surface-100 p-1">
          {["", ...molecules].map((m) => (
            <button key={m || "all"} onClick={() => setMolecule(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${molecule === m ? "bg-pharma-700 text-white" : "text-surface-600 hover:text-surface-900"}`}>
              {m ? title(m) : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 divide-surface-200 md:grid-cols-4 md:divide-x [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-surface-200 md:[&>*:nth-child(n+3)]:border-t-0">
        <div className={kpi}>
          <span className={label}>Avg arrival vs requested</span>
          <span className={`${value} ${s.late != null && s.late > 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {s.late == null ? "—" : `${signed(s.late)} d`}
          </span>
          <span className="text-xs text-surface-600">{s.arrived.length} delivered orders</span>
        </div>
        <div className={kpi}>
          <span className={label}>On time</span>
          <span className={`${value} ${s.arrived.length && s.onTime * 2 < s.arrived.length ? "text-rose-700" : "text-emerald-700"}`}>
            {s.arrived.length ? `${s.onTime}/${s.arrived.length}` : "—"}
          </span>
          <span className="text-xs text-surface-600">in Dubai by the requested date</span>
        </div>
        <div className={kpi}>
          <span className={label}>Order → Dubai</span>
          <span className={`${value} text-surface-900`}>{s.lead == null ? "—" : `${s.lead} d`}</span>
          <span className="text-xs text-surface-600">you plan for {s.planned ?? "—"} d</span>
        </div>
        <div className={kpi}>
          <span className={label}>On the way, heading late</span>
          <span className={`${value} ${aheadLate ? "text-amber-700" : "text-emerald-700"}`}>{aheadLate}/{ahead.length}</span>
          <span className="text-xs text-surface-600">on factory dates</span>
        </div>
      </div>

      <div className="grid border-t border-surface-200 md:grid-cols-[minmax(0,1fr)_250px]">
        <div className="min-w-0 px-5 py-3.5">
          <h3 className="mb-1 text-xs font-semibold text-surface-600">Days late in Dubai, per order (by order date)</h3>
          <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-surface-500">
            <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-emerald-700" />Arrived on time</span>
            <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-rose-700" />Arrived late</span>
            <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-amber-700" />Released, in transit</span>
            <span><i className="mr-1.5 inline-block h-2 w-2 rounded-sm border border-dashed border-surface-500" />Factory forecast</span>
          </div>
          <div className="overflow-x-auto">
            {list.length ? <Chart list={list} onHover={setHover} /> : <p className="py-8 text-sm text-surface-500">No dated orders.</p>}
          </div>
          <p className="min-h-[2.5rem] text-xs text-surface-600">
            {hover ? (
              <>
                <b className="font-semibold text-surface-900">{hover.order.ref}</b> · {hover.order.items.join(" · ")}<br />
                Ordered {ddmmyy(hover.order.accepted_at)} · requested {ddmmyy(hover.order.requested_delivery)} ·
                batch release {ddmmyy(hover.released)}{hover.state === "forecast" ? " (pred.)" : ""} ·
                in Dubai ≈ {ddmmyy(hover.arrival)} · <b className="font-semibold">{signed(hover.late)} days</b>
              </>
            ) : <span className="text-surface-400">Hover a bar for the order&apos;s dates.</span>}
          </p>
        </div>

        <div className="flex flex-col gap-3.5 border-t border-surface-200 px-5 py-3.5 md:border-l md:border-t-0">
          <h3 className="text-xs font-semibold text-surface-600">By molecule (delivered)</h3>
          {molecules.map((m) => {
            const ms = summary(all.list.filter((d) => d.order.molecule === m));
            const n = ms.arrived.length;
            if (!n) return null;
            return (
              <div key={m} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium text-surface-900">{title(m)}</span>
                  <span className={`font-mono tabular-nums ${ms.late! > 0 ? "text-rose-700" : "text-emerald-700"}`}>{signed(ms.late!)} d</span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-200">
                  <span className="bg-emerald-700" style={{ width: `${(ms.onTime / n) * 100}%` }} />
                  <span className="bg-rose-700" style={{ width: `${((n - ms.onTime) / n) * 100}%` }} />
                </div>
                <span className="text-[11px] text-surface-500">
                  {ms.onTime} of {n} on time{ms.worst && ms.worst.late > 0 ? ` · worst ${ms.worst.order.ref} ${signed(ms.worst.late)} d` : ""}
                </span>
              </div>
            );
          })}
          <p className="border-t border-surface-200 pt-2.5 text-[11px] leading-relaxed text-surface-500">
            Leaves out {all.noDate} completed order{all.noDate === 1 ? "" : "s"} with no factory date and {all.unconfirmed} open
            order{all.unconfirmed === 1 ? "" : "s"} the factory hasn&apos;t dated yet. Release dates on open orders are Tecnimede&apos;s forecast.
          </p>
        </div>
      </div>
    </section>
  );
}
