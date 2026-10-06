"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Paperclip } from "lucide-react";
import { api, type MoleculeForecast } from "@/lib/api";
import { exportXlsx, fmtAed, fmtUnits, forecastXlsxFile } from "@/lib/forecastExport";

/** Y1–Y3 forecast for one molecule, with growth rate, pack table, XLSX export and attach. */
export function InlineForecast({ molecule, onAttach }: {
  molecule: string;
  /** Attach the XLSX somewhere (the deal); hidden when not given. */
  onAttach?: (file: File) => Promise<void>;
}) {
  const [growth, setGrowth] = useState(0.15);
  const [forecast, setForecast] = useState<MoleculeForecast | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(""); setAttached(false);
    api.getForecast([molecule], growth)
      .then((r) => {
        if (!live) return;
        if (r.forecasts[0]) setForecast(r.forecasts[0]);
        else setError(r.errors[0]?.error || "No forecast for this molecule (it needs an IQVIA match).");
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [molecule, growth]);

  async function attach() {
    if (!forecast || !onAttach) return;
    setAttaching(true); setError("");
    try {
      await onAttach(await forecastXlsxFile([forecast], growth));
      setAttached(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't attach the forecast");
    } finally {
      setAttaching(false);
    }
  }

  const s = forecast?.summary;
  return (
    <div className="grid gap-3 rounded-lg border border-surface-200 bg-surface-50 p-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label htmlFor={`growth-${molecule}`} className="text-surface-600">Growth</label>
        <input id={`growth-${molecule}`} type="range" min={5} max={30} step={5} value={Math.round(growth * 100)}
          onChange={(e) => setGrowth(Number(e.target.value) / 100)} className="w-32 accent-pharma-900" />
        <span className="w-8 font-semibold tabular-nums text-pharma-900">{Math.round(growth * 100)}%</span>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-surface-500" />}
      </div>

      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

      {forecast && s && (
        <>
          <p className="text-xs text-surface-600">
            Top product <b className="text-surface-800">{forecast.product}</b> · {forecast.competitors} competitors →{" "}
            {forecast.penetration_pct} penetration · market {fmtAed(forecast.total_market_value)} ({forecast.analysis_year})
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([1, 2, 3] as const).map((y) => (
              <div key={y} className="rounded-lg bg-white p-2">
                <p className="text-[10px] uppercase tracking-wider text-surface-500">Year {y}</p>
                <p className="text-sm font-semibold text-pharma-900">{fmtAed(s[`total_y${y}_revenue`])}</p>
                <p className="text-[11px] text-surface-500">{fmtUnits(s[`total_y${y}_units`])} units</p>
              </div>
            ))}
            <div className="rounded-lg bg-white p-2">
              <p className="text-[10px] uppercase tracking-wider text-surface-500">3-year total</p>
              <p className="text-sm font-semibold text-emerald-700">
                {fmtAed(s.total_y1_revenue + s.total_y2_revenue + s.total_y3_revenue)}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-surface-200 bg-white">
            <table className="w-full text-[11px]">
              <thead className="bg-surface-50">
                <tr>
                  {["Manufacturer", "Pack", "Retail", "CIF", "Share", "Y1 units", "Y2 units", "Y3 units", "Y1 rev", "Y2 rev", "Y3 rev"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-surface-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 tabular-nums">
                {forecast.packs.map((p, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium text-surface-700">{p.manufacturer}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-surface-600">{p.pack}</td>
                    <td className="px-2 py-1.5 text-right">{p.retail_price.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right">{p.cif_price.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right">{(p.pack_share * 100).toFixed(1)}%</td>
                    <td className="px-2 py-1.5 text-right">{fmtUnits(p.y1_units)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtUnits(p.y2_units)}</td>
                    <td className="px-2 py-1.5 text-right">{fmtUnits(p.y3_units)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{fmtAed(p.y1_revenue)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{fmtAed(p.y2_revenue)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{fmtAed(p.y3_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-surface-500">Retail and CIF in AED. CIF = retail ÷ 1.4 × 0.4.</p>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => exportXlsx([forecast], growth)}
              className="flex items-center gap-1.5 rounded-lg border border-surface-300 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-100">
              <Download className="h-3.5 w-3.5" /> Export XLSX
            </button>
            {onAttach && (
              <button onClick={attach} disabled={attaching || loading}
                className="flex items-center gap-1.5 rounded-lg border border-pharma-700 bg-white px-3 py-1.5 text-xs font-medium text-pharma-800 hover:bg-pharma-50 disabled:opacity-60">
                {attaching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                {attached ? "Attached to this deal" : "Attach XLSX to this deal"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
