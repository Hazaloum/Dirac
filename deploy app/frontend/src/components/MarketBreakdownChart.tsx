"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Loader2, MousePointerClick } from "lucide-react";
import { api, type MoleculeSlices, type SliceSeries } from "@/lib/api";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type Metric = "value" | "units";
type Market = "total" | "private" | "lpo";
type Split = "channel" | "product" | "strength" | "nfc3";

const PALETTE = ["#0F6E56", "#2a78d6", "#eb6834", "#eda100"];
const MARKET_LABELS: Record<Market, string> = { total: "Total", private: "Private", lpo: "LPO" };
const SPLIT_LABELS: Record<Split, string> = { channel: "Channel", product: "Product", strength: "Strength", nfc3: "NFC3" };

function seriesColor(name: string, index: number) {
  if (name === "Other") return "#b4b2a9";
  if (name === "LPO / government") return "#8a938d";
  return PALETTE[index % PALETTE.length];
}

function fmt(v: number) {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(Math.round(v));
}

// CAGR anchored at the first non-zero full year.
function cagr(values: number[]): number | null {
  const end = values[values.length - 1];
  if (end <= 0) return null;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] > 0) return (Math.pow(end / values[i], 1 / (values.length - 1 - i)) - 1) * 100;
  }
  return null;
}

