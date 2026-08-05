"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, type ManufacturerBreakdown } from "@/lib/api";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Props {
  molecule: string;
}

export function ManufacturerPieChart({ molecule }: Props) {
  const [data, setData]     = useState<ManufacturerBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getManufacturers(molecule)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [molecule]);

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="w-6 h-6 text-pharma-900 animate-spin" />
    </div>
  );
  if (error || !data || !data.manufacturers.length) return (
    <p className="text-sm text-surface-500 text-center py-8">No manufacturer data available</p>
  );

  return (
    <div className="rounded-xl bg-surface-50 border-surface-200 border border-surface-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-surface-800">Manufacturer Share — {molecule}</h4>
        <span className="text-xs text-surface-500">{data.year}</span>
      </div>
      {typeof window !== "undefined" && (
        <Plot
          data={[{
            type: "pie",
            labels: data.manufacturers.map((m) => m.name),
            values: data.manufacturers.map((m) => m.value),
            hovertemplate: "<b>%{label}</b><br>AED %{value:,.0f}<br>%{percent}<extra></extra>",
            textinfo: "label+percent",
            textposition: "inside",
            marker: {
              colors: [
                "#0c5c4c", "#2f8f5b", "#1f6f6b", "#3f5c86", "#7a4f6d",
                "#9c5638", "#7c6a35", "#5a655f", "#8ca79a", "#c2a25a",
              ],
              line: { width: 2, color: "#fbfcfa" },
            },
          } as any]}
          layout={{
            autosize: true, height: 300,
            margin: { t: 10, l: 10, r: 10, b: 10 },
            paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
            font: { family: "IBM Plex Sans, system-ui, sans-serif", color: "#5a655f", size: 11 },
            showlegend: false,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: "100%" }}
          useResizeHandler
        />
      )}
    </div>
  );
}
