"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, Search, FlaskConical, LayoutGrid, Map,
  FileText, Play, Loader2, X, Plus, ChevronDown,
  History, Trash2, ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, streamScore, type AnalysisResult, type MoleculeCard as MolCardType, type AnalysisRun } from "@/lib/api";
import { MoleculeCard } from "@/components/MoleculeCard";
import { PortfolioTreemap } from "@/components/PortfolioTreemap";
import { ManufacturerPieChart } from "@/components/IQVIACharts";

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode      = "upload" | "craft" | "molecule";
type Phase     = "input" | "portfolio" | "report";
type ViewMode  = "grid" | "treemap";
type ReportTab = "report" | "charts";

const MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o Mini (fast, cheap)" },
  { id: "gpt-4o",      label: "GPT-4o (best quality)" },
  { id: "haiku",       label: "Claude Haiku (fast)" },
  { id: "sonnet",      label: "Claude Sonnet (best reasoning)" },
];

// ─── Score parser — extracts molecule scores from the report markdown ─────────
function parseScores(report: string): Record<string, { score: number; reasoning: string }> {
  const result: Record<string, { score: number; reasoning: string }> = {};

  // Pattern: molecule name followed by score on same or nearby line
  // Handles "**METFORMIN** ... Score: 7/10" and "| METFORMIN | ... | 7 |"
  const tableRowRe = /\|\s*([A-Z][A-Z0-9 +\-]+?)\s*\|[^|]*\|\s*(\d{1,2})\s*\|/g;
  let m;
  while ((m = tableRowRe.exec(report)) !== null) {
    const mol   = m[1].trim().toUpperCase();
    const score = parseInt(m[2], 10);
    if (score >= 1 && score <= 10) {
      result[mol] = { score, reasoning: "" };
    }
  }

  // Also look for inline patterns: "**MOLECULE** ... **Score: X/10**"
  const inlineRe = /\*\*([A-Z][A-Z0-9 +\-]+?)\*\*[^*]{0,300}[Ss]core[:\s]+(\d{1,2})\s*(?:\/\s*10)?/g;
  while ((m = inlineRe.exec(report)) !== null) {
    const mol   = m[1].trim().toUpperCase();
    const score = parseInt(m[2], 10);
    if (score >= 1 && score <= 10 && !result[mol]) {
      result[mol] = { score, reasoning: "" };
    }
  }

  return result;
}

