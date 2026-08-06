"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, MousePointerClick, TrendingDown, TrendingUp } from "lucide-react";
import { api, type MoleculeTrend } from "@/lib/api";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// Leader keeps the brand green; challengers follow a fixed categorical order; Other is always grey.
const LEADER_COLOR = "#0F6E56";
const CHALLENGER_COLORS = ["#2a78d6", "#eb6834", "#eda100", "#7a4f6d"];
const OTHER_COLOR = "#b4b2a9";
const PARTIAL_COLOR = "#9FE1CB";
const LPO_COLOR = "#8a938d";

const AXIS = {
  gridcolor: "#e8ebe7",
  tickfont: { size: 11, color: "#78827c" },
  zerolinecolor: "#dfe3de",
};
// Years are passed as strings — force category so Plotly never treats them as
// a numeric axis (which drops non-numeric labels like "2026 YTD").
const X_AXIS = { ...AXIS, showgrid: false, type: "category" as const };
const LAYOUT_BASE = {
  autosize: true,
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "IBM Plex Sans, system-ui, sans-serif", color: "#5a655f", size: 11 },
  showlegend: false,
  barmode: "stack" as const,
};

function fmtM(v: number) {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function fmtCagr(v?: number | null) {
  if (v == null) return "N/A";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function seriesColor(index: number, name: string, isLeader: boolean) {
  if (name === "Other") return OTHER_COLOR;
  if (isLeader) return LEADER_COLOR;
  return CHALLENGER_COLORS[(index - 1) % CHALLENGER_COLORS.length];
}

// ─── Panel 1: Market trajectory ───────────────────────────────────────────────

function TrajectoryPanel({ trend }: { trend: MoleculeTrend }) {
  const rising =
    trend.total_value.length > 1 &&
    trend.total_value[trend.total_value.length - 1] >= trend.total_value[0];
  const deltaMeaningful = trend.cagr_delta != null && Math.abs(trend.cagr_delta) >= 2;
  const hasPartial = trend.partial.value > 0;

  const labels = trend.years.map(String).concat(hasPartial ? [`${trend.partial.year} YTD`] : []);
  const values = trend.total_value.concat(hasPartial ? [trend.partial.value] : []);
  const colors = trend.years.map(() => LEADER_COLOR).concat(hasPartial ? [PARTIAL_COLOR] : []);

  return (
    <div className="relative">
      {/* KPI block docks to whichever corner the bars leave empty */}
      <div className={`absolute top-1 z-10 flex gap-6 ${rising ? "left-2" : "right-2 text-right"}`}>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400">Market value {trend.years[trend.years.length - 1]}</p>
          <p className="mt-0.5 font-serif text-2xl font-medium text-surface-900">AED {fmtM(trend.total_value[trend.total_value.length - 1])}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400">Value CAGR</p>
          <p className={`mt-0.5 flex items-center gap-1 text-lg font-semibold ${rising ? "" : "justify-end"} ${(trend.value_cagr_pct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {(trend.value_cagr_pct ?? 0) >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {fmtCagr(trend.value_cagr_pct)}
          </p>
          <p className="text-[10px] text-surface-400">units {fmtCagr(trend.unit_cagr_pct)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400">Price signal δCAGR</p>
          <p className={`mt-0.5 text-lg font-semibold ${!deltaMeaningful ? "text-surface-500" : trend.cagr_delta! > 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {trend.cagr_delta == null ? "N/A" : `${trend.cagr_delta > 0 ? "+" : ""}${trend.cagr_delta.toFixed(1)}%`}
          </p>
          <p className="text-[10px] text-surface-400">
            {!deltaMeaningful ? "price ≈ volume growth" : trend.cagr_delta! > 0 ? "prices rising — margin room" : "price compression"}
          </p>
        </div>
      </div>
      <Plot
        data={[{
          type: "bar",
          x: labels,
          y: values,
          marker: { color: colors },
          text: values.map(fmtM),
          textposition: "outside",
          cliponaxis: false,
          textfont: { size: 11, color: "#78827c" },
          hovertemplate: "<b>%{x}</b><br>AED %{y:,.0f}<extra></extra>",
        } as any]}
        layout={{
          ...LAYOUT_BASE,
          height: 290,
          margin: { t: 76, l: 42, r: 8, b: 28 },
          xaxis: X_AXIS,
          yaxis: { ...AXIS, tickformat: "~s", rangemode: "tozero" },
        } as any}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
        useResizeHandler
      />
      {hasPartial && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-surface-400">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PARTIAL_COLOR }} />
          {trend.partial.year} is year-to-date, not a full year
        </p>
      )}
    </div>
  );
}

// ─── Panel 2: Competitive structure ──────────────────────────────────────────

function CompetitorPanel({ trend }: { trend: MoleculeTrend }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggle = (name: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const traces = useMemo(
    () =>
      trend.manufacturers
        .filter((mfr) => !hidden.has(mfr.name))
        .map((mfr) => {
          const index = trend.manufacturers.indexOf(mfr);
          return {
            type: "bar",
            name: mfr.name,
            x: trend.years.map(String),
            y: mfr.values,
            marker: { color: seriesColor(index, mfr.name, index === 0) },
            hovertemplate: `<b>${mfr.name}</b><br>%{x}: AED %{y:,.0f}<extra></extra>`,
          };
        }),
    [trend, hidden],
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {trend.manufacturers.map((mfr, index) => {
          const off = hidden.has(mfr.name);
          const cagrTone =
            mfr.cagr_pct == null ? "text-surface-400" : mfr.cagr_pct >= 0 ? "text-emerald-700" : "text-rose-700";
          return (
            <button
              key={mfr.name}
              type="button"
              onClick={() => toggle(mfr.name)}
              aria-pressed={!off}
              className={`flex items-center gap-1.5 rounded-full border border-surface-200 bg-white px-2.5 py-1 text-[11px] transition-opacity hover:border-surface-300 ${off ? "opacity-40" : ""}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: seriesColor(index, mfr.name, index === 0) }} />
              <span className={`text-surface-700 ${off ? "line-through" : ""}`}>{mfr.name} {mfr.share_pct}%</span>
              <span className={`font-semibold ${cagrTone}`}>{fmtCagr(mfr.cagr_pct)}</span>
              {mfr.entered && mfr.anchor_year && (
                <span className="text-surface-400">entered {mfr.anchor_year}</span>
              )}
            </button>
          );
        })}
      </div>
      <Plot
        data={traces as any}
        layout={{
          ...LAYOUT_BASE,
          height: 260,
          margin: { t: 8, l: 42, r: 8, b: 28 },
          xaxis: X_AXIS,
          yaxis: { ...AXIS, tickformat: "~s", rangemode: "tozero" },
        } as any}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
        useResizeHandler
      />
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-surface-400">
        <MousePointerClick className="h-3.5 w-3.5" />
        Click a manufacturer to hide it — hide the leader to zoom into the challenger pool
      </p>
    </div>
  );
}

// ─── Panel 3: Channel split ───────────────────────────────────────────────────

function ChannelPanel({ trend }: { trend: MoleculeTrend }) {
  const { channel, years } = trend;
  const lastShare = [...channel.private_share_pct].reverse().find((v) => v != null);
  const lpoOutgrowing =
    channel.private_cagr_pct != null &&
    channel.lpo_cagr_pct != null &&
    channel.lpo_cagr_pct > channel.private_cagr_pct + 2;

  return (
    <div className="grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
      <div className="flex flex-row gap-5 sm:flex-col sm:gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400">Private share {years[years.length - 1]}</p>
          <p className="mt-0.5 font-serif text-2xl font-medium text-surface-900">
            {lastShare == null ? "N/A" : `${lastShare.toFixed(1)}%`}
          </p>
          {lastShare != null && (
            <p className={`mt-0.5 flex items-center gap-1 text-[11px] ${lastShare >= 60 ? "text-emerald-700" : "text-amber-700"}`}>
              {lastShare >= 60 ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {lastShare >= 60 ? "above COMIX 60% bar" : "below COMIX 60% bar"}
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400">Private CAGR</p>
          <p className="mt-0.5 text-base font-semibold text-emerald-800">{fmtCagr(channel.private_cagr_pct)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-surface-400">LPO CAGR</p>
          <p className={`mt-0.5 text-base font-semibold ${lpoOutgrowing ? "text-amber-700" : "text-surface-700"}`}>{fmtCagr(channel.lpo_cagr_pct)}</p>
          {lpoOutgrowing && (
            <p className="mt-0.5 flex items-start gap-1 text-[11px] leading-tight text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              LPO outgrowing private — mix drifting to government
            </p>
          )}
        </div>
      </div>
      <div>
        <Plot
          data={[
            {
              type: "bar",
              name: "Private",
              x: years.map(String),
              y: channel.private,
              marker: { color: LEADER_COLOR },
              text: channel.private_share_pct.map((v) => (v == null ? "" : `${Math.round(v)}%`)),
              textposition: "inside",
              insidetextanchor: "middle",
              textfont: { size: 11, color: "#E1F5EE" },
              hovertemplate: "<b>Private</b><br>%{x}: AED %{y:,.0f}<extra></extra>",
            },
            {
              type: "bar",
              name: "LPO / government",
              x: years.map(String),
              y: channel.lpo,
              marker: { color: LPO_COLOR },
              hovertemplate: "<b>LPO / government</b><br>%{x}: AED %{y:,.0f}<extra></extra>",
            },
          ] as any}
          layout={{
            ...LAYOUT_BASE,
            height: 240,
            margin: { t: 8, l: 42, r: 8, b: 28 },
            xaxis: X_AXIS,
            yaxis: { ...AXIS, tickformat: "~s", rangemode: "tozero" },
          } as any}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
          useResizeHandler
        />
        <div className="mt-1 flex justify-center gap-4 text-[11px] text-surface-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: LEADER_COLOR }} />Private</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: LPO_COLOR }} />LPO / government</span>
        </div>
      </div>
    </div>
  );
}

// ─── Wrapper: fetches once, renders all three ────────────────────────────────

export function MoleculeTrendPanels({
  molecule,
  render,
}: {
  molecule: string;
  render: (panels: { trajectory: React.ReactNode; competitors: React.ReactNode; channel: React.ReactNode }) => React.ReactNode;
}) {
  const [trend, setTrend] = useState<MoleculeTrend | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setTrend(null);
    api.getMoleculeTrend(molecule)
      .then((data) => setTrend(data.found ? data : null))
      .catch(() => setTrend(null))
      .finally(() => setLoading(false));
  }, [molecule]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-pharma-900" />
      </div>
    );
  }
  if (!trend) return null;

  return (
    <>
      {render({
        trajectory: <TrajectoryPanel trend={trend} />,
        competitors: <CompetitorPanel trend={trend} />,
        channel: <ChannelPanel trend={trend} />,
      })}
    </>
  );
}
