"use client";

import { useState, useRef, useEffect } from "react";
import {
  Briefcase, Plus, FlaskConical, LayoutGrid, Map,
  FileText, Play, Loader2, X, ChevronDown, Star,
  CheckCircle2, XCircle, Trash2, Pencil,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, streamScore, type AnalysisResult, type MoleculeCard as MolCardType, type MyPortfolio } from "@/lib/api";
import { PortfolioTreemap } from "@/components/PortfolioTreemap";
import { ManufacturerPieChart } from "@/components/IQVIACharts";
import { MoleculeDrawer } from "@/components/MoleculeDrawer";
import { PortfolioBuilder } from "@/components/PortfolioBuilder";

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase     = "loading" | "empty" | "setup" | "portfolio" | "report";
type ViewMode  = "grid" | "treemap";
type ReportTab = "report" | "charts";

// COMIX's own portfolio — a single record, so no name is asked for.
const PORTFOLIO_NAME = "My Portfolio";

const MODELS = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "haiku",       label: "Claude Haiku (fast)" },
  { id: "sonnet",      label: "Claude Sonnet (best reasoning)" },
];

// ─── Score parser (same as analysis page) ────────────────────────────────────
function parseScores(report: string): Record<string, { score: number; reasoning: string }> {
  const result: Record<string, { score: number; reasoning: string }> = {};
  const tableRowRe = /\|\s*([A-Za-z][A-Za-z0-9 +\-\/()]+?)\s*\|[^|]*\|[^|]*\|[^|]*\|\s*(\d{1,2})\s*\|/g;
  let m;
  while ((m = tableRowRe.exec(report)) !== null) {
    const mol   = m[1].trim().toUpperCase();
    const score = parseInt(m[2], 10);
    if (score >= 1 && score <= 10) result[mol] = { score, reasoning: "" };
  }
  const inlineRe = /\*\*([A-Za-z][A-Za-z0-9 +\-]+?)\*\*[^*]{0,300}[Ss]core[:\s]+(\d{1,2})\s*(?:\/\s*10)?/g;
  while ((m = inlineRe.exec(report)) !== null) {
    const mol   = m[1].trim().toUpperCase();
    const score = parseInt(m[2], 10);
    if (score >= 1 && score <= 10 && !result[mol]) result[mol] = { score, reasoning: "" };
  }
  return result;
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MyPortfolioPage() {
  const [phase,      setPhase]      = useState<Phase>("loading");
  const [viewMode,   setViewMode]   = useState<ViewMode>("grid");
  const [reportTab,  setReportTab]  = useState<ReportTab>("report");

  // Saved portfolio metadata
  const [savedAt,      setSavedAt]      = useState("");

  // Setup state
  const [scoringModel,   setScoringModel]   = useState("gpt-5.6-luna");
  const [saving,         setSaving]         = useState(false);
  const [saveError,      setSaveError]      = useState("");

  // Portfolio data
  const [result,          setResult]          = useState<AnalysisResult | null>(null);
  const [reportText,      setReportText]      = useState("");
  const [reportStreaming, setReportStreaming] = useState(false);
  const [reportDone,      setReportDone]      = useState(false);
  const [scoredMolecules, setScoredMolecules] = useState<Record<string, { score: number; reasoning: string }>>({});
  const [drawerMolecule,  setDrawerMolecule]  = useState<MolCardType | null>(null);
  const [shortlistStatus, setShortlistStatus] = useState<Record<string, "shortlisted" | "disqualified" | null>>({});

  const abortRef         = useRef<AbortController | null>(null);
  const reportSavedRef   = useRef(false);

  const isShortlisted  = (mol: string) => shortlistStatus[mol.toUpperCase()] === "shortlisted";
  const isDisqualified = (mol: string) => shortlistStatus[mol.toUpperCase()] === "disqualified";
  const toggleShortlist = (mol: string, status: "shortlisted" | "disqualified") => {
    const key = mol.toUpperCase();
    setShortlistStatus(prev => ({ ...prev, [key]: prev[key] === status ? null : status }));
  };

  // ── Load molecule list and saved portfolio on mount ──
  useEffect(() => {
    api.getMyPortfolio().then(({ portfolio }) => {
      if (portfolio) {
        _loadPortfolio(portfolio);
      } else {
        setPhase("empty");
      }
    }).catch(() => setPhase("empty"));
  }, []);

  function _loadPortfolio(portfolio: MyPortfolio) {
    setResult(portfolio.result);
    setSavedAt(portfolio.saved_at);
    if (portfolio.report) {
      setReportText(portfolio.report);
      setReportDone(true);
      setScoredMolecules(parseScores(portfolio.report));
      setPhase("report");
      setReportTab("report");
    } else {
      setPhase("portfolio");
    }
    reportSavedRef.current = true;
  }

  // ── Save portfolio ──
  const savePortfolio = async (molecules: string[]) => {
    setSaveError("");
    setSaving(true);
    try {
      const res = await api.savePortfolioEnrich(molecules, PORTFOLIO_NAME);
      setResult(res);
      setReportText("");
      setReportDone(false);
      setScoredMolecules({});
      setShortlistStatus({});
      reportSavedRef.current = false;
      setSavedAt(new Date().toISOString().slice(0, 16).replace("T", " "));
      setPhase("portfolio");
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  // ── Generate report ──
  const runReport = () => {
    if (!result) return;
    setReportStreaming(true);
    setReportDone(false);
    setReportText("");
    setPhase("report");
    setReportTab("report");
    reportSavedRef.current = false;

    abortRef.current = streamScore(
      {
        companies:     result.companies,
        enriched_data: result.enriched_data,
        source_name:   PORTFOLIO_NAME,
        model:         scoringModel,
        atc4_context:  result.atc4_context,
      },
      (chunk) => setReportText((prev) => prev + chunk),
      () => { setReportStreaming(false); setReportDone(true); },
      () => { setReportStreaming(false); },
    );
  };

  // Auto-save report to backend when it finishes
  useEffect(() => {
    if (reportDone && reportText && !reportSavedRef.current) {
      reportSavedRef.current = true;
      setScoredMolecules(parseScores(reportText));
      api.savePortfolioReport(reportText).catch(() => {});
    }
  }, [reportDone, reportText]);

  // ── Clear portfolio ──
  const clearPortfolio = async () => {
    await api.clearMyPortfolio().catch(() => {});
    setResult(null);
    setReportText("");
    setReportDone(false);
    setScoredMolecules({});
    setShortlistStatus({});
    setSaveError("");
    setPhase("empty");
    reportSavedRef.current = false;
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const scoredCards: MolCardType[] = result?.molecules.map((m) => {
    const key    = m.molecule.toUpperCase();
    const scored = scoredMolecules[key];
    return scored ? { ...m, ai_score: scored.score } : m;
  }) ?? [];

  const top5Molecules = new Set(
    reportDone
      ? [...scoredCards]
          .filter(m => m.ai_score != null)
          .sort((a, b) => (b.ai_score ?? 0) - (a.ai_score ?? 0))
          .slice(0, 5)
          .map(m => m.molecule.toUpperCase())
      : []
  );

  const fmtAed = (v?: number | null) => {
    if (v == null) return "0";
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  // Loading skeleton
  if (phase === "loading") {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-surface-500">
          <Loader2 className="w-5 h-5 animate-spin text-pharma-900" />
          <span className="text-sm">Loading your portfolio...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 lg:p-10">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="matthew-eyebrow mb-3">In-licensed &amp; commercialised</p>
          <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-3">
            My Portfolio
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            {phase === "empty" || phase === "setup"
              ? "The molecules COMIX currently in-licenses and commercialises in the UAE."
              : `Saved ${savedAt}`
            }
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(phase === "portfolio" || phase === "report") && (
            <>
              {/* Edit portfolio */}
              <button
                onClick={() => { abortRef.current?.abort(); setSaveError(""); setPhase("setup"); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-300 text-sm text-surface-600 hover:text-surface-900 hover:bg-surface-100 transition-colors"
              >
                <Pencil className="w-4 h-4" /> Edit Portfolio
              </button>
              {/* Delete */}
              <button
                onClick={clearPortfolio}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-200 text-sm text-rose-700 hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── EMPTY STATE ── */}
      {phase === "empty" && (
        <div className="max-w-2xl mx-auto text-center py-12 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-pharma-50 border border-pharma-200 flex items-center justify-center mx-auto">
            <Briefcase className="w-8 h-8 text-pharma-900" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-surface-800">No portfolio saved yet</h2>
            <p className="text-sm text-surface-500 mt-1">Pick your molecules from the IQVIA classes, or import them from a file</p>
          </div>
          <button
            onClick={() => { setSaveError(""); setPhase("setup"); }}
            className="inline-flex items-center gap-2 bg-pharma-900 text-white font-medium hover:bg-pharma-800 py-2.5 px-6 rounded-xl transition-colors text-sm"
          >
            <Plus className="w-4 h-4" /> Set Up My Portfolio
          </button>
        </div>
      )}

      {/* ── SETUP / EDIT ── */}
      {phase === "setup" && (
        <PortfolioBuilder
          initialMolecules={result?.molecules.map((m) => m.molecule) ?? []}
          saving={saving}
          error={saveError}
          onSave={savePortfolio}
          onCancel={() => setPhase(result ? (reportDone ? "report" : "portfolio") : "empty")}
        />
      )}

      {/* ── PORTFOLIO + REPORT VIEW ── */}
      {(phase === "portfolio" || phase === "report") && result && (
        <div className="space-y-6">
          {/* Stats bar */}
          <div className="flex items-center gap-6 p-4 bg-white shadow-sm border border-surface-200 rounded-xl">
            <div>
              <p className="text-xs text-surface-500">Molecules</p>
              <p className="text-xl font-bold text-surface-900">{result.stats.total}</p>
            </div>
            <div className="w-px h-8 bg-surface-100" />
            <div>
              <p className="text-xs text-surface-500">IQVIA Matched</p>
              <p className="text-xl font-bold text-pharma-900">{result.stats.matched_iqvia}</p>
            </div>
            <div className="w-px h-8 bg-surface-100" />
            <div>
              <p className="text-xs text-surface-500">Therapy Areas</p>
              <p className="text-xl font-bold text-surface-900">{Object.keys(result.molecules_by_atc1).length}</p>
            </div>
            <div className="flex-1" />

            {/* Scoring model selector (portfolio phase only) */}
            {phase === "portfolio" && !reportDone && (
              <div className="relative">
                <select
                  value={scoringModel}
                  onChange={(e) => setScoringModel(e.target.value)}
                  className="appearance-none bg-white border border-surface-300 rounded-xl pl-3 pr-8 py-2 text-xs text-surface-700 focus:outline-none focus:border-pharma-300 transition-colors">
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500 pointer-events-none" />
              </div>
            )}

            {/* View toggle (portfolio phase) */}
            {phase === "portfolio" && (
              <div className="flex items-center gap-1 bg-surface-50 rounded-xl p-1">
                <button onClick={() => setViewMode("grid")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    viewMode === "grid" ? "bg-pharma-100 text-pharma-900" : "text-surface-500 hover:text-surface-800"
                  }`}>
                  <LayoutGrid className="w-3.5 h-3.5" /> Grid
                </button>
                <button onClick={() => setViewMode("treemap")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    viewMode === "treemap" ? "bg-pharma-100 text-pharma-900" : "text-surface-500 hover:text-surface-800"
                  }`}>
                  <Map className="w-3.5 h-3.5" /> Treemap
                </button>
              </div>
            )}

            {/* Generate / View report button */}
            {phase === "portfolio" && (
              reportDone ? (
                <button onClick={() => { setPhase("report"); setReportTab("report"); }}
                  className="flex items-center gap-2 bg-pharma-100 hover:bg-pharma-200 border border-pharma-300 text-pharma-900 text-sm font-medium px-4 py-2 rounded-xl transition-colors">
                  <FileText className="w-4 h-4" /> View Report
                </button>
              ) : (
                <button onClick={runReport} disabled={reportStreaming}
                  className="flex items-center gap-2 bg-pharma-900 text-white font-medium hover:bg-pharma-800 disabled:opacity-60 text-sm px-4 py-2 rounded-xl transition-colors">
                  {reportStreaming
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                    : <><Play className="w-4 h-4" /> Generate AI Report</>
                  }
                </button>
              )
            )}

            {/* Back to portfolio (from report) */}
            {phase === "report" && (
              <button onClick={() => setPhase("portfolio")}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-300 text-sm text-surface-600 hover:text-surface-900 hover:bg-surface-100 transition-colors">
                ← Back to Portfolio
              </button>
            )}
          </div>

          {/* ── PORTFOLIO GRID / TREEMAP ── */}
          {phase === "portfolio" && (
            <>
              {viewMode === "grid" ? (
                <div className="space-y-4">
                  {Object.entries(result.molecules_by_atc1).map(([atc1, moleculeNames], groupIndex) => {
                    const cards = scoredCards.filter(m =>
                      moleculeNames.some(n => n.toUpperCase() === m.molecule.toUpperCase())
                    );
                    const groupValue = cards.reduce((sum, m) => sum + (m.market_value_aed ?? 0), 0);
                    const atcCode = atc1.split(" ")[0];
                    const atcName = atc1.split(" ").slice(1).join(" ") || atc1;
                    return (
                      <div key={atc1} className="p-5 rounded-xl bg-surface-50 border border-surface-200">
                        <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-surface-200">
                          <div className="px-3 py-1 rounded-xl bg-pharma-50 border border-pharma-200">
                            <span className="text-sm font-semibold text-pharma-900">{atcCode}</span>
                          </div>
                          <div className="flex-1 min-w-[200px]">
                            <span className="text-sm font-medium text-surface-800">{atcName}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {groupValue > 0 && (
                              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pharma-50 border border-pharma-200">
                                <span className="text-xs text-pharma-800/70">Portfolio:</span>
                                <span className="text-sm font-semibold text-pharma-900">AED {fmtAed(groupValue)}</span>
                              </div>
                            )}
                            <span className="text-xs text-surface-500 px-2">
                              {cards.length} molecule{cards.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {cards.map((mol, idx) => {
                            const shortlisted  = isShortlisted(mol.molecule);
                            const disqualified = isDisqualified(mol.molecule);
                            const cardBorder   = shortlisted
                              ? "border-emerald-800 bg-emerald-50"
                              : disqualified
                              ? "border-surface-300 bg-surface-50 opacity-60"
                              : "border-surface-200 bg-white shadow-sm hover:bg-white hover:border-pharma-200";
                            return (
                              <div
                                key={mol.molecule}
                                className="flex items-stretch gap-2 opacity-0 animate-slide-up"
                                style={{ animationDelay: `${(groupIndex * 5 + idx) * 0.02}s` }}
                              >
                                <div className="flex flex-col gap-1 justify-center">
                                  <button
                                    onClick={() => toggleShortlist(mol.molecule, "shortlisted")}
                                    className={`p-1.5 rounded-lg transition-all ${shortlisted ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100" : "text-surface-500 hover:text-emerald-700 hover:bg-emerald-50"}`}
                                    title={shortlisted ? "Remove from shortlist" : "Add to shortlist"}
                                  >
                                    <CheckCircle2 className={`w-5 h-5 ${shortlisted ? "fill-emerald-700/10" : ""}`} />
                                  </button>
                                  <button
                                    onClick={() => toggleShortlist(mol.molecule, "disqualified")}
                                    className={`p-1.5 rounded-lg transition-all ${disqualified ? "text-rose-700 bg-rose-50 hover:bg-rose-100" : "text-surface-500 hover:text-rose-700 hover:bg-rose-50"}`}
                                    title={disqualified ? "Remove disqualification" : "Disqualify"}
                                  >
                                    <XCircle className={`w-5 h-5 ${disqualified ? "fill-rose-700/10" : ""}`} />
                                  </button>
                                </div>
                                <button
                                  onClick={() => setDrawerMolecule(scoredCards.find(s => s.molecule === mol.molecule) ?? mol)}
                                  className={`relative group p-3 border rounded-xl transition-all duration-200 flex-1 text-left cursor-pointer ${cardBorder}`}
                                >
                                  {top5Molecules.has(mol.molecule.toUpperCase()) && (
                                    <div className="absolute -top-2.5 -right-2.5 w-6 h-6 bg-amber-400 rounded-full flex items-center justify-center shadow-md z-10 ring-2 ring-surface-50">
                                      <Star className="w-3.5 h-3.5 text-amber-950 fill-amber-950" />
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 mb-1 pr-2">
                                    <div className={`p-1.5 rounded-lg transition-colors ${shortlisted ? "bg-emerald-50 text-emerald-700" : disqualified ? "bg-zinc-700/30 text-surface-500" : "bg-pharma-50 text-pharma-900 group-hover:bg-pharma-100"}`}>
                                      <FlaskConical className="w-4 h-4" />
                                    </div>
                                    <span className={`text-sm font-medium transition-colors flex-1 truncate ${disqualified ? "text-surface-500 line-through" : shortlisted ? "text-emerald-800" : "text-surface-800 group-hover:text-pharma-800"}`}>
                                      {mol.molecule}
                                    </span>
                                    {mol.ai_score != null && (
                                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold shrink-0 ${mol.ai_score >= 8 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : mol.ai_score >= 6 ? "bg-pharma-100 text-pharma-900 border-pharma-200" : mol.ai_score >= 4 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}>
                                        {mol.ai_score}<span className="text-[10px] opacity-70">/10</span>
                                      </div>
                                    )}
                                    {!mol.in_iqvia && (
                                      <span className="text-[10px] bg-surface-100 text-surface-500 border border-surface-300 px-1.5 py-0.5 rounded shrink-0">Not in IQVIA</span>
                                    )}
                                  </div>
                                  {mol.atc4_class && (
                                    <p className="text-[11px] text-surface-500 truncate mb-1 pl-9">{mol.atc4_class}</p>
                                  )}
                                  {mol.in_iqvia && (
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-2 pt-2 border-t border-surface-200/30">
                                      {mol.market_value_aed != null && mol.market_value_aed > 0 && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-surface-500">Value:</span>
                                          <span className="text-emerald-700 font-semibold">AED {fmtAed(mol.market_value_aed)}</span>
                                        </div>
                                      )}
                                      {mol.value_cagr_pct != null && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-surface-500">CAGR:</span>
                                          <span className={`font-semibold ${mol.value_cagr_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                                            {mol.value_cagr_pct >= 0 ? "+" : ""}{mol.value_cagr_pct.toFixed(1)}%
                                          </span>
                                        </div>
                                      )}
                                      {mol.num_competitors != null && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-surface-500">Competitors:</span>
                                          <span className={`font-semibold ${mol.num_competitors <= 4 ? "text-pharma-900" : "text-surface-700"}`}>
                                            {mol.num_competitors}
                                          </span>
                                        </div>
                                      )}
                                      {mol.private_pct != null && mol.lpo_pct != null && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-surface-500">Private/LPO:</span>
                                          <span className="text-blue-400 font-semibold">
                                            {mol.private_pct.toFixed(0)}%/{mol.lpo_pct.toFixed(0)}%
                                          </span>
                                        </div>
                                      )}
                                      {mol.cagr_delta != null && (
                                        <div className="flex items-center gap-1">
                                          <span className="text-surface-500">δCAGR:</span>
                                          <span className={`font-semibold ${mol.cagr_delta > 0 ? "text-pharma-900" : "text-surface-600"}`}>
                                            {mol.cagr_delta > 0 ? "+" : ""}{mol.cagr_delta.toFixed(1)}%
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Ungrouped molecules */}
                  {(() => {
                    const groupedSet = new Set(
                      Object.values(result.molecules_by_atc1).flat().map(n => n.toUpperCase())
                    );
                    const ungrouped = scoredCards.filter(m => !groupedSet.has(m.molecule.toUpperCase()));
                    if (ungrouped.length === 0) return null;
                    const groupOffset = Object.keys(result.molecules_by_atc1).length;
                    return (
                      <div className="p-5 rounded-xl bg-surface-50 border border-surface-200">
                        <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-surface-200">
                          <div className="px-3 py-1 rounded-xl bg-zinc-500/10 border border-zinc-500/20">
                            <span className="text-sm font-semibold text-surface-600">?</span>
                          </div>
                          <span className="text-sm font-medium text-surface-600">No ATC1 classification</span>
                          <span className="text-xs text-surface-500 px-2">{ungrouped.length} molecule{ungrouped.length !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {ungrouped.map((mol, idx) => {
                            const shortlisted  = isShortlisted(mol.molecule);
                            const disqualified = isDisqualified(mol.molecule);
                            const cardBorder   = shortlisted ? "border-emerald-800 bg-emerald-50" : disqualified ? "border-surface-300 bg-surface-50 opacity-60" : "border-surface-200 bg-white shadow-sm hover:bg-white hover:border-pharma-200";
                            return (
                              <div key={mol.molecule} className="flex items-stretch gap-2 opacity-0 animate-slide-up" style={{ animationDelay: `${(groupOffset * 5 + idx) * 0.02}s` }}>
                                <div className="flex flex-col gap-1 justify-center">
                                  <button onClick={() => toggleShortlist(mol.molecule, "shortlisted")} className={`p-1.5 rounded-lg transition-all ${shortlisted ? "text-emerald-700 bg-emerald-50" : "text-surface-500 hover:text-emerald-700 hover:bg-emerald-50"}`}>
                                    <CheckCircle2 className="w-5 h-5" />
                                  </button>
                                  <button onClick={() => toggleShortlist(mol.molecule, "disqualified")} className={`p-1.5 rounded-lg transition-all ${disqualified ? "text-rose-700 bg-rose-50" : "text-surface-500 hover:text-rose-700 hover:bg-rose-50"}`}>
                                    <XCircle className="w-5 h-5" />
                                  </button>
                                </div>
                                <button
                                  onClick={() => setDrawerMolecule(scoredCards.find(s => s.molecule === mol.molecule) ?? mol)}
                                  className={`relative group p-3 border rounded-xl transition-all duration-200 flex-1 text-left cursor-pointer ${cardBorder}`}
                                >
                                  <div className="flex items-center gap-2 mb-1 pr-2">
                                    <div className="p-1.5 rounded-lg bg-pharma-50 text-pharma-900 group-hover:bg-pharma-100">
                                      <FlaskConical className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-medium text-surface-800 group-hover:text-pharma-800 flex-1 truncate">{mol.molecule}</span>
                                    {!mol.in_iqvia && <span className="text-[10px] bg-surface-100 text-surface-500 border border-surface-300 px-1.5 py-0.5 rounded shrink-0">Not in IQVIA</span>}
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <PortfolioTreemap
                  moleculesByAtc1={result.molecules_by_atc1}
                  moleculeMetrics={result.molecule_metrics}
                  onMoleculeClick={(mol) => {
                    const card = scoredCards.find(s => s.molecule === mol);
                    if (card) setDrawerMolecule(card);
                  }}
                />
              )}
            </>
          )}

          {/* ── REPORT VIEW ── */}
          {phase === "report" && (
            <div className="space-y-6">
              {/* Top 5 banner */}
              {reportDone && top5Molecules.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-500/20">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-6 h-6 bg-amber-700 rounded-full flex items-center justify-center shadow-sm">
                      <Star className="w-3.5 h-3.5 text-amber-900 fill-amber-900" />
                    </div>
                    <span className="text-sm font-semibold text-amber-800">Top 5 Molecules</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[...scoredCards]
                      .filter(m => top5Molecules.has(m.molecule.toUpperCase()))
                      .sort((a, b) => (b.ai_score ?? 0) - (a.ai_score ?? 0))
                      .map(m => (
                        <div key={m.molecule} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-200">
                          <span className="text-xs font-medium text-amber-200">{m.molecule}</span>
                          {m.ai_score != null && <span className="text-xs font-bold text-amber-700">{m.ai_score}/10</span>}
                        </div>
                      ))
                    }
                  </div>
                  <button onClick={() => setPhase("portfolio")} className="ml-auto text-xs text-amber-700 hover:text-amber-800 underline underline-offset-2 shrink-0">
                    View on cards →
                  </button>
                </div>
              )}

              {/* Sub-tabs */}
              <div className="flex items-center gap-1 bg-surface-50 border-surface-200 rounded-xl p-1 w-fit">
                {(["report", "charts"] as ReportTab[]).map((tab) => (
                  <button key={tab} onClick={() => setReportTab(tab)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${reportTab === tab ? "bg-pharma-100 text-pharma-900" : "text-surface-500 hover:text-surface-800"}`}>
                    {tab === "report" ? "AI Report" : "Charts"}
                  </button>
                ))}
              </div>

              {reportTab === "report" && (
                <div className="bg-white shadow-sm border border-surface-200 rounded-xl p-8">
                  {reportStreaming && !reportText && (
                    <div className="flex items-center gap-3 text-surface-600">
                      <Loader2 className="w-5 h-5 animate-spin text-pharma-900" />
                      <span className="text-sm">Analysing portfolio with {MODELS.find(m => m.id === scoringModel)?.label}...</span>
                    </div>
                  )}
                  {reportText && (
                    <div className="report-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{reportText}</ReactMarkdown>
                      {reportStreaming && <span className="inline-block w-2 h-4 bg-pharma-400 animate-pulse ml-0.5 rounded-sm" />}
                    </div>
                  )}
                  {reportDone && (
                    <div className="mt-6 pt-4 border-t border-surface-200 flex items-center justify-between">
                      <p className="text-xs text-surface-400">Report complete · {scoredCards.filter(m => m.ai_score != null).length} molecules scored · auto-saved</p>
                      <button onClick={() => setPhase("portfolio")}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-surface-300 text-xs text-surface-600 hover:text-pharma-900 hover:border-pharma-200 transition-colors">
                        <LayoutGrid className="w-3.5 h-3.5" /> View scored cards
                      </button>
                    </div>
                  )}
                </div>
              )}

              {reportTab === "charts" && (
                <div className="space-y-6">
                  {result.molecules.filter((m) => m.in_iqvia).length === 0 ? (
                    <p className="text-surface-500 text-sm">No IQVIA-matched molecules to chart.</p>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {result.molecules.filter((m) => m.in_iqvia).map((m) => (
                        <ManufacturerPieChart key={m.molecule} molecule={m.molecule} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Molecule detail drawer ── */}
      <MoleculeDrawer
        molecule={drawerMolecule}
        isTop5={drawerMolecule ? top5Molecules.has(drawerMolecule.molecule.toUpperCase()) : false}
        onClose={() => setDrawerMolecule(null)}
      />
    </div>
  );
}
