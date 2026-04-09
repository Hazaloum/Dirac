"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { MoleculeMetrics } from "@/lib/api";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[450px] bg-surface-50 rounded-xl">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-pharma-900 animate-spin" />
        <p className="text-sm text-surface-600">Loading treemap...</p>
      </div>
    </div>
  ),
});

const ATC1_COLORS: Record<string, string> = {
  "A ALIMENTARY TRACT AND METABOLISM":            "#22c55e",
  "B BLOOD AND BLOOD FORMING ORGANS":             "#ef4444",
  "C CARDIOVASCULAR SYSTEM":                      "#f97316",
  "D DERMATOLOGICALS":                            "#eab308",
  "G GENITO URINARY SYSTEM AND SEX HORMONES":    "#ec4899",
  "H SYSTEMIC HORMONAL PREPARATIONS":             "#a855f7",
  "J ANTIINFECTIVES FOR SYSTEMIC USE":            "#14b8a6",
  "L ANTINEOPLASTIC AND IMMUNOMODULATING AGENTS": "#6366f1",
  "M MUSCULO-SKELETAL SYSTEM":                    "#84cc16",
  "N NERVOUS SYSTEM":                             "#3b82f6",
  "P ANTIPARASITIC PRODUCTS":                     "#f472b6",
  "R RESPIRATORY SYSTEM":                         "#06b6d4",
  "S SENSORY ORGANS":                             "#8b5cf6",
  "V VARIOUS":                                    "#64748b",
  "Unknown":                                      "#71717a",
};

function getAtc1Color(atc1: string): string {
  if (ATC1_COLORS[atc1]) return ATC1_COLORS[atc1];
  const key = Object.keys(ATC1_COLORS).find((k) => k.charAt(0) === atc1.charAt(0).toUpperCase());
  return key ? ATC1_COLORS[key] : ATC1_COLORS["Unknown"];
}

