"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, Search, FlaskConical, FileText, Loader2, X, Plus, ChevronDown,
  History, Trash2, ChevronRight, TrendingUp, Check, Save,
} from "lucide-react";
import { FORECAST_SESSION_KEY, type ForecastSession } from "@/lib/forecastSession";
import { api, streamScore, type AnalysisResult, type MoleculeCard as MolCardType, type AnalysisRun } from "@/lib/api";
import { MoleculeDrawer } from "@/components/MoleculeDrawer";
import { PortfolioView, topFiveMolecules } from "@/components/PortfolioView";

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode      = "upload" | "craft" | "molecule";
type Phase     = "input" | "portfolio" | "report";

const MODELS = [
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "haiku",       label: "Claude Haiku (fast)" },
  { id: "sonnet",      label: "Claude Sonnet (best reasoning)" },
];

// ─── Score parser — extracts molecule scores from the report markdown ─────────
function parseScores(report: string): Record<string, { score: number; reasoning: string }> {
  const result: Record<string, { score: number; reasoning: string }> = {};

  // Actual table format from prompt_scoring.txt:
  // | Molecule | Company | ATC4 | Patent Status | UAE Score (1-10) | Rationale |
  // Score is in the 5th column — skip 3 intermediate cells before matching it.
  const tableRowRe = /\|\s*([A-Za-z][A-Za-z0-9 +\-\/()]+?)\s*\|[^|]*\|[^|]*\|[^|]*\|\s*(\d{1,2})\s*\|/g;
  let m;
  while ((m = tableRowRe.exec(report)) !== null) {
    const mol   = m[1].trim().toUpperCase();
    const score = parseInt(m[2], 10);
    if (score >= 1 && score <= 10) {
      result[mol] = { score, reasoning: "" };
    }
  }

  // Fallback: inline "**MOLECULE** ... Score: X/10"
  const inlineRe = /\*\*([A-Za-z][A-Za-z0-9 +\-]+?)\*\*[^*]{0,300}[Ss]core[:\s]+(\d{1,2})\s*(?:\/\s*10)?/g;
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
      <div className="flex items-center gap-2 bg-white border border-surface-300 rounded-xl px-3 py-2 focus-within:border-pharma-300">
        <Search className="w-4 h-4 text-surface-500 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => setFocused(false)}
          placeholder="Search molecules (e.g. METFORMIN)..."
          className="flex-1 bg-transparent text-sm text-surface-900 placeholder-zinc-600 focus:outline-none"
        />
        {query && (
          <button onClick={() => { setQuery(""); setOpen(false); }}>
            <X className="w-4 h-4 text-surface-500 hover:text-surface-800" />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full max-h-60 overflow-y-auto bg-white border border-surface-300 rounded-xl shadow-xl">
          {filtered.map((mol) => (
            <button
              key={mol}
              onMouseDown={(e) => { e.preventDefault(); onAdd(mol); setQuery(""); setOpen(false); }}
              className="w-full text-left px-4 py-2 text-sm text-surface-700 hover:bg-pharma-50 hover:text-pharma-900 transition-colors"
            >
              {mol}
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 2 && filtered.length === 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-surface-300 rounded-xl shadow-xl p-3">
          <p className="text-sm text-surface-500">No molecules found matching &quot;{query}&quot;</p>
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

  // Input state
  const [file,           setFile]           = useState<File | null>(null);
  const [companyName,    setCompanyName]     = useState("");
  const [craftMolecules, setCraftMolecules] = useState<string[]>([]);
  const [allMolecules,   setAllMolecules]   = useState<string[]>([]);
  const [scoringModel,   setScoringModel]   = useState("gpt-5.6-luna");

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

  // Manual save
  const [isSaving, setIsSaving] = useState(false);
  const [savedOk,  setSavedOk]  = useState(false);

  // Drawer — open with full MoleculeCard object
  const [drawerMolecule, setDrawerMolecule] = useState<MolCardType | null>(null);

  // Shortlist / disqualify state
  const [shortlistStatus, setShortlistStatusMap] = useState<Record<string, "shortlisted" | "maybe" | "disqualified" | null>>({});
  const isShortlisted  = (mol: string) => shortlistStatus[mol.toUpperCase()] === "shortlisted";
  const toggleShortlist = (mol: string, status: "shortlisted" | "maybe" | "disqualified") => {
    const key = mol.toUpperCase();
    const next = shortlistStatus[key] === status ? null : status;
    setShortlistStatusMap(prev => ({ ...prev, [key]: next }));

    if (!next) {
      api.clearPipelineDecision(key).catch(() => {});
      return;
    }

    const base = result?.molecules.find((item) => item.molecule.toUpperCase() === key);
    if (!base) return;
    const score = scoredMolecules[key];
    api.setPipelineDecision({
      molecule: key,
      decision: next === "shortlisted" ? "yes" : next === "disqualified" ? "no" : "maybe",
      source_name: companyName || result?.companies[0]?.name || "Catalogue",
      snapshot: {
        ...base,
        ai_score: score?.score,
        ai_reasoning: score?.reasoning,
      },
    }).catch(() => {});
  };

  const abortRef        = useRef<AbortController | null>(null);
  const fromHistoryRef  = useRef(false);   // prevents re-saving when loading from history

  // Load molecule list for craft/single modes
  useEffect(() => {
    Promise.all([api.getMolecules(), api.getPipeline()])
      .then(([moleculesData, pipelineData]) => {
        setAllMolecules(moleculesData.molecules);
        const persisted: Record<string, "shortlisted" | "maybe" | "disqualified"> = {};
        for (const row of pipelineData.decisions) {
          persisted[row.molecule.toUpperCase()] = row.decision === "yes"
            ? "shortlisted"
            : row.decision === "no" ? "disqualified" : "maybe";
        }
        setShortlistStatusMap(persisted);
      })
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
      // Score in the background; cards pick up scores when the report lands.
      runPhase2(res, false);
    } catch (e: unknown) {
      setEnrichError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setEnrichLoading(false);
    }
  };

  // ── Phase 2: stream report ──
  const runPhase2 = (analysisResult: AnalysisResult | null = result, showReport = true) => {
    if (!analysisResult) return;
    setReportStreaming(true);
    setReportDone(false);
    setReportText("");
    if (showReport) setPhase("report");

    abortRef.current = streamScore(
      {
        companies:     analysisResult.companies,
        enriched_data: analysisResult.enriched_data,
        source_name:   companyName || "Portfolio",
        model:         scoringModel,
        atc4_context:  analysisResult.atc4_context,
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
  }, [companyName, mode, reportDone, reportText, result, scoringModel]);

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
      setScoringModel(entry.model || "gpt-5.6-luna");
      if (entry.report) {
        setReportText(entry.report);
        setReportDone(true);
        setScoredMolecules(parseScores(entry.report));
        setPhase("report");
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const top5Molecules = topFiveMolecules(scoredCards, reportDone);

  const shortlistedIqviaMols = result
    ? scoredCards.filter(m => isShortlisted(m.molecule) && m.in_iqvia)
    : [];

  const savePortfolioNow = async () => {
    if (!result) return;
    setIsSaving(true);
    try {
      const saved = await api.saveAnalysis({
        source_name: companyName || "Portfolio",
        source_type: mode === "upload" ? "upload" : "craft",
        model:       scoringModel,
        result,
        report:      reportText,
      });
      setHistory(prev => [{
        run_id:      saved.run_id,
        source_name: companyName || "Portfolio",
        source_type: mode === "upload" ? "upload" : "craft",
        model:       scoringModel,
        saved_at:    new Date().toISOString().slice(0, 16).replace("T", " "),
        stats:       result.stats,
        has_report:  false,
      }, ...prev]);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch { /* ignore */ } finally {
      setIsSaving(false);
    }
  };

  const goToForecast = () => {
    if (!shortlistedIqviaMols.length || !result) return;
    const session: ForecastSession = {
      molecules:         shortlistedIqviaMols,
      molecules_by_atc1: result.molecules_by_atc1,
    };
    localStorage.setItem(FORECAST_SESSION_KEY, JSON.stringify(session));
    router.push("/forecast");
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen p-8 lg:p-10">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="matthew-eyebrow mb-3">Manufacturer intelligence</p>
          <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-3">
            Catalogues
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            Analyse manufacturer portfolios against UAE IQVIA, MOHAP, and UPP market evidence.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setShowHistory((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-colors ${
              showHistory
                ? "border-pharma-300 bg-pharma-50 text-pharma-900"
                : "border-surface-300 text-surface-600 hover:text-surface-900 hover:bg-surface-100"
            }`}>
            <History className="w-4 h-4" />
            Analysed catalogues
            {history.length > 0 && (
              <span className="bg-pharma-100 text-pharma-900 text-xs px-1.5 py-0.5 rounded-full">{history.length}</span>
            )}
          </button>
          {phase !== "input" && (
            <button onClick={reset}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-300 text-sm text-surface-600 hover:text-surface-900 hover:bg-surface-100 transition-colors">
              <X className="w-4 h-4" /> Analyse catalogue
            </button>
          )}
        </div>
      </div>

      {/* ── HISTORY PANEL ── */}
      {showHistory && (
        <div className="bg-white shadow-sm border-surface-200 border border-surface-200 rounded-xl overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-surface-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-surface-700 flex items-center gap-2">
              <History className="w-4 h-4 text-surface-500" /> Analysed catalogues
            </h2>
            <button onClick={() => setShowHistory(false)} className="text-surface-400 hover:text-surface-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          {historyLoading && (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-surface-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          )}

          {!historyLoading && history.length === 0 && (
            <p className="text-sm text-surface-400 px-5 py-4">No saved portfolios yet. Run an analysis and generate a report to save it.</p>
          )}

          {!historyLoading && history.length > 0 && (
            <div className="divide-y divide-surface-200 max-h-80 overflow-y-auto">
              {history.map((run) => (
                <div key={run.run_id} role="button" tabIndex={0}
                  onClick={() => loadFromHistory(run.run_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void loadFromHistory(run.run_id);
                    }
                  }}
                  className="w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-surface-100 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-surface-800">{run.source_name}</p>
                      {run.has_report && (
                        <span className="text-[10px] bg-pharma-50 text-pharma-900 font-semibold border border-pharma-200 px-1.5 py-0.5 rounded-full">Report</span>
                      )}
                      <span className="text-[10px] bg-surface-100 text-surface-500 border border-surface-300 px-1.5 py-0.5 rounded-full capitalize">{run.source_type}</span>
                    </div>
                    <p className="text-xs text-surface-500 mt-0.5">
                      {run.saved_at} · {run.stats?.total ?? 0} molecules · {run.stats?.matched_iqvia ?? 0} IQVIA matched
                      {run.model && <> · {run.model}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => deleteFromHistory(run.run_id, e)}
                      className="p-1.5 rounded-lg text-surface-300 hover:text-rose-700 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-surface-400 group-hover:text-surface-700 transition-colors" />
                  </div>
                </div>
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
              { id: "upload",   label: "Upload catalogue", icon: Upload,       desc: "PDF, CSV, or Excel" },
              { id: "craft",    label: "Craft a list",      icon: Plus,         desc: "Search & select molecules" },
              { id: "molecule", label: "Single molecule",   icon: FlaskConical, desc: "Run an ad-hoc lookup" },
            ] as const).map(({ id, label, icon: Icon, desc }) => (
              <button key={id} onClick={() => { setMode(id); setCraftMolecules([]); }}
                className={`p-4 rounded-xl border text-left transition-all ${
                  mode === id
                    ? "border-pharma-300 bg-pharma-50 text-pharma-900"
                    : "border-surface-200 bg-surface-50 text-surface-600 hover:border-surface-300"
                }`}>
                <Icon className={`w-5 h-5 mb-2 ${mode === id ? "text-pharma-900" : "text-surface-500"}`} />
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs opacity-60 mt-0.5">{desc}</p>
              </button>
            ))}
          </div>

          {/* Input form */}
          <div className="bg-white shadow-sm border-surface-200 border border-surface-200 rounded-xl p-6 space-y-4">

            {/* Company / portfolio name */}
            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1.5">
                {mode === "molecule" ? "Molecule Name (auto-filled)" : "Company / Portfolio Name"}
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder={mode === "upload" ? "e.g. Adalvo" : mode === "craft" ? "e.g. CNS Portfolio" : "Leave blank to auto-fill"}
                className="w-full bg-white border border-surface-300 rounded-xl px-4 py-2.5 text-sm text-surface-900 placeholder-zinc-600 focus:outline-none focus:border-pharma-300 transition-colors"
              />
            </div>

            {/* Upload mode */}
            {mode === "upload" && (
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1.5">Catalogue File</label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => document.getElementById("file-input")?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    dragging
                      ? "border-pharma-500/70 bg-pharma-900 text-white font-medium/5"
                      : file
                        ? "border-pharma-300 bg-pharma-900 text-white font-medium/5"
                        : "border-surface-300 hover:border-zinc-600"
                  }`}>
                  <input id="file-input" type="file" accept=".pdf,.csv,.xlsx,.xls" className="hidden"
                    onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileText className="w-8 h-8 text-pharma-900" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-surface-800">{file.name}</p>
                        <p className="text-xs text-surface-500">{(file.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        className="ml-2 text-surface-500 hover:text-rose-700 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-surface-400 mx-auto mb-3" />
                      <p className="text-sm text-surface-600">Drop file here or click to browse</p>
                      <p className="text-xs text-surface-400 mt-1">PDF, CSV, XLSX supported</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Craft mode */}
            {mode === "craft" && (
              <div className="space-y-3">
                <label className="block text-xs font-medium text-surface-600">Add Molecules</label>
                <MoleculeSearchInput
                  allMolecules={allMolecules}
                  selected={craftMolecules}
                  onAdd={(mol) => setCraftMolecules((prev) => [...prev, mol])}
                />
                {craftMolecules.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {craftMolecules.map((mol) => (
                      <span key={mol}
                        className="flex items-center gap-1.5 bg-pharma-50 border border-pharma-200 text-pharma-900 text-xs px-3 py-1 rounded-full">
                        {mol}
                        <button onClick={() => setCraftMolecules((prev) => prev.filter((m) => m !== mol))}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {craftMolecules.length === 0 && (
                  <p className="text-xs text-surface-400">Type at least 2 characters to search</p>
                )}
              </div>
            )}

            {/* Single molecule mode */}
            {mode === "molecule" && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-surface-600">Select Molecule</label>
                <MoleculeSearchInput
                  allMolecules={allMolecules}
                  selected={craftMolecules}
                  onAdd={(mol) => { setCraftMolecules([mol]); setCompanyName(mol); }}
                />
                {craftMolecules[0] && (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 bg-pharma-50 border border-pharma-200 text-pharma-900 text-xs px-3 py-1 rounded-full">
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
              <label className="block text-xs font-medium text-surface-600 mb-1.5">Scoring Model (Pass 2)</label>
              <div className="relative">
                <select
                  value={scoringModel}
                  onChange={(e) => setScoringModel(e.target.value)}
                  className="w-full appearance-none bg-white border border-surface-300 rounded-xl px-4 py-2.5 text-sm text-surface-900 focus:outline-none focus:border-pharma-300 transition-colors">
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" />
              </div>
            </div>

            {enrichError && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                {enrichError}
              </p>
            )}

            <button
              onClick={runPhase1}
              disabled={enrichLoading || (mode === "upload" && !file) || (mode !== "upload" && craftMolecules.length === 0)}
              className="w-full flex items-center justify-center gap-2 bg-pharma-900 text-white font-medium hover:bg-pharma-800 text-white disabled:bg-zinc-700 disabled:text-surface-500 text-white font-medium py-2.5 px-4 rounded-xl transition-colors text-sm">
              {enrichLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {enrichLoading ? "Extracting & enriching molecules..." : "Analyse catalogue"}
            </button>
          </div>
        </div>
      )}

      {/* ── PORTFOLIO + REPORT VIEW (shared with My Portfolio) ── */}
      {(phase === "portfolio" || phase === "report") && result && (
        <PortfolioView
          result={result}
          cards={scoredCards}
          phase={phase}
          onPhaseChange={setPhase}
          reportText={reportText}
          reportStreaming={reportStreaming}
          reportDone={reportDone}
          models={MODELS}
          scoringModel={scoringModel}
          onScoringModelChange={setScoringModel}
          onGenerateReport={() => runPhase2()}
          decisionFor={(molecule) => shortlistStatus[molecule.toUpperCase()] ?? null}
          onDecision={toggleShortlist}
          allowMaybe
          onMoleculeOpen={setDrawerMolecule}
          actions={
            <button
              onClick={savePortfolioNow}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-300 text-sm text-surface-600 hover:text-surface-900 hover:bg-surface-100 disabled:opacity-60 transition-colors"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : savedOk ? <Check className="w-4 h-4 text-emerald-700" /> : <Save className="w-4 h-4" />}
              {savedOk ? "Saved" : "Save"}
            </button>
          }
          footer={shortlistedIqviaMols.length > 0 && (
            <div className="flex items-center gap-4 p-4 rounded-xl bg-pharma-50 border border-pharma-200">
              <TrendingUp className="w-5 h-5 text-pharma-900 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-pharma-900">
                  {shortlistedIqviaMols.length} molecule{shortlistedIqviaMols.length !== 1 ? "s" : ""} shortlisted
                </p>
                <p className="text-xs text-pharma-700/70">Generate a Y1–Y3 revenue forecast for your selection</p>
              </div>
              <button
                onClick={goToForecast}
                className="flex items-center gap-2 bg-pharma-900 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-pharma-800 transition-colors shrink-0"
              >
                <TrendingUp className="w-4 h-4" /> Generate Forecasts
              </button>
            </div>
          )}
        />
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
