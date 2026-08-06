"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Grid2X2,
  LayoutDashboard,
  Loader2,
  MinusCircle,
  Play,
  Save,
  Sparkles,
  Table2,
  TrendingUp,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnalysisResult, MoleculeCard } from "@/lib/api";

type WorkspaceTab = "overview" | "scorecards" | "matrix" | "table" | "report";
type Decision = "shortlisted" | "maybe" | "disqualified";
type SortKey = "molecule" | "market_value_aed" | "value_cagr_pct" | "num_competitors" | "ai_score";

interface PortfolioWorkspaceProps {
  portfolioName: string;
  result: AnalysisResult;
  molecules: MoleculeCard[];
  reportText: string;
  reportStreaming: boolean;
  reportDone: boolean;
  scoringModelLabel: string;
  isSaving: boolean;
  savedOk: boolean;
  growthRate: number;
  decisionFor: (molecule: string) => Decision | null;
  onDecision: (molecule: string, decision: Decision) => void;
  onMoleculeOpen: (molecule: MoleculeCard) => void;
  onGenerateScores: () => void;
  onSave: () => void;
  onForecast: () => void;
  onGrowthRateChange: (value: number) => void;
}

const AREA_COLORS = ["#0c5c4c", "#1f6f6b", "#7c6a35", "#3f5c86", "#7a4f6d", "#9c5638", "#597064"];
const AREA_COLOR_BY_NAME: Record<string, string> = {
  Metabolic: "#0c5c4c",
  Cardiovascular: "#1f6f6b",
  Musculoskeletal: "#7c6a35",
  CNS: "#3f5c86",
  Oncology: "#7a4f6d",
  Haematology: "#9c5638",
};
const AREA_NAMES: Record<string, string> = {
  A0: "Metabolic",
  B0: "Haematology",
  C0: "Cardiovascular",
  D0: "Dermatology",
  G0: "Genito-urinary",
  H0: "Systemic hormones",
  J0: "Anti-infectives",
  L0: "Oncology",
  M0: "Musculoskeletal",
  N0: "CNS",
  R0: "Respiratory",
  S0: "Sensory",
  V0: "Various",
};

function areaLabel(value?: string | null) {
  if (!value) return "Unclassified";
  const code = value.trim().slice(0, 2).toUpperCase();
  return AREA_NAMES[code] || value.replace(/^[A-Z]\d\s+/, "");
}

function fmtAed(value?: number | null) {
  if (!value) return "AED 0";
  if (value >= 1_000_000_000) return `AED ${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `AED ${(value / 1_000).toFixed(0)}K`;
  return `AED ${value.toFixed(0)}`;
}

function fmtMarketValue(value?: number | null) {
  if (!value) return "0 AED";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B AED`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M AED`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K AED`;
  return `${value.toFixed(0)} AED`;
}

function fmtPct(value?: number | null) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function scoreMeta(score?: number) {
  if (score == null) return { label: "Awaiting score", className: "pending", color: "#79837e" };
  if (score >= 8) return { label: "Pursue", className: "pursue", color: "#1f7a4d" };
  if (score >= 6) return { label: "Investigate", className: "investigate", color: "#8a6414" };
  return { label: "Pass", className: "pass", color: "#9a3a31" };
}