function fmtV(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

interface Props {
  moleculesByAtc1: Record<string, string[]>;
  moleculeMetrics: Record<string, MoleculeMetrics>;
  onMoleculeClick?: (molecule: string) => void;
}

export function PortfolioTreemap({ moleculesByAtc1, moleculeMetrics, onMoleculeClick }: Props) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  const treemapData = useMemo(() => {
    const ids: string[] = [];
    const labels: string[] = [];
    const parents: string[] = [];
    const values: number[] = [];
    const colors: string[] = [];
    const text: string[] = [];
    const hoverText: string[] = [];

    ids.push("Portfolio"); labels.push("Portfolio"); parents.push(""); values.push(0);
    colors.push("#18181b"); text.push("Portfolio"); hoverText.push("Portfolio");

    Object.entries(moleculesByAtc1).forEach(([atc1, mols]) => {
      const atc1Total = mols.reduce((s, m) => s + (moleculeMetrics[m]?.value || 0), 0);
      if (atc1Total <= 0) return;

      const atc1Id = `atc1_${atc1}`;
      const shortName = atc1.split(" ").slice(1).join(" ") || atc1;
      ids.push(atc1Id); labels.push(shortName); parents.push("Portfolio"); values.push(0);
      colors.push(getAtc1Color(atc1));
      text.push(`${shortName}<br>${fmtV(atc1Total)}`);
      hoverText.push(`<b>${shortName}</b><br>Total: AED ${fmtV(atc1Total)}<br>${mols.length} molecules`);

      mols.forEach((mol) => {
        const m = moleculeMetrics[mol];
        const val = m?.value || 0;
        if (val <= 0) return;

        const cagrStr = m?.cagr != null ? `${m.cagr >= 0 ? "+" : ""}${m.cagr.toFixed(1)}%` : "";
        ids.push(`mol_${mol}`); labels.push(mol); parents.push(atc1Id); values.push(val);
        colors.push(getAtc1Color(atc1));
        text.push(`${mol}<br>${fmtV(val)}${cagrStr ? `<br><b>${cagrStr}</b>` : ""}`);
        hoverText.push(`<b>${mol}</b><br>Value: AED ${fmtV(val)}${cagrStr ? `<br>CAGR: ${cagrStr}` : ""}`);
      });
    });

    return { ids, labels, parents, values, colors, text, hoverText };
  }, [moleculesByAtc1, moleculeMetrics]);

  const totalValue = useMemo(
    () => Object.values(moleculeMetrics).reduce((s, m) => s + (m?.value || 0), 0),
    [moleculeMetrics]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClick = (event: any) => {
    if (!event.points?.[0]) return;
    const { id, label } = event.points[0];
    let molecule: string | null = null;
    if (typeof id === "string" && id.startsWith("mol_")) {
      molecule = id.replace("mol_", "");
    } else if (label && moleculeMetrics[label]) {
      molecule = label;
    }
    if (molecule && onMoleculeClick) {
      requestAnimationFrame(() => onMoleculeClick(molecule!));
    }
  };

  if (!isMounted) {
    return (
      <div className="flex items-center justify-center h-[450px] bg-surface-50 rounded-xl border border-surface-200">
        <Loader2 className="w-8 h-8 text-pharma-900 animate-spin" />
      </div>
    );
  }

  if (treemapData.ids.length <= 1) {
    return (
      <div className="p-8 rounded-xl bg-surface-50 border border-surface-200 text-center">
        <p className="text-surface-600">No market value data available for treemap.</p>
        <p className="text-sm text-surface-500 mt-1">Only molecules matched in IQVIA can be visualised.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface-50 border-surface-200 border border-surface-200 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-surface-200 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-surface-900">Portfolio Value Distribution</h3>
          <p className="text-sm text-surface-500">Click a molecule to view details · double-click to zoom out</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-surface-500">Total Portfolio Value</p>
          <p className="text-xl font-bold text-pharma-900">AED {fmtV(totalValue)}</p>
        </div>
      </div>

      {/* ATC1 legend */}
      <div className="px-4 py-3 border-b border-surface-200 overflow-x-auto">
        <div className="flex flex-wrap gap-3">
          {Object.keys(moleculesByAtc1).map((atc1) => (
            <div key={atc1} className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: getAtc1Color(atc1) }} />
              <span className="text-surface-600 whitespace-nowrap">{atc1.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Treemap */}
      <div className="p-4">
        <Plot
          data={[{
            type: "treemap",
            ids: treemapData.ids,
            labels: treemapData.labels,
            parents: treemapData.parents,
            values: treemapData.values,
            text: treemapData.text,
            hovertext: treemapData.hoverText,
            branchvalues: "remainder",
            textinfo: "text",
            hoverinfo: "text",
            marker: { colors: treemapData.colors, line: { width: 2, color: "#27272a" } },
            textfont: { family: "system-ui, sans-serif", size: 11, color: "#ffffff" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any]}
          layout={{
            autosize: true, height: 450,
            margin: { t: 20, l: 20, r: 20, b: 20 },
            paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
            font: { family: "system-ui, sans-serif", color: "#a1a1aa" },
            uirevision: "portfolio-treemap",
          }}
          config={{ displayModeBar: false, responsive: true, doubleClick: "reset" }}
          onClick={handleClick}
          style={{ width: "100%", height: "450px" }}
          useResizeHandler
        />
      </div>

      {/* ATC1 breakdown mini-grid */}
      <div className="p-4 border-t border-surface-200">
        <h4 className="text-sm font-medium text-surface-700 mb-3">Value by Therapeutic Area</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Object.entries(moleculesByAtc1)
            .map(([atc1, mols]) => ({
              atc1, mols,
              total: mols.reduce((s, m) => s + (moleculeMetrics[m]?.value || 0), 0),
            }))
            .filter((x) => x.total > 0)
            .sort((a, b) => b.total - a.total)
            .map(({ atc1, mols, total }) => (
              <div key={atc1} className="p-3 rounded-xl bg-white shadow-sm border-surface-200 border border-surface-200">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: getAtc1Color(atc1) }} />
                  <span className="text-xs font-medium text-surface-600 truncate">{atc1.split(" ")[0]}</span>
                </div>
                <p className="text-lg font-semibold text-surface-900">{fmtV(total)}</p>
                <p className="text-xs text-surface-500">{mols.length} molecule{mols.length !== 1 ? "s" : ""}</p>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
