"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  ChevronRight,
  Layers3,
  Loader2,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import { api, type MarketDiscoveryNode, type MarketDiscoveryResponse } from "@/lib/api";

type Breadcrumb = { code: string; name: string; level: string };
const LEVELS = ["ATC1", "ATC2", "ATC3", "ATC4"] as const;

const SEGMENT_COLORS = ["#0c5c4c", "#257a69", "#46927d", "#6aa894", "#8abca4", "#a7cdb6", "#c1daca", "#d6e6d9"];

function formatValue(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `AED ${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `AED ${(value / 1_000).toFixed(0)}K`;
  return `AED ${Math.round(value).toLocaleString()}`;
}

function formatUnits(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="market-discovery-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Segment({ node, index, total, onClick }: { node: MarketDiscoveryNode; index: number; total: number; onClick: () => void }) {
  const width = total > 0 ? (node.value / total) * 100 : 100;
  const clickable = node.has_children !== false;
  return (
    <button
      type="button"
      className={`market-discovery-segment ${clickable ? "is-clickable" : ""}`}
      style={{ width: `${width}%`, background: SEGMENT_COLORS[index % SEGMENT_COLORS.length] }}
      onClick={onClick}
      aria-label={`Open ${node.code} ${node.name}`}
      disabled={!clickable}
    >
      <span className="market-discovery-segment-code">{node.code}</span>
      <strong>{node.name}</strong>
      <small>{formatValue(node.value)}</small>
    </button>
  );
}

export default function MarketDiscoveryPage() {
  const [trail, setTrail] = useState<Breadcrumb[]>([{ code: "", name: "All markets", level: "ATC1" }]);
  const [data, setData] = useState<MarketDiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const current = trail[trail.length - 1];

  const load = useCallback(async (selection?: Breadcrumb) => {
    setLoading(true);
    setError("");
    try {
      const selectedLevel = selection?.level ?? "";
      const selectedIndex = LEVELS.indexOf(selectedLevel as (typeof LEVELS)[number]);
      const requestedLevel = selection?.code && selectedIndex >= 0 && selectedIndex < LEVELS.length - 1
        ? LEVELS[selectedIndex + 1]
        : "ATC1";
      const response = await api.getMarketDiscovery(requestedLevel, selection?.code || undefined);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load market discovery data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(current.code ? current : undefined);
  }, [current, load]);

  const nodes = useMemo(() => data?.nodes ?? [], [data?.nodes]);
  const totalValue = data?.total_value ?? nodes.reduce((sum, node) => sum + (node.value || 0), 0);
  const totalUnits = data?.total_units ?? nodes.reduce((sum, node) => sum + (node.units || 0), 0);
  const cagr = data?.cagr ?? null;
  const level = data?.level || current.level;

  const summary = useMemo(() => ({
    top: [...nodes].sort((a, b) => b.value - a.value)[0],
  }), [nodes]);

  const openNode = (node: MarketDiscoveryNode) => {
    if (node.has_children === false) return;
    setTrail((previous) => [...previous, { code: node.code, name: node.name, level: node.level }]);
  };

  const goTo = (index: number) => setTrail((previous) => previous.slice(0, index + 1));

  return (
    <div className="market-discovery-page">
      <section className="market-discovery-hero">
        <div>
          <div className="matthew-eyebrow">Market intelligence · UAE IQVIA</div>
          <h1 className="matthew-page-title">Market discovery</h1>
          <p className="matthew-lede">Explore the market by ATC class. Each segment carries the commercial signal you need to decide where to look next.</p>
        </div>
        <div className="market-discovery-source"><span /> IQVIA market view</div>
      </section>

      <div className="market-discovery-breadcrumbs" aria-label="ATC hierarchy breadcrumbs">
        {trail.map((item, index) => (
          <span key={`${item.code}-${index}`}>
            {index > 0 && <ChevronRight aria-hidden="true" />}
            <button type="button" className={index === trail.length - 1 ? "is-current" : ""} onClick={() => goTo(index)}>
              {index === 0 ? "ATC1 · All markets" : `${item.code} · ${item.name}`}
            </button>
          </span>
        ))}
      </div>

      <section className="market-discovery-panel">
        <div className="market-discovery-panel-heading">
          <div>
            <div className="matthew-eyebrow">{level} view{data?.analysis_year || data?.year ? ` · ${data.analysis_year || data.year}` : ""}{data?.cagr_period ? ` · CAGR ${data.cagr_period}` : ""}</div>
            <h2>{data?.parent_name || current.name}</h2>
          </div>
          <button type="button" className="market-discovery-refresh" onClick={() => void load(current.code ? current : undefined)} disabled={loading}>
            <RefreshCw aria-hidden="true" className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="market-discovery-loading" role="status"><Loader2 className="spin" /><span>Loading market structure…</span></div>
        ) : error ? (
          <div className="market-discovery-state"><Activity /><strong>Market data is unavailable</strong><p>{error}</p><button type="button" onClick={() => void load(current.code ? current : undefined)}>Try again</button></div>
        ) : nodes.length === 0 ? (
          <div className="market-discovery-state"><PackageOpen /><strong>No market classes found</strong><p>This level has no reported segments yet.</p></div>
        ) : (
          <>
            <div className="market-discovery-summary">
              <Metric label="Market value" value={formatValue(totalValue)} />
              <Metric label="Units" value={formatUnits(totalUnits)} />
              <Metric label="Market CAGR" value={cagr == null ? "—" : `${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}%`} />
              <Metric label="Largest segment" value={summary.top?.code || "—"} />
            </div>

            <div className="market-discovery-bar" aria-label={`${level} segmented market bar`}>
              {nodes.map((node, index) => <Segment key={node.code} node={node} index={index} total={totalValue} onClick={() => openNode(node)} />)}
            </div>
            <p className="market-discovery-bar-caption"><Layers3 aria-hidden="true" /> {level === "ATC4" ? "ATC4 is the final IQVIA class level." : "Click a segment to move one level deeper."} Width represents market value.</p>

            <div className="market-discovery-table-wrap">
              <div className="market-discovery-table-heading"><span>Class detail</span><span>{nodes.length} segments</span></div>
              <div className="market-discovery-table" role="table" aria-label="Market segment metrics">
                <div className="market-discovery-row market-discovery-row--head" role="row"><span>ATC class</span><span>Value</span><span>Units</span><span>CAGR</span><span>Leading company</span><span>Share</span><span aria-hidden="true" /></div>
                {nodes.map((node, index) => (
                  <button type="button" className="market-discovery-row" key={node.code} onClick={() => openNode(node)} disabled={node.has_children === false}>
                    <span className="market-discovery-class"><i style={{ background: SEGMENT_COLORS[index % SEGMENT_COLORS.length] }} /><b>{node.code}</b><em>{node.name}</em></span>
                    <span>{formatValue(node.value)}</span>
                    <span>{formatUnits(node.units)}</span>
                    <span className={node.cagr != null && node.cagr >= 0 ? "is-positive" : "is-negative"}>{node.cagr == null ? "—" : `${node.cagr >= 0 ? "+" : ""}${node.cagr.toFixed(1)}%`}</span>
                    <span className="market-discovery-company"><Building2 aria-hidden="true" /> {node.top_company || "—"}</span>
                    <span>{node.top_company_share == null ? "—" : `${node.top_company_share.toFixed(1)}%`}</span>
                    <span className="market-discovery-open">{node.has_children === false ? "" : <ChevronRight aria-hidden="true" />}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <div className="market-discovery-footnote"><span /> Source: {data?.source_label || "IQVIA UAE market data"} · Values and units reflect the selected reporting period · Company share is within each ATC class.</div>
    </div>
  );
}
