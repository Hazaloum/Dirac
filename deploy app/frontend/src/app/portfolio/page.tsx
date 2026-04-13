"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Briefcase, Upload, Plus, Search, FlaskConical, LayoutGrid, Map,
  FileText, Play, Loader2, X, ChevronDown, Star,
  CheckCircle2, XCircle, Trash2, RefreshCw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, streamScore, type AnalysisResult, type MoleculeCard as MolCardType, type MyPortfolio } from "@/lib/api";
import { PortfolioTreemap } from "@/components/PortfolioTreemap";
import { ManufacturerPieChart } from "@/components/IQVIACharts";
import { MoleculeDrawer } from "@/components/MoleculeDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────
type InputMode = "upload" | "craft";
type Phase     = "loading" | "empty" | "upload" | "portfolio" | "report";
type ViewMode  = "grid" | "treemap";
type ReportTab = "report" | "charts";

const MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o Mini (fast, cheap)" },
  { id: "gpt-4o",      label: "GPT-4o (best quality)" },
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

// ─── Molecule search dropdown (identical to analysis page) ───────────────────
function MoleculeSearchInput({
  allMolecules, selected, onAdd,
}: {
  allMolecules: string[];
  selected: string[];
  onAdd: (mol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const ref               = useRef<HTMLDivElement>(null);

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
          onFocus={() => setOpen(true)}
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
export default function MyPortfolioPage() {
  const [phase,      setPhase]      = useState<Phase>("loading");
  const [inputMode,  setInputMode]  = useState<InputMode>("upload");
  const [viewMode,   setViewMode]   = useState<ViewMode>("grid");
  const [reportTab,  setReportTab]  = useState<ReportTab>("report");

  // Saved portfolio metadata
  const [savedAt,      setSavedAt]      = useState("");
  const [companyName,  setCompanyName]  = useState("My Portfolio");

  // Upload / craft input state
  const [file,           setFile]           = useState<File | null>(null);
  const [craftMolecules, setCraftMolecules] = useState<string[]>([]);
  const [allMolecules,   setAllMolecules]   = useState<string[]>([]);
  const [scoringModel,   setScoringModel]   = useState("gpt-4o-mini");
  const [uploadName,     setUploadName]     = useState("");
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
  const [dragging,        setDragging]        = useState(false);

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
    api.getMolecules().then((d) => setAllMolecules(d.molecules)).catch(() => {});
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
    setCompanyName(portfolio.company_name);
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

  // ── Drag & drop ──
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }, []);

  // ── Save portfolio ──
  const savePortfolio = async () => {
    setSaveError("");
    setSaving(true);
    try {
      let res: AnalysisResult;
      if (inputMode === "upload") {
        if (!file) throw new Error("Please select a file");
        res = await api.savePortfolioUpload(file, uploadName || file.name.replace(/\.[^.]+$/, ""));
        setCompanyName(uploadName || file.name.replace(/\.[^.]+$/, ""));
      } else {
        if (!craftMolecules.length) throw new Error("Add at least one molecule");
        res = await api.savePortfolioEnrich(craftMolecules, uploadName || "My Portfolio");
        setCompanyName(uploadName || "My Portfolio");
      }
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
        source_name:   companyName,
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
    setFile(null);
    setCraftMolecules([]);
    setUploadName("");
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
    <div className="min-h-screen p-8">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-3">
            <Briefcase className="w-6 h-6 text-pharma-900" />
            My Portfolio
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            {phase === "empty" || phase === "upload"
              ? "Upload your portfolio once — it stays here permanently"
              : `${companyName} · saved ${savedAt}`
            }
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(phase === "portfolio" || phase === "report") && (
            <>
              {/* Replace portfolio */}
              <button
                onClick={() => { abortRef.current?.abort(); setPhase("upload"); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-300 text-sm text-surface-600 hover:text-surface-900 hover:bg-surface-100 transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> Replace Portfolio
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
          {phase === "upload" && (
            <button
              onClick={() => setPhase(result ? "portfolio" : "empty")}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-300 text-sm text-surface-600 hover:text-surface-900 hover:bg-surface-100 transition-colors"
            >
              <X className="w-4 h-4" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* ── UPLOAD FORM (empty state or replace) ── */}
      {(phase === "empty" || phase === "upload") && (
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Empty state prompt */}
          {phase === "empty" && (
            <div className="text-center py-12 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-pharma-50 border border-pharma-200 flex items-center justify-center mx-auto">
                <Briefcase className="w-8 h-8 text-pharma-900" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-surface-800">No portfolio saved yet</h2>
                <p className="text-sm text-surface-500 mt-1">Upload a catalogue or build your portfolio from molecules</p>
              </div>
              <button
                onClick={() => setPhase("upload")}
                className="inline-flex items-center gap-2 bg-pharma-900 text-white font-medium hover:bg-pharma-800 py-2.5 px-6 rounded-xl transition-colors text-sm"
              >
                <Plus className="w-4 h-4" /> Set Up My Portfolio
              </button>
            </div>
          )}

          {/* Upload form */}
          {phase === "upload" && (
            <>
              {/* Mode toggle */}
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: "upload" as InputMode, label: "Upload Portfolio", icon: Upload, desc: "PDF, CSV, or Excel" },
                  { id: "craft"  as InputMode, label: "Craft Portfolio",  icon: Plus,   desc: "Search & select molecules" },
                ] as const).map(({ id, label, icon: Icon, desc }) => (
                  <button key={id} onClick={() => { setInputMode(id); setCraftMolecules([]); }}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      inputMode === id
                        ? "border-pharma-300 bg-pharma-50 text-pharma-900"
                        : "border-surface-200 bg-surface-50 text-surface-600 hover:border-surface-300"
                    }`}>
                    <Icon className={`w-5 h-5 mb-2 ${inputMode === id ? "text-pharma-900" : "text-surface-500"}`} />
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs opacity-60 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>

              {/* Form card */}
              <div className="bg-white shadow-sm border border-surface-200 rounded-xl p-6 space-y-4">
                {/* Portfolio name */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1.5">Portfolio / Company Name</label>
                  <input
                    type="text"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    placeholder={inputMode === "upload" ? "e.g. Adalvo" : "e.g. CNS Portfolio"}
                    className="w-full bg-white border border-surface-300 rounded-xl px-4 py-2.5 text-sm text-surface-900 placeholder-zinc-600 focus:outline-none focus:border-pharma-300 transition-colors"
                  />
                </div>

                {/* Upload mode */}
                {inputMode === "upload" && (
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1.5">Catalogue File</label>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={onDrop}
                      onClick={() => document.getElementById("portfolio-file-input")?.click()}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                        dragging
                          ? "border-pharma-500/70 bg-pharma-900/5"
                          : file
                            ? "border-pharma-300 bg-pharma-50"
                            : "border-surface-300 hover:border-zinc-600"
                      }`}>
                      <input
                        id="portfolio-file-input"
                        type="file"
                        accept=".pdf,.csv,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
                      />
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
                {inputMode === "craft" && (
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

                {/* Scoring model */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1.5">Scoring Model (for AI Report)</label>
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

                {saveError && (
                  <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                    {saveError}
                  </p>
                )}

                <button
                  onClick={savePortfolio}
                  disabled={saving || (inputMode === "upload" && !file) || (inputMode === "craft" && craftMolecules.length === 0)}
                  className="w-full flex items-center justify-center gap-2 bg-pharma-900 text-white font-medium hover:bg-pharma-800 disabled:bg-zinc-700 disabled:text-surface-500 py-2.5 px-4 rounded-xl transition-colors text-sm">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Briefcase className="w-4 h-4" />}
                  {saving ? "Saving portfolio..." : "Save as My Portfolio"}
                </button>
              </div>
            </>
          )}
        </div>
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
              <p className="text-xs text-surface-500">Portfolio</p>
              <p className="text-xl font-bold text-surface-900">{companyName}</p>
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
                                    <div className="absolute -top-2.5 -right-2.5 w-6 h-6 bg-amber-700 rounded-full flex items-center justify-center shadow-md z-10 ring-2 ring-zinc-900">
                                      <Star className="w-3.5 h-3.5 text-amber-900 fill-amber-900" />
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
