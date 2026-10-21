"use client";

import dynamic from "next/dynamic";
import type { Competition, CompetitorRow } from "@/lib/api";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// Same order as the market breakdown chart's competitor colours.
const PALETTE = ["#0F6E56", "#2a78d6", "#eb6834", "#eda100"];
const colour = (i: number) => PALETTE[i] ?? "#b4b2a9";

function fmtAed(v: number) {
  if (v >= 1_000_000) return `AED ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `AED ${(v / 1_000).toFixed(0)}K`;
  return `AED ${Math.round(v)}`;
}

const pct = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(1) : "<0.1");

function hhiLabel(hhi: number) {
  if (hhi > 2500) return { text: "Highly concentrated", cls: "bg-rose-50 text-rose-700" };
  if (hhi >= 1500) return { text: "Moderately concentrated", cls: "bg-amber-50 text-amber-800" };
  return { text: "Competitive", cls: "bg-emerald-50 text-emerald-700" };
}

function Stat({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-50 p-4">
      <p className="text-[10px] uppercase tracking-wider text-surface-400">{label}</p>
      <p className="mt-1 font-serif text-3xl font-medium tracking-tight text-surface-900">{value}</p>
      {children && <div className="mt-2 text-[11px] text-surface-500">{children}</div>}
    </div>
  );
}

function PlayerCard({ r, rank }: { r: CompetitorRow; rank: number }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-surface-400">#{rank} · {r.originator ? "Originator" : "Generic"}</span>
        {r.new ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">New {r.launch}</span>
        ) : r.cagr != null ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.cagr < 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {r.cagr >= 0 ? "+" : ""}{r.cagr.toFixed(1)}% / yr
          </span>
        ) : null}
      </div>
      <p className="mt-2 truncate font-serif text-xl font-medium text-surface-900">{r.product}</p>
      <p className="truncate text-xs text-surface-500">{r.manufacturer}{r.launch ? ` · since ${r.launch}` : ""}</p>
      <p className="mt-3 font-serif text-4xl font-medium tracking-tight" style={{ color: rank === 1 ? colour(0) : undefined }}>
        {pct(r.share_pct)}%
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-100">
        <div className="h-full rounded-full" style={{ width: `${Math.max(r.share_pct, 1)}%`, background: colour(rank - 1) }} />
      </div>
      <p className="mt-2 text-[11px] text-surface-500">
        {fmtAed(r.value)}{r.private_pct != null ? ` · ${Math.round(r.private_pct)}% private` : ""}
      </p>
    </div>
  );
}

export function CompetitionPanel({ c }: { c: Competition }) {
  const rows = c.manufacturers;
  if (!rows.length) return null;
  let running = 0;
  const cumulative = rows.map((r) => (running += r.share_pct));
  const names = rows.map((r) => r.manufacturer);
  const hhi = c.hhi != null ? hhiLabel(c.hhi) : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Concentration (HHI)" value={c.hhi != null ? c.hhi.toLocaleString() : "—"}>
          {hhi && <span className={`rounded-full px-2 py-0.5 font-semibold ${hhi.cls}`}>{hhi.text}</span>}
          <p className="mt-1.5 text-surface-400">10,000 = one company · above 2,500 = concentrated</p>
        </Stat>
        <Stat label={`Top ${Math.min(3, rows.length)} hold`} value={c.top3_pct != null ? `${c.top3_pct.toFixed(1)}%` : "—"}>
          of value in {c.end_year}
        </Stat>
        <Stat label="Generics hold" value={c.generic_pct != null ? `${c.generic_pct.toFixed(1)}%` : "—"}>
          {c.generics_selling} generic{c.generics_selling === 1 ? "" : "s"} selling
        </Stat>
        <Stat label={`Exits since ${c.start_year}`}
          value={<>{c.exits.length}{c.generics_ever > 0 && <span className="text-base text-surface-400"> of {c.generics_ever}</span>}</>}>
          {c.exits.length ? "stopped selling" : "nobody stopped selling"}
        </Stat>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {rows.slice(0, 3).map((r, i) => <PlayerCard key={r.manufacturer} r={r} rank={i + 1} />)}
      </div>

      {rows.length > 1 && (
        <div className="rounded-xl border border-surface-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-surface-400">Pareto · share of value by manufacturer, {c.end_year}</p>
            {c.to_80_pct != null && (
              <p className="text-xs text-surface-500">
                {c.to_80_pct} manufacturer{c.to_80_pct === 1 ? "" : "s"} = 80% of the market
              </p>
            )}
          </div>
          <Plot
            data={[
              {
                type: "bar", x: names, y: rows.map((r) => r.share_pct),
                marker: { color: rows.map((_, i) => colour(i)) },
                hovertemplate: "<b>%{x}</b><br>%{y:.1f}% of value<extra></extra>",
              },
              {
                type: "scatter", mode: "lines+markers", x: names, y: cumulative,
                line: { color: "#5F5E5A", width: 1.5 }, marker: { size: 6, color: "#5F5E5A" },
                hovertemplate: "Cumulative %{y:.1f}%<extra></extra>",
              },
            ] as any}
            layout={{
              autosize: true, height: 260, margin: { t: 12, l: 40, r: 8, b: 60 },
              paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
              font: { family: "IBM Plex Sans, system-ui, sans-serif", color: "#5a655f", size: 11 },
              showlegend: false,
              xaxis: { showgrid: false, type: "category", tickfont: { size: 11, color: "#78827c" }, tickangle: rows.length > 6 ? -30 : 0 },
              yaxis: { range: [0, 102], gridcolor: "#e8ebe7", ticksuffix: "%", tickfont: { size: 11, color: "#78827c" } },
            } as any}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%" }}
            useResizeHandler
          />
        </div>
      )}

      {c.exits.length > 0 && (
        <div className="rounded-xl border border-surface-200 bg-white px-4 py-3">
          <p className="text-[10px] uppercase tracking-wider text-surface-400">Stopped selling since {c.start_year} · sales in {c.start_year}</p>
          <p className="mt-1.5 text-xs leading-6 text-surface-600">
            {c.exits.map((e, i) => (
              <span key={e.manufacturer}>
                {i > 0 && <span className="text-surface-300"> · </span>}
                <span className="text-surface-800">{e.product}</span> ({e.manufacturer}) {e.last_value >= 1000 ? fmtAed(e.last_value) : "< AED 1K"}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