function DecisionButtons({ molecule, value, onChange }: {
  molecule: string;
  value: Decision | null;
  onChange: (molecule: string, decision: Decision) => void;
}) {
  const choices = [
    { id: "shortlisted" as const, label: "Yes", Icon: CheckCircle2 },
    { id: "maybe" as const, label: "Maybe", Icon: MinusCircle },
    { id: "disqualified" as const, label: "No", Icon: XCircle },
  ];

  return (
    <div className="portfolio-decision" aria-label={`Decision for ${molecule}`}>
      {choices.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={value === id ? `is-active is-${id}` : ""}
          onClick={(event) => {
            event.stopPropagation();
            onChange(molecule, id);
          }}
          title={`${label}: ${molecule}`}
          aria-label={`${label}: ${molecule}`}
        >
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function PortfolioWorkspace(props: PortfolioWorkspaceProps) {
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [sortKey, setSortKey] = useState<SortKey>("ai_score");
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [hoveredArea, setHoveredArea] = useState<string | null>(null);
  const areaStripRef = useRef<HTMLDivElement>(null);
  const areaAutoScrollRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (areaAutoScrollRef.current !== null) window.cancelAnimationFrame(areaAutoScrollRef.current);
  }, []);

  const matched = useMemo(() => props.molecules.filter((molecule) => molecule.in_iqvia), [props.molecules]);
  const totalValue = matched.reduce((sum, molecule) => sum + (molecule.market_value_aed ?? 0), 0);
  const scored = props.molecules.filter((molecule) => molecule.ai_score != null);
  const averageScore = scored.length
    ? scored.reduce((sum, molecule) => sum + (molecule.ai_score ?? 0), 0) / scored.length
    : null;
  const pursueCount = scored.filter((molecule) => (molecule.ai_score ?? 0) >= 8).length;
  const shortlisted = matched.filter((molecule) => props.decisionFor(molecule.molecule) === "shortlisted");

  const areas = useMemo(() => {
    const groups = new Map<string, MoleculeCard[]>();
    for (const molecule of matched) {
      const area = molecule.atc1_class || "Unclassified";
      groups.set(area, [...(groups.get(area) ?? []), molecule]);
    }
    return Array.from(groups.entries())
      .map(([name, areaMolecules], index) => ({
        name: areaLabel(name),
        molecules: areaMolecules.sort((a, b) => (b.market_value_aed ?? 0) - (a.market_value_aed ?? 0)),
        value: areaMolecules.reduce((sum, molecule) => sum + (molecule.market_value_aed ?? 0), 0),
        color: AREA_COLOR_BY_NAME[areaLabel(name)] || AREA_COLORS[index % AREA_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [matched]);

  const largestMolecule = [...matched].sort((a, b) => (b.market_value_aed ?? 0) - (a.market_value_aed ?? 0))[0];
  const leadArea = areas[0];
  const valueLead = leadArea && largestMolecule
    ? `${leadArea.name} drives ${Math.round((leadArea.value / Math.max(totalValue, 1)) * 100)}% of catalogue value across ${leadArea.molecules.length} molecules. ${largestMolecule.molecule} is the single largest at ${fmtMarketValue(largestMolecule.market_value_aed)} — and the agent flags ${pursueCount} of ${props.molecules.length} molecules as worth pursuing.`
    : "Upload a portfolio to see its UAE market value distribution and agent priorities.";

  const matrixPoints = useMemo(() => {
    const values = matched.map((molecule) => Math.log10(Math.max(1, molecule.market_value_aed ?? 1)));
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    return matched.map((molecule) => {
      const logValue = Math.log10(Math.max(1, molecule.market_value_aed ?? 1));
      const valuePosition = max === min ? 50 : 8 + ((logValue - min) / (max - min)) * 84;
      const competitors = Math.min(molecule.num_competitors ?? 0, 15) / 15;
      const leader = Math.min(molecule.leader_share_pct ?? 0, 100) / 100;
      const risk = Math.min(1, competitors * .62 + leader * .38);
      const size = 34 + Math.min(30, Math.max(0, logValue - min) * 8);
      return { molecule, x: valuePosition, y: 8 + risk * 82, size };
    });
  }, [matched]);

  const sortedMolecules = useMemo(() => {
    return [...props.molecules].sort((a, b) => {
      const aValue = sortKey === "molecule" ? a.molecule : (a[sortKey] ?? -Infinity);
      const bValue = sortKey === "molecule" ? b.molecule : (b[sortKey] ?? -Infinity);
      const comparison = typeof aValue === "string"
        ? aValue.localeCompare(String(bValue))
        : Number(aValue) - Number(bValue);
      return sortDesc ? -comparison : comparison;
    });
  }, [props.molecules, sortDesc, sortKey]);

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((value) => !value);
    else {
      setSortKey(key);
      setSortDesc(key !== "molecule");
    }
  };

  const scrollAreas = (direction: number) => {
    areaStripRef.current?.scrollBy({ left: direction * 420, behavior: "smooth" });
  };

  const stopAreaAutoScroll = () => {
    if (areaAutoScrollRef.current !== null) {
      window.cancelAnimationFrame(areaAutoScrollRef.current);
      areaAutoScrollRef.current = null;
    }
  };

  const startAreaAutoScroll = (direction: number) => {
    stopAreaAutoScroll();
    const tick = () => {
      const strip = areaStripRef.current;
      if (!strip) return;
      const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const nextScroll = Math.max(0, Math.min(maxScroll, strip.scrollLeft + (direction * 1.8)));
      if (nextScroll === strip.scrollLeft) {
        stopAreaAutoScroll();
        return;
      }
      strip.scrollLeft = nextScroll;
      areaAutoScrollRef.current = window.requestAnimationFrame(tick);
    };
    areaAutoScrollRef.current = window.requestAnimationFrame(tick);
  };

  const revealArea = (areaName: string, element: HTMLElement | null) => {
    setHoveredArea(areaName);
    if (!element) return;
    window.setTimeout(() => {
      const strip = areaStripRef.current;
      const activeButton = element.querySelector("button");
      const stillActive = element.matches(":hover") || document.activeElement === activeButton;
      if (!strip || !stillActive) return;
      const stripRect = strip.getBoundingClientRect();
      const cardRect = element.getBoundingClientRect();
      const edgePadding = 12;
      let nextLeft = strip.scrollLeft;
      if (cardRect.right > stripRect.right - edgePadding) {
        nextLeft += cardRect.right - (stripRect.right - edgePadding);
      } else if (cardRect.left < stripRect.left + edgePadding) {
        nextLeft -= (stripRect.left + edgePadding) - cardRect.left;
      }
      const maxLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const clampedLeft = Math.max(0, Math.min(maxLeft, nextLeft));
      if (Math.abs(clampedLeft - strip.scrollLeft) > 1) {
        strip.scrollTo({ left: clampedLeft, behavior: "smooth" });
      }
    }, 320);
  };

  const tabs: { id: WorkspaceTab; label: string; Icon: typeof LayoutDashboard }[] = [
    { id: "overview", label: "Overview", Icon: LayoutDashboard },
    { id: "scorecards", label: "Scorecards", Icon: Grid2X2 },
    { id: "matrix", label: "Value Matrix", Icon: BarChart3 },
    { id: "table", label: "All Molecules", Icon: Table2 },
    { id: "report", label: "AI Report", Icon: FileText },
  ];

  return (
    <section className="portfolio-workspace">
      <header className="portfolio-hero">
        <div>
          <p className="matthew-eyebrow">Portfolio evaluation</p>
          <h2>{props.portfolioName}</h2>
          <p>UAE commercial opportunity, competition and regulatory evidence in one decision workspace.</p>
        </div>
        <div className="portfolio-hero__actions">
          <button type="button" className="portfolio-secondary-button" onClick={props.onSave} disabled={props.isSaving || props.savedOk}>
            {props.isSaving ? <Loader2 className="animate-spin" /> : props.savedOk ? <CheckCircle2 /> : <Save />}
            {props.isSaving ? "Saving" : props.savedOk ? "Saved" : "Save portfolio"}
          </button>
          {!props.reportDone && !props.reportStreaming && (
            <button type="button" className="portfolio-primary-button" onClick={props.onGenerateScores}>
              <Play /> Score portfolio
            </button>
          )}
          {props.reportStreaming && (
            <span className="portfolio-scoring-status"><Loader2 className="animate-spin" /> Scoring with {props.scoringModelLabel}</span>
          )}
        </div>
      </header>

      <div className="portfolio-kpis">
        <article><span>Portfolio value</span><strong>{fmtAed(totalValue)}</strong><small>Matched UAE market value</small></article>
        <article><span>Molecules</span><strong>{props.result.stats.total}</strong><small>{props.result.stats.matched_iqvia} matched to IQVIA</small></article>
        <article><span>Average score</span><strong>{averageScore == null ? "—" : averageScore.toFixed(1)}</strong><small>{scored.length ? `${scored.length} molecules scored` : "Scoring in progress"}</small></article>
        <article><span>Pursue</span><strong>{pursueCount}</strong><small>Score of 8 or above</small></article>
      </div>

      <nav className="portfolio-tabs" aria-label="Portfolio views">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
            <Icon /> {label}
            {id === "report" && props.reportStreaming && <span className="portfolio-tab-pulse" />}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="portfolio-overview">
          <section className="portfolio-section portfolio-value-map">
            <div className="portfolio-section__heading">
              <div><p className="matthew-eyebrow portfolio-eyebrow-accent">Value distribution</p><h3>Where the catalogue&apos;s value sits</h3></div>
              <div className="portfolio-total-value"><span>Total UAE market value</span><strong>{fmtMarketValue(totalValue)}</strong></div>
            </div>
            <p className="portfolio-value-lede">{valueLead}</p>
            <div className="portfolio-area-carousel">
              <button
                type="button"
                className="portfolio-area-nav is-left"
                onClick={() => scrollAreas(-1)}
                onMouseEnter={() => startAreaAutoScroll(-1)}
                onMouseLeave={stopAreaAutoScroll}
                onFocus={() => startAreaAutoScroll(-1)}
                onBlur={stopAreaAutoScroll}
                aria-label="Show previous therapeutic areas"
                title="Hover to scroll back"
              ><ChevronLeft /></button>
              <div
                ref={areaStripRef}
                className="portfolio-area-strip"
                onWheel={(event) => {
                  if (Math.abs(event.deltaY) >= Math.abs(event.deltaX) && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) {
                    event.currentTarget.scrollLeft += event.deltaY;
                    event.preventDefault();
                  }
                }}
              >
                {areas.map((area) => {
                  const baseWidth = Math.max(148, Math.min(560, 92 + ((area.value / Math.max(totalValue, 1)) * 950)));
                  const isHovered = hoveredArea === area.name;
                  return (
                    <div
                      key={area.name}
                      className={`portfolio-area-tile-wrap${isHovered ? " is-hovered" : ""}`}
                      style={{ flexBasis: `${baseWidth + (isHovered ? 160 : 0)}px` }}
                      onMouseEnter={(event) => revealArea(area.name, event.currentTarget)}
                      onMouseLeave={() => setHoveredArea(null)}
                    >
                      <button
                        type="button"
                        className={`portfolio-area-tile${selectedArea === area.name ? " is-selected" : ""}${isHovered ? " is-hovered" : ""}`}
                        onClick={() => setSelectedArea((current) => current === area.name ? null : area.name)}
                        onFocus={(event) => revealArea(area.name, event.currentTarget.parentElement)}
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoveredArea(null);
                        }}
                        style={{ backgroundColor: area.color }}
                        aria-label={`Open ${area.name} area`}
                      >
                        <strong className="portfolio-area-name">{area.name}</strong>
                        <strong className="portfolio-area-value">{fmtMarketValue(area.value)}</strong>
                        <span>{area.molecules.length} molecules · {area.molecules.filter((molecule) => (molecule.ai_score ?? 0) >= 8).length} pursue</span>
                        <em>Largest: {area.molecules[0]?.molecule || "—"}</em>
                        {isHovered && <small className="portfolio-area-hover-hint">Click to view molecules</small>}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="portfolio-area-nav is-right"
                onClick={() => scrollAreas(1)}
                onMouseEnter={() => startAreaAutoScroll(1)}
                onMouseLeave={stopAreaAutoScroll}
                onFocus={() => startAreaAutoScroll(1)}
                onBlur={stopAreaAutoScroll}
                aria-label="Show next therapeutic areas"
                title="Hover to scroll forward"
              ><ChevronRight /></button>
            </div>
            <div className="portfolio-mosaic-caption">Hover a card to expand · hover an arrow to auto-scroll · click an area to expand its molecules below</div>
            {selectedArea && (() => {
              const area = areas.find((candidate) => candidate.name === selectedArea);
              if (!area) return null;
              return (
                <div className="portfolio-area-molecules">
                  <div className="portfolio-area-expanded-heading"><span style={{ backgroundColor: area.color }} /><strong>{area.name} · {area.molecules.length} molecules · {fmtMarketValue(area.value)}</strong><button type="button" onClick={() => setSelectedArea(null)}>Collapse ×</button></div>
                  <div className="portfolio-area-expanded-grid">
                    {area.molecules.map((molecule) => (
                      <button key={molecule.molecule} type="button" className="portfolio-area-molecule-card" onClick={() => props.onMoleculeOpen(molecule)}>
                        <span className="portfolio-tier is-pending">{scoreMeta(molecule.ai_score).label}</span><strong>{molecule.molecule}</strong><small>{molecule.atc4_class || "Unclassified"}</small><em>{fmtMarketValue(molecule.market_value_aed)} · {fmtPct(molecule.value_cagr_pct)} CAGR</em>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </section>

          <section className="portfolio-section portfolio-priority-list">
            <div className="portfolio-section__heading">
              <div><p className="matthew-eyebrow portfolio-eyebrow-good">Recommended to pursue · {pursueCount}</p><h3>Highest-scoring opportunities</h3></div>
            </div>
            {[...props.molecules]
              .filter((molecule) => molecule.ai_score != null)
              .sort((a, b) => (b.ai_score ?? 0) - (a.ai_score ?? 0))
              .slice(0, 6)
              .map((molecule, index) => {
                const meta = scoreMeta(molecule.ai_score);
                return (
                  <button key={molecule.molecule} type="button" className="portfolio-priority-card" onClick={() => props.onMoleculeOpen(molecule)}>
                    <span className="portfolio-priority-card__top"><span className={`portfolio-tier is-${meta.className}`}>{meta.label}</span><b>{molecule.ai_score}/10</b></span>
                    <strong>{molecule.molecule}</strong>
                    <small>{fmtMarketValue(molecule.market_value_aed)} · {fmtPct(molecule.value_cagr_pct)} CAGR</small>
                  </button>
                );
              })}
            {!scored.length && (
              <div className="portfolio-empty-state"><Sparkles /><strong>Scoring the portfolio</strong><p>Scorecards and priorities populate as soon as the agent finishes.</p></div>
            )}
          </section>
        </div>
      )}

      {tab === "scorecards" && (
        <section className="portfolio-section">
          <div className="portfolio-section__heading">
            <div><p className="matthew-eyebrow">Molecule evaluation</p><h3>Commercial opportunity scorecards</h3></div>
            <span>Click a card for full market evidence</span>
          </div>
          <div className="portfolio-scorecards">
            {[...props.molecules].sort((a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1)).map((molecule) => {
              const meta = scoreMeta(molecule.ai_score);
              const decision = props.decisionFor(molecule.molecule);
              return (
                <article key={molecule.molecule} className={`portfolio-scorecard is-${meta.className}`}>
                  <button type="button" className="portfolio-scorecard__body" onClick={() => props.onMoleculeOpen(molecule)}>
                    <div className="portfolio-scorecard__top">
                      <span className={`portfolio-tier is-${meta.className}`}>{meta.label}</span>
                      <strong style={{ color: meta.color }}>{molecule.ai_score == null ? "—" : molecule.ai_score}<small>/10</small></strong>
                    </div>
                    <h4>{molecule.molecule}</h4>
                    <p>{molecule.atc4_class || molecule.atc1_class || "No therapeutic class available"}</p>
                    <dl>
                      <div><dt>Market value</dt><dd>{fmtAed(molecule.market_value_aed)}</dd></div>
                      <div><dt>Value CAGR</dt><dd className={(molecule.value_cagr_pct ?? 0) >= 0 ? "is-good" : "is-bad"}>{fmtPct(molecule.value_cagr_pct)}</dd></div>
                      <div><dt>Competitors</dt><dd>{molecule.num_competitors ?? "—"}</dd></div>
                      <div><dt>Private</dt><dd>{molecule.private_pct == null ? "—" : `${molecule.private_pct.toFixed(0)}%`}</dd></div>
                    </dl>
                  </button>
                  <DecisionButtons molecule={molecule.molecule} value={decision} onChange={props.onDecision} />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === "matrix" && (
        <section className="portfolio-section portfolio-matrix-section">
          <div className="portfolio-section__heading">
            <div><p className="matthew-eyebrow">Value matrix</p><h3>Market value × competitive risk</h3></div>
            <span>Bubble size reflects UAE market value</span>
          </div>
          <div className="portfolio-matrix">
            <div className="portfolio-matrix__quadrant is-top-left"><strong>Niche openings</strong><span>Lower value · lower risk</span></div>
            <div className="portfolio-matrix__quadrant is-top-right"><strong>Priority opportunities</strong><span>Higher value · lower risk</span></div>
            <div className="portfolio-matrix__quadrant is-bottom-left"><strong>Low priority</strong><span>Lower value · higher risk</span></div>
            <div className="portfolio-matrix__quadrant is-bottom-right"><strong>Defend carefully</strong><span>Higher value · higher risk</span></div>
            {matrixPoints.map(({ molecule, x, y, size }) => {
              const meta = scoreMeta(molecule.ai_score);
              return (
                <button
                  key={molecule.molecule}
                  type="button"
                  className="portfolio-matrix__point"
                  onClick={() => props.onMoleculeOpen(molecule)}
                  style={{ left: `${x}%`, top: `${y}%`, width: size, height: size, backgroundColor: meta.color }}
                  title={`${molecule.molecule}: ${fmtAed(molecule.market_value_aed)}, ${molecule.num_competitors ?? 0} competitors`}
                >
                  <span>{molecule.molecule}</span>
                </button>
              );
            })}
            <span className="portfolio-matrix__x">UAE market value →</span>
            <span className="portfolio-matrix__y">Competitive risk →</span>
          </div>
        </section>
      )}

      {tab === "table" && (
        <section className="portfolio-section portfolio-table-section">
          <div className="portfolio-section__heading">
            <div><p className="matthew-eyebrow">Complete catalogue</p><h3>All molecules</h3></div>
            <span>{props.molecules.length} extracted records</span>
          </div>
          <div className="portfolio-table-wrap">
            <table className="portfolio-table">
              <thead><tr>
                {([
                  ["molecule", "Molecule"], ["market_value_aed", "UAE value"], ["value_cagr_pct", "CAGR"],
                  ["num_competitors", "Competitors"], ["ai_score", "Score"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th key={key}><button type="button" onClick={() => setSort(key)}>{label}{sortKey === key && <ChevronDown className={sortDesc ? "" : "is-asc"} />}</button></th>
                ))}
                <th>Private</th><th>Decision</th>
              </tr></thead>
              <tbody>{sortedMolecules.map((molecule) => {
                const meta = scoreMeta(molecule.ai_score);
                return (
                  <tr key={molecule.molecule} onClick={() => props.onMoleculeOpen(molecule)}>
                    <td><strong>{molecule.molecule}</strong><small>{molecule.atc4_class || "Unclassified"}</small></td>
                    <td>{fmtAed(molecule.market_value_aed)}</td>
                    <td className={(molecule.value_cagr_pct ?? 0) >= 0 ? "is-good" : "is-bad"}>{fmtPct(molecule.value_cagr_pct)}</td>
                    <td>{molecule.num_competitors ?? "—"}</td>
                    <td><span className={`portfolio-tier is-${meta.className}`}>{molecule.ai_score == null ? "—" : `${molecule.ai_score}/10`}</span></td>
                    <td>{molecule.private_pct == null ? "—" : `${molecule.private_pct.toFixed(0)}%`}</td>
                    <td><DecisionButtons molecule={molecule.molecule} value={props.decisionFor(molecule.molecule)} onChange={props.onDecision} /></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "report" && (
        <section className="portfolio-section portfolio-report">
          <div className="portfolio-section__heading">
            <div><p className="matthew-eyebrow">Agent analysis</p><h3>Scoring rationale and recommendation</h3></div>
            {props.reportStreaming && <span className="portfolio-scoring-status"><Loader2 className="animate-spin" /> Analysing</span>}
          </div>
          {!props.reportText && props.reportStreaming && <div className="portfolio-report-loading"><Sparkles /><p>Building the scored portfolio report…</p></div>}
          {!props.reportText && !props.reportStreaming && <div className="portfolio-empty-state"><FileText /><strong>No report generated yet</strong><p>Score this portfolio to generate the complete agent rationale.</p><button type="button" onClick={props.onGenerateScores}>Score portfolio</button></div>}
          {props.reportText && <div className="report-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{props.reportText}</ReactMarkdown>{props.reportStreaming && <span className="portfolio-stream-cursor" />}</div>}
        </section>
      )}

      {shortlisted.length > 0 && (
        <footer className="portfolio-forecast-bar">
          <div><TrendingUp /><span><strong>{shortlisted.length} approved molecule{shortlisted.length === 1 ? "" : "s"}</strong><small>Build a three-year commercial forecast from this portfolio.</small></span></div>
          <label>Growth <input type="range" min="5" max="30" step="5" value={Math.round(props.growthRate * 100)} onChange={(event) => props.onGrowthRateChange(Number(event.target.value) / 100)} /><b>{Math.round(props.growthRate * 100)}%</b></label>
          <button type="button" onClick={props.onForecast}>Open forecast <TrendingUp /></button>
        </footer>
      )}
    </section>
  );
}
