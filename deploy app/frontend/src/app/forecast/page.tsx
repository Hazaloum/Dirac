"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp, ArrowLeft, Loader2, Download, ChevronDown, ChevronUp,
  FlaskConical, AlertTriangle,
} from "lucide-react";
import { api, type MoleculeCard, type MoleculeForecast, type ForecastResult } from "@/lib/api";
import { FORECAST_SESSION_KEY, type ForecastSession } from "@/lib/forecastSession";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtAed(v: number) {
  if (v >= 1_000_000_000) return `AED ${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `AED ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `AED ${(v / 1_000).toFixed(0)}K`;
  return `AED ${v.toFixed(0)}`;
}

function fmtUnits(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return Math.round(v).toLocaleString();
}

// ─── XLSX export ──────────────────────────────────────────────────────────────
function applyFmts(ws: Record<string, any>, colFmts: Record<number, string>, nRows: number, XLSX: any) {
  for (const [col, fmt] of Object.entries(colFmts)) {
    for (let row = 1; row <= nRows; row++) {
      const addr = XLSX.utils.encode_cell({ r: row, c: Number(col) });
      if (ws[addr]) ws[addr].z = fmt;
    }
  }
}

async function exportXlsx(forecasts: MoleculeForecast[], growthRate: number) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Pack detail
  const packRows = forecasts.flatMap(f => {
    const topMfr = [...f.packs].sort((a, b) => b.pack_share - a.pack_share)[0]?.manufacturer ?? "";
    return f.packs.map(p => ({
      "MOLECULE":                f.molecule,
      "TOP PRODUCT":             f.product,
      "TOP MANUFACTURER":        topMfr,
      "TOTAL MKT UNITS":         Math.round(f.total_market_units),
      "TOTAL MKT VALUE (AED)":   Math.round(f.total_market_value),
      "MANUFACTURER":            p.manufacturer,
      "PACK":                    p.pack,
      "RETAIL (AED)":            parseFloat(p.retail_price.toFixed(2)),
      "CIF (AED)":               parseFloat(p.cif_price.toFixed(2)),
      "SHARE (%)":               parseFloat((p.pack_share * 100).toFixed(1)),
      "Y1 UNITS":                Math.round(p.y1_units),
      "Y2 UNITS":                Math.round(p.y2_units),
      "Y3 UNITS":                Math.round(p.y3_units),
      "Y1 REV (AED)":            Math.round(p.y1_revenue),
      "Y2 REV (AED)":            Math.round(p.y2_revenue),
      "Y3 REV (AED)":            Math.round(p.y3_revenue),
    }));
  });
  const packWs = XLSX.utils.json_to_sheet(packRows);
  // col 3=TOTAL MKT UNITS, 4=TOTAL MKT VALUE, 7=RETAIL, 8=CIF, 9=SHARE, 10-12=UNITS, 13-15=REV
  applyFmts(packWs, {
    3: '#,##0', 4: '#,##0',
    7: '#,##0.00', 8: '#,##0.00',
    9: '0.0"%"',
    10: '#,##0', 11: '#,##0', 12: '#,##0',
    13: '#,##0', 14: '#,##0', 15: '#,##0',
  }, packRows.length, XLSX);
  XLSX.utils.book_append_sheet(wb, packWs, "Forecast");

  // Sheet 2 — Molecule summary
  const summaryRows = forecasts.map(f => ({
    "MOLECULE":           f.molecule,
    "TOP PRODUCT":        f.product,
    "YEAR":               f.analysis_year,
    "COMPETITORS":        f.competitors,
    "PENETRATION (%)":    parseFloat(f.penetration_pct.replace("%", "")),
    "GROWTH RATE (%)":    Math.round(growthRate * 100),
    "MARKET VALUE (AED)": Math.round(f.total_market_value),
    "Y1 UNITS":           Math.round(f.summary.total_y1_units),
    "Y2 UNITS":           Math.round(f.summary.total_y2_units),
    "Y3 UNITS":           Math.round(f.summary.total_y3_units),
    "Y1 REV (AED)":       Math.round(f.summary.total_y1_revenue),
    "Y2 REV (AED)":       Math.round(f.summary.total_y2_revenue),
    "Y3 REV (AED)":       Math.round(f.summary.total_y3_revenue),
    "3Y TOTAL (AED)":     Math.round(f.summary.total_y1_revenue + f.summary.total_y2_revenue + f.summary.total_y3_revenue),
  }));
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  applyFmts(summaryWs, {
    4: '0.0"%"', 5: '0"%"',
    6: '#,##0',
    7: '#,##0', 8: '#,##0', 9: '#,##0',
    10: '#,##0', 11: '#,##0', 12: '#,##0', 13: '#,##0',
  }, summaryRows.length, XLSX);
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  XLSX.writeFile(wb, `COMIX_Forecast_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ForecastPage() {
  const router = useRouter();

  const [session,      setSession]      = useState<ForecastSession | null>(null);
  const [growthRate,   setGrowthRate]   = useState(0.15);
  const [forecastData, setForecastData] = useState<ForecastResult | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set());

  // Load session from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FORECAST_SESSION_KEY);
      if (raw) setSession(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Auto-run forecast when session loads
  useEffect(() => {
    if (session && session.molecules.length > 0) runForecast(session, growthRate);
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const runForecast = async (s: ForecastSession, gr: number) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getForecast(s.molecules.map(m => m.molecule), gr);
      setForecastData(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Forecast failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = () => {
    if (session) runForecast(session, growthRate);
  };

  const toggleExpand = (mol: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(mol) ? n.delete(mol) : n.add(mol); return n; });

  // ── Empty state ──
  if (!session || session.molecules.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <TrendingUp className="w-12 h-12 text-surface-300 mx-auto" />
          <p className="text-surface-600 text-sm">No forecast session found.</p>
          <p className="text-surface-400 text-xs">Go to the Analysis page, shortlist molecules, then click Generate Forecasts.</p>
          <button onClick={() => router.push("/analysis")}
            className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-pharma-900 text-white text-sm font-medium hover:bg-pharma-800 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Analysis
          </button>
        </div>
      </div>
    );
  }

  const totalMolecules = session.molecules.length;
  const totalMarketValue = session.molecules.reduce((s, m) => s + (m.market_value_aed ?? 0), 0);

  // Portfolio 3Y total
  const total3Y = forecastData
    ? forecastData.forecasts.reduce(
        (s, f) => s + f.summary.total_y1_revenue + f.summary.total_y2_revenue + f.summary.total_y3_revenue, 0
      )
    : null;

  return (
    <div className="min-h-screen p-8 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/analysis")}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-surface-300 text-sm text-surface-600 hover:text-surface-900 hover:bg-surface-100 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Analysis
          </button>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-3">
              <TrendingUp className="w-6 h-6 text-pharma-900" />
              Revenue Forecast
            </h1>
            <p className="text-sm text-surface-500 mt-0.5">
              Y1–Y3 projections for {totalMolecules} shortlisted molecule{totalMolecules !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {forecastData && (
          <button
            onClick={() => exportXlsx(forecastData.forecasts, growthRate)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 transition-colors"
          >
            <Download className="w-4 h-4" /> Export XLSX
          </button>
        )}
      </div>

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-surface-200 px-4 py-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider">Molecules</p>
          <p className="text-2xl font-bold text-surface-900">{totalMolecules}</p>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 px-4 py-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider">Total Market Value</p>
          <p className="text-lg font-bold text-pharma-900">{fmtAed(totalMarketValue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 px-4 py-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider">Growth Rate</p>
          <p className="text-2xl font-bold text-surface-900">{Math.round(growthRate * 100)}%</p>
        </div>
        <div className="bg-white rounded-xl border border-surface-200 px-4 py-3">
          <p className="text-[10px] text-surface-500 uppercase tracking-wider">Total 3Y Revenue</p>
          <p className="text-lg font-bold text-emerald-700">{total3Y != null ? fmtAed(total3Y) : "—"}</p>
        </div>
      </div>

      {/* ── Molecule cards grouped by ATC1 ── */}
      <div className="space-y-3">
        {Object.entries(session.molecules_by_atc1).map(([atc1, names]) => {
          const cards = session.molecules.filter(m =>
            names.some(n => n.toUpperCase() === m.molecule.toUpperCase())
          );
          if (!cards.length) return null;
          const groupValue = cards.reduce((s, m) => s + (m.market_value_aed ?? 0), 0);
          const atcCode = atc1.split(" ")[0];
          const atcName = atc1.split(" ").slice(1).join(" ") || atc1;
          return (
            <div key={atc1} className="bg-white rounded-xl border border-surface-200 p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2.5 py-1 text-xs font-semibold bg-pharma-50 text-pharma-900 border border-pharma-200 rounded-xl">{atcCode}</span>
                <span className="text-sm font-medium text-surface-800 flex-1">{atcName}</span>
                {groupValue > 0 && (
                  <span className="text-xs font-semibold text-pharma-900">{fmtAed(groupValue)}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {cards.map(m => (
                  <div key={m.molecule} className="flex items-center gap-1.5 px-3 py-1.5 bg-pharma-50 border border-pharma-200 rounded-xl">
                    <FlaskConical className="w-3.5 h-3.5 text-pharma-900" />
                    <span className="text-xs font-medium text-pharma-900">{m.molecule}</span>
                    {m.market_value_aed != null && m.market_value_aed > 0 && (
                      <span className="text-[10px] text-pharma-700/60">· {fmtAed(m.market_value_aed)}</span>
                    )}
                    {m.value_cagr_pct != null && (
                      <span className={`text-[10px] font-semibold ${m.value_cagr_pct >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                        {m.value_cagr_pct >= 0 ? "+" : ""}{m.value_cagr_pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Ungrouped molecules */}
        {(() => {
          const grouped = new Set(
            Object.values(session.molecules_by_atc1).flat().map(n => n.toUpperCase())
          );
          const ungrouped = session.molecules.filter(m => !grouped.has(m.molecule.toUpperCase()));
          if (!ungrouped.length) return null;
          return (
            <div className="bg-white rounded-xl border border-surface-200 p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2.5 py-1 text-xs font-semibold bg-surface-100 text-surface-500 border border-surface-200 rounded-xl">?</span>
                <span className="text-sm font-medium text-surface-600">No ATC classification</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ungrouped.map(m => (
                  <div key={m.molecule} className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-50 border border-surface-200 rounded-xl">
                    <FlaskConical className="w-3.5 h-3.5 text-surface-500" />
                    <span className="text-xs font-medium text-surface-700">{m.molecule}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Growth rate + generate ── */}
      <div className="flex items-center gap-6 p-5 bg-white rounded-xl border border-surface-200">
        <div className="flex-1">
          <label className="block text-xs font-medium text-surface-600 mb-2">
            Growth Rate (Y1 → Y2 → Y3)
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={5} max={30} step={5}
              value={Math.round(growthRate * 100)}
              onChange={e => setGrowthRate(Number(e.target.value) / 100)}
              className="flex-1 accent-pharma-900"
            />
            <span className="text-lg font-bold text-pharma-900 w-12 text-right">
              {Math.round(growthRate * 100)}%
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-surface-400 mt-1 px-0.5">
            {[5, 10, 15, 20, 25, 30].map(v => <span key={v}>{v}%</span>)}
          </div>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pharma-900 text-white text-sm font-medium hover:bg-pharma-800 disabled:opacity-60 transition-colors shrink-0"
        >
          {loading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
            : <><TrendingUp className="w-4 h-4" /> Generate Forecast</>
          }
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && !forecastData && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-xl bg-surface-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Results ── */}
      {forecastData && forecastData.forecasts.length > 0 && (
        <div className="space-y-4">

          {/* Y1 / Y2 / Y3 summary cards */}
          <div className="grid grid-cols-3 gap-3">
            {(["Y1", "Y2", "Y3"] as const).map((y, i) => {
              const revKey = (["total_y1_revenue", "total_y2_revenue", "total_y3_revenue"] as const)[i];
              const unitKey = (["total_y1_units", "total_y2_units", "total_y3_units"] as const)[i];
              const totalRev   = forecastData.forecasts.reduce((s, f) => s + f.summary[revKey], 0);
              const totalUnits = forecastData.forecasts.reduce((s, f) => s + f.summary[unitKey], 0);
              return (
                <div key={y} className="bg-white rounded-xl border border-surface-200 p-4 text-center">
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-2">Year {i + 1}</p>
                  <p className="text-xl font-bold text-pharma-900">{fmtAed(totalRev)}</p>
                  <p className="text-xs text-surface-400 mt-0.5">{fmtUnits(totalUnits)} units</p>
                </div>
              );
            })}
          </div>

          {/* Per-molecule expandable rows */}
          <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-200 bg-surface-50">
              <p className="text-xs font-semibold text-surface-600 uppercase tracking-wider">
                Molecule Breakdown — {forecastData.forecasts.length} molecule{forecastData.forecasts.length !== 1 ? "s" : ""}
              </p>
            </div>

            {forecastData.forecasts.map((fc, idx) => {
              const isExpanded = expanded.has(fc.molecule);
              const mol3Y = fc.summary.total_y1_revenue + fc.summary.total_y2_revenue + fc.summary.total_y3_revenue;
              return (
                <div key={fc.molecule} className={idx > 0 ? "border-t border-surface-200" : ""}>
                  {/* Summary row */}
                  <button
                    onClick={() => toggleExpand(fc.molecule)}
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-surface-900">{fc.molecule}</span>
                        <span className="text-[10px] bg-surface-100 text-surface-500 border border-surface-200 px-1.5 py-0.5 rounded-full">
                          {fc.product}
                        </span>
                        <span className="text-[10px] bg-pharma-50 text-pharma-800 border border-pharma-200 px-1.5 py-0.5 rounded-full">
                          {fc.competitors} competitor{fc.competitors !== 1 ? "s" : ""} · {fc.penetration_pct}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-5 shrink-0">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-surface-500">Y1</p>
                        <p className="text-sm font-bold text-surface-800">{fmtAed(fc.summary.total_y1_revenue)}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-surface-500">Y2</p>
                        <p className="text-sm font-bold text-surface-800">{fmtAed(fc.summary.total_y2_revenue)}</p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] text-surface-500">Y3</p>
                        <p className="text-sm font-bold text-surface-800">{fmtAed(fc.summary.total_y3_revenue)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-surface-500">3Y Total</p>
                        <p className="text-sm font-bold text-emerald-700">{fmtAed(mol3Y)}</p>
                      </div>
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-surface-400" />
                        : <ChevronDown className="w-4 h-4 text-surface-400" />
                      }
                    </div>
                  </button>

                  {/* Pack-level table */}
                  {isExpanded && (
                    <div className="border-t border-surface-100 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-surface-50">
                          <tr>
                            {[
                              "Manufacturer", "Pack", "Retail (AED)", "CIF (AED)",
                              "Share", "Y1 Units", "Y2 Units", "Y3 Units",
                              "Y1 Rev", "Y2 Rev", "Y3 Rev",
                            ].map(h => (
                              <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-surface-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-100">
                          {fc.packs.map((p, i) => (
                            <tr key={i} className="hover:bg-surface-50 transition-colors">
                              <td className="px-3 py-2 text-surface-700 font-medium whitespace-nowrap">{p.manufacturer}</td>
                              <td className="px-3 py-2 text-surface-600 whitespace-nowrap">{p.pack}</td>
                              <td className="px-3 py-2 text-surface-700 text-right">{p.retail_price.toFixed(2)}</td>
                              <td className="px-3 py-2 text-surface-700 text-right">{p.cif_price.toFixed(2)}</td>
                              <td className="px-3 py-2 text-surface-600 text-right">{(p.pack_share * 100).toFixed(1)}%</td>
                              <td className="px-3 py-2 text-surface-700 text-right">{fmtUnits(p.y1_units)}</td>
                              <td className="px-3 py-2 text-surface-700 text-right">{fmtUnits(p.y2_units)}</td>
                              <td className="px-3 py-2 text-surface-700 text-right">{fmtUnits(p.y3_units)}</td>
                              <td className="px-3 py-2 text-emerald-700 font-semibold text-right">{fmtAed(p.y1_revenue)}</td>
                              <td className="px-3 py-2 text-emerald-700 font-semibold text-right">{fmtAed(p.y2_revenue)}</td>
                              <td className="px-3 py-2 text-emerald-700 font-semibold text-right">{fmtAed(p.y3_revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Errors */}
          {forecastData.errors.length > 0 && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700 space-y-1">
              <p className="font-semibold flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                {forecastData.errors.length} molecule{forecastData.errors.length !== 1 ? "s" : ""} could not be forecasted:
              </p>
              {forecastData.errors.map(e => <p key={e.molecule} className="pl-5">{e.molecule}: {e.error}</p>)}
            </div>
          )}

          {/* Bottom export button */}
          <div className="flex justify-end">
            <button
              onClick={() => exportXlsx(forecastData.forecasts, growthRate)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 transition-colors"
            >
              <Download className="w-4 h-4" /> Export XLSX
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
