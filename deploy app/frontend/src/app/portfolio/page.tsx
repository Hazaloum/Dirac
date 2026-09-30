"use client";

import { useState, useRef, useEffect } from "react";
import { Briefcase, Plus, Loader2, Trash2, Pencil } from "lucide-react";
import { api, streamScore, type AnalysisResult, type MoleculeCard as MolCardType, type MyPortfolio } from "@/lib/api";
import { MoleculeDrawer } from "@/components/MoleculeDrawer";
import { PortfolioView, topFiveMolecules, type Decision } from "@/components/PortfolioView";
import { PortfolioBuilder } from "@/components/PortfolioBuilder";

// ─── Types ────────────────────────────────────────────────────────────────────
type Phase     = "loading" | "empty" | "setup" | "portfolio" | "report";

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
  const [shortlistStatus, setShortlistStatus] = useState<Record<string, Decision | null>>({});

  const abortRef         = useRef<AbortController | null>(null);
  const reportSavedRef   = useRef(false);

  const toggleShortlist = (mol: string, status: Decision) => {
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

  const top5Molecules = topFiveMolecules(scoredCards, reportDone);

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
          onGenerateReport={runReport}
          decisionFor={(mol) => shortlistStatus[mol.toUpperCase()] ?? null}
          onDecision={toggleShortlist}
          onMoleculeOpen={setDrawerMolecule}
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