// ─── Molecule search dropdown ─────────────────────────────────────────────────
function MoleculeSearchInput({
  allMolecules, selected, onAdd,
}: {
  allMolecules: string[];
  selected: string[];
  onAdd: (mol: string) => void;
}) {
  const [query, setQuery]       = useState("");
  const [open, setOpen]         = useState(false);
  const [focused, setFocused]   = useState(false);
  const ref                     = useRef<HTMLDivElement>(null);

  const filtered = query.length >= 2
    ? allMolecules.filter(
        (m) => m.toLowerCase().includes(query.toLowerCase()) && !selected.includes(m)
      ).slice(0, 50)
    : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 bg-surface-800 border border-zinc-700/50 rounded-lg px-3 py-2 focus-within:border-pharma-500/50">
        <Search className="w-4 h-4 text-zinc-500 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => setFocused(false)}
          placeholder="Search molecules (e.g. METFORMIN)..."
          className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
        {query && (
          <button onClick={() => { setQuery(""); setOpen(false); }}>
            <X className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full max-h-60 overflow-y-auto bg-surface-800 border border-zinc-700/50 rounded-lg shadow-xl">
          {filtered.map((mol) => (
            <button
              key={mol}
              onMouseDown={(e) => { e.preventDefault(); onAdd(mol); setQuery(""); setOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-pharma-500/10 hover:text-pharma-400 transition-colors"
            >
              {mol}
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 2 && filtered.length === 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-surface-800 border border-zinc-700/50 rounded-lg shadow-xl p-3">
          <p className="text-sm text-zinc-500">No molecules found matching &quot;{query}&quot;</p>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AnalysisPage() {
  const router = useRouter();

  // Mode / phase
  const [mode,      setMode]      = useState<Mode>("upload");
  const [phase,     setPhase]     = useState<Phase>("input");
  const [viewMode,  setViewMode]  = useState<ViewMode>("grid");
  const [reportTab, setReportTab] = useState<ReportTab>("report");

  // Input state
  const [file,           setFile]           = useState<File | null>(null);
  const [companyName,    setCompanyName]     = useState("");
  const [craftMolecules, setCraftMolecules] = useState<string[]>([]);
  const [allMolecules,   setAllMolecules]   = useState<string[]>([]);
  const [scoringModel,   setScoringModel]   = useState("gpt-4o-mini");

  // Phase 1 results
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichError,   setEnrichError]   = useState("");

  // Phase 2 — report
  const [reportText,     setReportText]     = useState("");
  const [reportStreaming, setReportStreaming] = useState(false);
  const [reportDone,     setReportDone]     = useState(false);
  const [scoredMolecules, setScoredMolecules] = useState<Record<string, { score: number; reasoning: string }>>({});

  // History
  const [history,        setHistory]        = useState<AnalysisRun[]>([]);
  const [showHistory,    setShowHistory]    = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Selected molecule for pie chart
  const [chartMolecule, setChartMolecule] = useState<string | null>(null);

  const abortRef        = useRef<AbortController | null>(null);
  const fromHistoryRef  = useRef(false);   // prevents re-saving when loading from history

  // Load molecule list for craft/single modes
  useEffect(() => {
    api.getMolecules()
      .then((d) => setAllMolecules(d.molecules))
      .catch(() => {});
  }, []);

  // Load history on mount
  useEffect(() => {
    api.listHistory()
      .then((d) => setHistory(d.runs))
      .catch(() => {});
  }, []);

  // ── Drag & drop ──
  const [dragging, setDragging] = useState(false);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  // ── Phase 1: run enrichment ──
  const runPhase1 = async () => {
    setEnrichError("");
    setEnrichLoading(true);
    setReportText("");
    setReportDone(false);
    setScoredMolecules({});

    try {
      let res: AnalysisResult;

      if (mode === "upload") {
        if (!file) throw new Error("Please select a file");
        res = await api.uploadCatalogue(file, companyName || file.name.replace(/\.[^.]+$/, ""));
      } else if (mode === "craft") {
        if (!craftMolecules.length) throw new Error("Add at least one molecule");
        res = await api.enrichMolecules(craftMolecules, companyName || "Portfolio");
      } else {
        if (!craftMolecules[0]) throw new Error("Select a molecule");
        res = await api.enrichMolecules([craftMolecules[0]], craftMolecules[0]);
      }

      setResult(res);
      setPhase("portfolio");

      // Default chart molecule to first IQVIA-matched one
      const first = res.molecules.find((m) => m.in_iqvia);
      if (first) setChartMolecule(first.molecule);
    } catch (e: unknown) {
      setEnrichError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setEnrichLoading(false);
    }
  };

  // ── Phase 2: stream report ──
  const runPhase2 = () => {
    if (!result) return;
    setReportStreaming(true);
    setReportDone(false);
    setReportText("");
    setPhase("report");
    setReportTab("report");

    abortRef.current = streamScore(
      {
        companies:     result.companies,
        enriched_data: result.enriched_data,
        source_name:   companyName || "Portfolio",
        model:         scoringModel,
        atc4_context:  result.atc4_context,
      },
      (chunk) => setReportText((prev) => prev + chunk),
      () => {
        setReportStreaming(false);
        setReportDone(true);
      },
      (err) => {
        setReportStreaming(false);
        setEnrichError(err);
      },
    );
  };

  // Parse scores + auto-save whenever report finishes (skip if loaded from history)
  useEffect(() => {
    if (reportDone && reportText && result) {
      setScoredMolecules(parseScores(reportText));
      if (fromHistoryRef.current) {
        fromHistoryRef.current = false;
        return;
      }
      api.saveAnalysis({
        source_name: companyName || "Portfolio",
        source_type: mode,
        model:       scoringModel,
        result,
        report:      reportText,
      }).then((d) => {
        // Prepend to local history list
        setHistory((prev) => [{
          run_id:      d.run_id,
          source_name: companyName || "Portfolio",
          source_type: mode,
          model:       scoringModel,
          saved_at:    new Date().toISOString().slice(0, 16).replace("T", " "),
          has_report:  true,
          stats:       result.stats,
        }, ...prev]);
      }).catch(() => {});
    }
  }, [reportDone, reportText]);

  // Merge scores into molecule cards
  const scoredCards: MolCardType[] = result?.molecules.map((m) => {
    const key = m.molecule.toUpperCase();
    const scored = scoredMolecules[key];
    return scored ? { ...m, ai_score: scored.score, ai_reasoning: scored.reasoning } : m;
  }) ?? [];

  const reset = () => {
    abortRef.current?.abort();
    setPhase("input");
    setResult(null);
    setReportText("");
    setReportDone(false);
    setScoredMolecules({});
    setFile(null);
    setCraftMolecules([]);
    setCompanyName("");
    setEnrichError("");
    setShowHistory(false);
  };

  const loadFromHistory = async (runId: string) => {
    setHistoryLoading(true);
    setShowHistory(false);
    fromHistoryRef.current = true;   // tell the save effect to skip
    try {
      const entry = await api.getHistoryRun(runId);
      setResult(entry.result);
      setCompanyName(entry.source_name);
      setMode(entry.source_type as Mode);
      setScoringModel(entry.model || "gpt-4o-mini");
      if (entry.report) {
        setReportText(entry.report);
        setReportDone(true);
        setScoredMolecules(parseScores(entry.report));
        setPhase("report");
        setReportTab("report");
      } else {
        setPhase("portfolio");
      }
    } catch {
      fromHistoryRef.current = false;
      setEnrichError("Failed to load saved analysis.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const deleteFromHistory = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.deleteHistoryRun(runId).catch(() => {});
    setHistory((prev) => prev.filter((r) => r.run_id !== runId));
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-3">
            <FlaskConical className="w-6 h-6 text-pharma-400" />
            Analysis Agent
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Score manufacturer portfolios against UAE market data
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setShowHistory((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm transition-colors ${
              showHistory
                ? "border-pharma-500/40 bg-pharma-500/10 text-pharma-400"
                : "border-zinc-700/50 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
            }`}>
            <History className="w-4 h-4" />
            Saved Portfolios
            {history.length > 0 && (
              <span className="bg-pharma-500/20 text-pharma-400 text-xs px-1.5 py-0.5 rounded-full">{history.length}</span>
            )}
          </button>
          {phase !== "input" && (
            <button onClick={reset}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700/50 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors">
              <X className="w-4 h-4" /> New Analysis
            </button>
          )}
        </div>
      </div>

      {/* ── HISTORY PANEL ── */}
      {showHistory && (
        <div className="bg-surface-900/50 border border-zinc-800/50 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-zinc-800/50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
              <History className="w-4 h-4 text-zinc-500" /> Saved Portfolios
            </h2>
            <button onClick={() => setShowHistory(false)} className="text-zinc-600 hover:text-zinc-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          {historyLoading && (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          )}

          {!historyLoading && history.length === 0 && (
            <p className="text-sm text-zinc-600 px-5 py-4">No saved portfolios yet. Run an analysis and generate a report to save it.</p>
          )}

          {!historyLoading && history.length > 0 && (
            <div className="divide-y divide-zinc-800/50 max-h-80 overflow-y-auto">
              {history.map((run) => (
                <button key={run.run_id} onClick={() => loadFromHistory(run.run_id)}
                  className="w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-zinc-800/30 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-zinc-200">{run.source_name}</p>
                      {run.has_report && (
                        <span className="text-[10px] bg-pharma-500/15 text-pharma-400 border border-pharma-500/25 px-1.5 py-0.5 rounded-full">Report</span>
                      )}
                      <span className="text-[10px] bg-zinc-800 text-zinc-500 border border-zinc-700/50 px-1.5 py-0.5 rounded-full capitalize">{run.source_type}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {run.saved_at} · {run.stats?.total ?? 0} molecules · {run.stats?.matched_iqvia ?? 0} IQVIA matched
                      {run.model && <> · {run.model}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => deleteFromHistory(run.run_id, e)}
                      className="p-1.5 rounded-md text-zinc-700 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── INPUT PHASE ── */}
      {phase === "input" && (
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Mode selector */}
          <div className="grid grid-cols-3 gap-3">
            {([
              { id: "upload",   label: "Upload Portfolio", icon: Upload,       desc: "PDF, CSV, or Excel" },
              { id: "craft",    label: "Craft Portfolio",  icon: Plus,         desc: "Search & select molecules" },
              { id: "molecule", label: "Single Molecule",  icon: FlaskConical, desc: "Analyse one molecule" },
            ] as const).map(({ id, label, icon: Icon, desc }) => (
              <button key={id} onClick={() => { setMode(id); setCraftMolecules([]); }}
                className={`p-4 rounded-xl border text-left transition-all ${
                  mode === id
                    ? "border-pharma-500/50 bg-pharma-500/10 text-pharma-400"
                    : "border-zinc-800/50 bg-surface-800/30 text-zinc-400 hover:border-zinc-700"
                }`}>
                <Icon className={`w-5 h-5 mb-2 ${mode === id ? "text-pharma-400" : "text-zinc-500"}`} />
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs opacity-60 mt-0.5">{desc}</p>
              </button>
            ))}
          </div>

          {/* Input form */}
          <div className="bg-surface-900/50 border border-zinc-800/50 rounded-xl p-6 space-y-4">

            {/* Company / portfolio name */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                {mode === "molecule" ? "Molecule Name (auto-filled)" : "Company / Portfolio Name"}
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={mode === "upload" ? "e.g. Adalvo" : mode === "craft" ? "e.g. CNS Portfolio" : "Leave blank to auto-fill"}
                className="w-full bg-surface-800 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-pharma-500/50 transition-colors"
              />
            </div>

            {/* Upload mode */}
            {mode === "upload" && (
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Catalogue File</label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => document.getElementById("file-input")?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    dragging
                      ? "border-pharma-500/70 bg-pharma-500/5"
                      : file
                        ? "border-pharma-500/40 bg-pharma-500/5"
                        : "border-zinc-700/50 hover:border-zinc-600"
                  }`}>
                  <input id="file-input" type="file" accept=".pdf,.csv,.xlsx,.xls" className="hidden"
                    onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileText className="w-8 h-8 text-pharma-400" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-zinc-200">{file.name}</p>
                        <p className="text-xs text-zinc-500">{(file.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        className="ml-2 text-zinc-500 hover:text-rose-400 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                      <p className="text-sm text-zinc-400">Drop file here or click to browse</p>
                      <p className="text-xs text-zinc-600 mt-1">PDF, CSV, XLSX supported</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Craft mode */}
            {mode === "craft" && (
              <div className="space-y-3">
                <label className="block text-xs font-medium text-zinc-400">Add Molecules</label>
                <MoleculeSearchInput
                  allMolecules={allMolecules}
                  selected={craftMolecules}
                  onAdd={(mol) => setCraftMolecules((prev) => [...prev, mol])}
                />
                {craftMolecules.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {craftMolecules.map((mol) => (
                      <span key={mol}
                        className="flex items-center gap-1.5 bg-pharma-500/10 border border-pharma-500/20 text-pharma-400 text-xs px-3 py-1 rounded-full">
                        {mol}
                        <button onClick={() => setCraftMolecules((prev) => prev.filter((m) => m !== mol))}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {craftMolecules.length === 0 && (
                  <p className="text-xs text-zinc-600">Type at least 2 characters to search</p>
                )}
              </div>
            )}

            {/* Single molecule mode */}
            {mode === "molecule" && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-400">Select Molecule</label>
                <MoleculeSearchInput
                  allMolecules={allMolecules}
                  selected={craftMolecules}
                  onAdd={(mol) => { setCraftMolecules([mol]); setCompanyName(mol); }}
                />
                {craftMolecules[0] && (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 bg-pharma-500/10 border border-pharma-500/20 text-pharma-400 text-xs px-3 py-1 rounded-full">
                      {craftMolecules[0]}
                      <button onClick={() => setCraftMolecules([])}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Scoring model selector */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Scoring Model (Pass 2)</label>
              <div className="relative">
                <select
                  value={scoringModel}
                  onChange={(e) => setScoringModel(e.target.value)}
                  className="w-full appearance-none bg-surface-800 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-pharma-500/50 transition-colors">
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
              </div>
            </div>

            {enrichError && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {enrichError}
              </p>
            )}

            <button
              onClick={runPhase1}
              disabled={enrichLoading || (mode === "upload" && !file) || (mode !== "upload" && craftMolecules.length === 0)}
              className="w-full flex items-center justify-center gap-2 bg-pharma-500 hover:bg-pharma-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm">
              {enrichLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {enrichLoading ? "Extracting & enriching molecules..." : "Analyse Portfolio"}
            </button>
          </div>
        </div>
      )}

      {/* ── PORTFOLIO PHASE ── */}
      {(phase === "portfolio" || phase === "report") && result && (
        <div className="space-y-6">
          {/* Stats bar */}
          <div className="flex items-center gap-6 p-4 bg-surface-900/50 rounded-xl border border-zinc-800/50">
            <div>
              <p className="text-xs text-zinc-500">Molecules Found</p>
              <p className="text-xl font-bold text-zinc-100">{result.stats.total}</p>
            </div>
            <div className="w-px h-8 bg-zinc-800" />
            <div>
              <p className="text-xs text-zinc-500">Matched IQVIA</p>
              <p className="text-xl font-bold text-pharma-400">{result.stats.matched_iqvia}</p>
            </div>
            <div className="w-px h-8 bg-zinc-800" />
            <div>
              <p className="text-xs text-zinc-500">Portfolio</p>
              <p className="text-xl font-bold text-zinc-100">{companyName || "Portfolio"}</p>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* View toggle (only in portfolio phase) */}
            {phase === "portfolio" && (
              <div className="flex items-center gap-1 bg-surface-800 rounded-lg p-1">
                <button onClick={() => setViewMode("grid")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    viewMode === "grid" ? "bg-pharma-500/20 text-pharma-400" : "text-zinc-500 hover:text-zinc-300"
                  }`}>
                  <LayoutGrid className="w-3.5 h-3.5" /> Grid
                </button>
                <button onClick={() => setViewMode("treemap")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    viewMode === "treemap" ? "bg-pharma-500/20 text-pharma-400" : "text-zinc-500 hover:text-zinc-300"
                  }`}>
                  <Map className="w-3.5 h-3.5" /> Treemap
                </button>
              </div>
            )}

            {/* Generate / View report button */}
            {phase === "portfolio" && (
              reportDone ? (
                <button onClick={() => { setPhase("report"); setReportTab("report"); }}
                  className="flex items-center gap-2 bg-pharma-500/20 hover:bg-pharma-500/30 border border-pharma-500/40 text-pharma-400 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  <FileText className="w-4 h-4" /> View Report
                </button>
              ) : (
                <button onClick={runPhase2} disabled={reportStreaming}
                  className="flex items-center gap-2 bg-pharma-500 hover:bg-pharma-600 disabled:bg-pharma-500/60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
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
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700/50 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors">
                ← Back to Portfolio
              </button>
            )}
          </div>

          {/* Portfolio view */}
          {phase === "portfolio" && (
            <>
              {viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {scoredCards.map((mol) => (
                    <MoleculeCard
                      key={mol.molecule}
                      molecule={mol}
                      onClick={() => {
                        setChartMolecule(mol.molecule);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <PortfolioTreemap
                  moleculesByAtc1={result.molecules_by_atc1}
                  moleculeMetrics={result.molecule_metrics}
                  onMoleculeClick={(mol) => setChartMolecule(mol)}
                />
              )}

              {/* Manufacturer pie chart for selected molecule */}
              {chartMolecule && (
                <div className="max-w-md">
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-xs text-zinc-500">Manufacturer breakdown for:</label>
                    <div className="relative">
                      <select
                        value={chartMolecule}
                        onChange={(e) => setChartMolecule(e.target.value)}
                        className="appearance-none bg-surface-800 border border-zinc-700/50 rounded-lg pl-3 pr-8 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-pharma-500/50">
                        {result.molecules.filter((m) => m.in_iqvia).map((m) => (
                          <option key={m.molecule} value={m.molecule}>{m.molecule}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>
                  <ManufacturerPieChart molecule={chartMolecule} />
                </div>
              )}
            </>
          )}

          {/* Report view */}
          {phase === "report" && (
            <div className="space-y-6">
              {/* Report sub-tabs */}
              <div className="flex items-center gap-1 bg-surface-800/50 rounded-lg p-1 w-fit">
                {(["report", "charts"] as ReportTab[]).map((tab) => (
                  <button key={tab} onClick={() => setReportTab(tab)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all capitalize ${
                      reportTab === tab
                        ? "bg-pharma-500/20 text-pharma-400"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}>
                    {tab === "report" ? "AI Report" : "Charts"}
                  </button>
                ))}
              </div>

              {reportTab === "report" && (
                <div className="bg-surface-900/50 border border-zinc-800/50 rounded-xl p-8">
                  {enrichError && (
                    <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-4 py-3 mb-4">
                      <X className="w-4 h-4 shrink-0" />
                      <span className="text-sm">{enrichError}</span>
                    </div>
                  )}
                  {reportStreaming && !reportText && (
                    <div className="flex items-center gap-3 text-zinc-400">
                      <Loader2 className="w-5 h-5 animate-spin text-pharma-400" />
                      <span className="text-sm">Analysing portfolio with {MODELS.find(m => m.id === scoringModel)?.label}...</span>
                    </div>
                  )}
                  {reportText && (
                    <div className="report-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {reportText}
                      </ReactMarkdown>
                      {reportStreaming && (
                        <span className="inline-block w-2 h-4 bg-pharma-400 animate-pulse ml-0.5 rounded-sm" />
                      )}
                    </div>
                  )}
                  {reportDone && (
                    <div className="mt-6 pt-4 border-t border-zinc-800/50 flex items-center justify-between">
                      <p className="text-xs text-zinc-600">Report complete · {scoredCards.filter(m => m.ai_score != null).length} molecules scored</p>
                      <button onClick={() => setPhase("portfolio")}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-700/50 text-xs text-zinc-400 hover:text-pharma-400 hover:border-pharma-500/30 transition-colors">
                        <LayoutGrid className="w-3.5 h-3.5" /> View scored cards
                      </button>
                    </div>
                  )}
                </div>
              )}

              {reportTab === "charts" && (
                <div className="space-y-6">
                  {result.molecules.filter((m) => m.in_iqvia).length === 0 ? (
                    <p className="text-zinc-500 text-sm">No IQVIA-matched molecules to chart.</p>
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
    </div>
  );
}