function fmtCagr(v: number | null) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function Pills<T extends string>({ value, options, onChange }: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full border border-surface-200 bg-surface-50 p-[3px]">
      {options.map(([key, label]) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`rounded-full px-3 py-1 text-xs transition-all ${
              active
                ? "border border-surface-200 bg-white font-semibold text-surface-900 shadow-sm"
                : "border border-transparent text-surface-500 hover:text-surface-800"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function MarketBreakdownChart({ molecule }: { molecule: string }) {
  const [slices, setSlices] = useState<MoleculeSlices | null>(null);
  const [loading, setLoading] = useState(true);
  const [byCompetitor, setByCompetitor] = useState(true);
  const [market, setMarket] = useState<Market>("total");
  const [split, setSplit] = useState<Split>("channel");
  const [metric, setMetric] = useState<Metric>("value");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setSlices(null);
    setHidden(new Set());
    api.getMoleculeTrend(molecule)
      .then((data) => setSlices(data.found ? data : null))
      .catch(() => setSlices(null))
      .finally(() => setLoading(false));
  }, [molecule]);

  const lens = byCompetitor ? `mfr:${market}` : `dim:${split}`;
  const keyOf = (name: string) => `${lens}:${name}`;

  const series: SliceSeries[] = useMemo(() => {
    if (!slices) return [];
    if (byCompetitor) return slices.competitor[market]?.[metric] ?? [];
    return slices.dims[split]?.[metric] ?? [];
  }, [slices, byCompetitor, market, split, metric]);

  const availableSplits = useMemo(
    () => (slices ? (Object.keys(SPLIT_LABELS) as Split[]).filter((s) => slices.dims[s]) : []),
    [slices],
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-pharma-900" />
      </div>
    );
  }
  if (!slices || !series.length) return null;

  const { years, partial_year } = slices;
  const hasPartial = series.some((s) => s.partial > 0);
  const labels = years.map(String).concat(hasPartial ? [`${partial_year} YTD`] : []);
  const visible = series.filter((s) => !hidden.has(keyOf(s.name)));

  const fullValues = (s: SliceSeries) => s.values.concat(hasPartial ? [s.partial] : []);
  const totalsByYear = labels.map((_, i) => visible.reduce((sum, s) => sum + fullValues(s)[i], 0));
  const endTotalsAll = series.reduce((sum, s) => sum + s.values[s.values.length - 1], 0);
  const totalsCagr = cagr(years.map((_, i) => visible.reduce((sum, s) => sum + s.values[i], 0)));

  // Percentage labels inside the first segment when exactly two are visible.
  const twoSegment = visible.length === 2;
  const insideText = twoSegment
    ? labels.map((_, i) => {
        const a = fullValues(visible[0])[i];
        const total = totalsByYear[i];
        return total > 0 && a / total > 0.12 ? `${Math.round((a / total) * 100)}%` : "";
      })
    : undefined;

  const traces: object[] = visible.map((s) => {
    const index = series.indexOf(s);
    const isFirstVisible = visible[0] === s;
    return {
      type: "bar",
      name: s.name,
      x: labels,
      y: fullValues(s),
      marker: { color: seriesColor(s.name, index) },
      ...(twoSegment && isFirstVisible
        ? { text: insideText, textposition: "inside", insidetextanchor: "middle", textfont: { size: 11, color: "#E1F5EE" } }
        : {}),
      hovertemplate: `<b>${s.name}</b><br>%{x}: ${metric === "value" ? "AED " : ""}%{y:,.0f}${metric === "units" ? " units" : ""}<extra></extra>`,
    };
  });
  // Year totals above each stack.
  traces.push({
    type: "scatter",
    mode: "text",
    x: labels,
    y: totalsByYear,
    text: totalsByYear.map((t) => (t > 0 ? fmt(t) : "")),
    textposition: "top center",
    textfont: { size: 11, color: "#78827c" },
    cliponaxis: false,
    hoverinfo: "skip",
    showlegend: false,
  });

  // Channel headline facts stay pinned regardless of the selected lens.
  const channel = slices.dims.channel?.[metric];
  const privateSeries = channel?.find((s) => s.name === "Private");
  const lpoSeries = channel?.find((s) => s.name !== "Private");
  const privateShare =
    privateSeries && lpoSeries
      ? (privateSeries.values[privateSeries.values.length - 1] /
          (privateSeries.values[privateSeries.values.length - 1] + lpoSeries.values[lpoSeries.values.length - 1])) * 100
      : null;

  const endYear = years[years.length - 1];

  return (
    <div>
      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setByCompetitor((v) => !v)}
          aria-pressed={byCompetitor}
          className="flex items-center gap-2 rounded-full border border-surface-200 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 transition-colors hover:border-surface-300"
        >
          <span className={`relative h-4 w-7 rounded-full transition-colors ${byCompetitor ? "bg-pharma-900" : "bg-surface-300"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${byCompetitor ? "left-3.5" : "left-0.5"}`} />
          </span>
          By competitor
        </button>
        {byCompetitor ? (
          <Pills value={market} options={[["total", "Total"], ["private", "Private"], ["lpo", "LPO"]]} onChange={setMarket} />
        ) : (
          <Pills value={split} options={availableSplits.map((s) => [s, SPLIT_LABELS[s]] as [Split, string])} onChange={setSplit} />
        )}
        <Pills value={metric} options={[["value", "Value"], ["units", "Units"]]} onChange={setMetric} />
      </div>

      {/* KPI row — always describes exactly what the chart shows */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400">
            {byCompetitor ? MARKET_LABELS[market] : "Total"} {metric} {endYear}
          </p>
          <p className="mt-0.5 font-serif text-4xl font-medium tracking-tight text-surface-900">
            {metric === "value" ? "AED " : ""}{fmt(series.reduce((sum, s) => sum + s.values[s.values.length - 1], 0))}{metric === "units" ? " units" : ""}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400">CAGR {years[0]}→{endYear}</p>
          <p className={`mt-0.5 font-serif text-3xl font-medium tracking-tight ${totalsCagr != null && totalsCagr < 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {fmtCagr(totalsCagr)}
          </p>
        </div>
        {privateShare != null && privateSeries && lpoSeries && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-surface-400">Private / LPO {endYear}</p>
            <p className="mt-0.5 font-serif text-3xl font-medium tracking-tight text-surface-900">
              {privateShare.toFixed(0)}<span className="text-surface-400"> / </span>{(100 - privateShare).toFixed(0)}
            </p>
            <p className="text-[10px] text-surface-400">
              private {fmtCagr(cagr(privateSeries.values))}/yr · LPO {fmtCagr(cagr(lpoSeries.values))}/yr
            </p>
          </div>
        )}
      </div>

      {/* Legend chips: share + CAGR per series, click to hide */}
      <div className="mb-1 flex flex-wrap gap-1.5">
        {series.map((s, index) => {
          const off = hidden.has(keyOf(s.name));
          const share = endTotalsAll > 0 ? (s.values[s.values.length - 1] / endTotalsAll) * 100 : 0;
          const growth = cagr(s.values);
          return (
            <button
              key={s.name}
              type="button"
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(keyOf(s.name))) next.delete(keyOf(s.name));
                  else next.add(keyOf(s.name));
                  return next;
                })
              }
              aria-pressed={!off}
              className={`flex items-center gap-1.5 rounded-full border border-surface-200 bg-white px-2.5 py-1 text-[11px] transition-opacity hover:border-surface-300 ${off ? "opacity-40" : ""}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(s.name, index) }} />
              <span className={`text-surface-700 ${off ? "line-through" : ""}`}>{s.name} {share.toFixed(1)}%</span>
              <span className={`font-semibold ${growth != null && growth < 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmtCagr(growth)}</span>
            </button>
          );
        })}
      </div>

      <Plot
        data={traces as any}
        layout={{
          autosize: true,
          height: 300,
          margin: { t: 26, l: 46, r: 8, b: 28 },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          font: { family: "IBM Plex Sans, system-ui, sans-serif", color: "#5a655f", size: 11 },
          showlegend: false,
          barmode: "stack",
          xaxis: { showgrid: false, type: "category", tickfont: { size: 11, color: "#78827c" } },
          yaxis: { gridcolor: "#e8ebe7", tickfont: { size: 11, color: "#78827c" }, tickformat: "~s", rangemode: "tozero" },
        } as any}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
        useResizeHandler
      />

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-surface-400">
        <span className="flex items-center gap-1.5">
          <MousePointerClick className="h-3.5 w-3.5" />
          {byCompetitor
            ? "Click a competitor to hide it — or switch off “By competitor” to slice by channel, product, strength, or form"
            : "Pick a lens above — switch “By competitor” back on for market ownership"}
        </span>
        {hasPartial && <span>{partial_year} is year-to-date, not a full year</span>}
      </div>
    </div>
  );
}
