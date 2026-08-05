"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  CircleDashed,
  GitCompareArrows,
  Loader2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  api,
  type MoleculeCard,
  type PipelineDecision,
  type PipelineDecisionValue,
} from "@/lib/api";
import { FORECAST_SESSION_KEY, type ForecastSession } from "@/lib/forecastSession";
import { MoleculeDrawer } from "@/components/MoleculeDrawer";

const decisionMeta: Record<PipelineDecisionValue, { label: string; tone: string }> = {
  yes: { label: "Yes", tone: "matthew-pill--yes" },
  maybe: { label: "Maybe", tone: "matthew-pill--maybe" },
  no: { label: "No", tone: "matthew-pill--no" },
};

function fmtAed(value?: number) {
  if (value == null) return "—";
  if (value >= 1_000_000_000) return `AED ${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `AED ${(value / 1_000_000).toFixed(1)}M`;
  return `AED ${(value / 1_000).toFixed(0)}K`;
}

function scoreTier(score?: number) {
  if (score == null) return { label: "Unscored", color: "#737f79" };
  if (score >= 8) return { label: "Pursue", color: "#2f8f5b" };
  if (score >= 6) return { label: "Watch", color: "#b5852a" };
  return { label: "Pass", color: "#b2483f" };
}

function DecisionControl({
  value,
  onChange,
}: {
  value: PipelineDecisionValue;
  onChange: (value: PipelineDecisionValue) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-100 p-1" aria-label="Evaluation decision">
      {(["yes", "maybe", "no"] as PipelineDecisionValue[]).map((decision) => (
        <button
          key={decision}
          onClick={() => onChange(decision)}
          className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${
            value === decision
              ? `${decisionMeta[decision].tone} shadow-sm`
              : "text-surface-400 hover:bg-white hover:text-surface-700"
          }`}
        >
          {decisionMeta[decision].label}
        </button>
      ))}
    </div>
  );
}

export default function PipelinePage() {
  const router = useRouter();
  const [decisions, setDecisions] = useState<PipelineDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | PipelineDecisionValue>("all");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [selected, setSelected] = useState<MoleculeCard | null>(null);

  useEffect(() => {
    api.getPipeline()
      .then(({ decisions: rows }) => setDecisions(rows))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    yes: decisions.filter((d) => d.decision === "yes").length,
    maybe: decisions.filter((d) => d.decision === "maybe").length,
    no: decisions.filter((d) => d.decision === "no").length,
  }), [decisions]);

  const visible = useMemo(
    () => decisions.filter((d) => filter === "all" || d.decision === filter),
    [decisions, filter],
  );

  const totalValue = decisions
    .filter((d) => d.decision !== "no")
    .reduce((sum, d) => sum + (d.snapshot.market_value_aed ?? 0), 0);

  const compareRows = compareIds
    .map((id) => decisions.find((d) => d.molecule === id))
    .filter((d): d is PipelineDecision => Boolean(d));

  async function updateDecision(row: PipelineDecision, decision: PipelineDecisionValue) {
    setDecisions((current) => current.map((item) =>
      item.molecule === row.molecule ? { ...item, decision } : item
    ));
    try {
      const saved = await api.setPipelineDecision({
        molecule: row.molecule,
        decision,
        source_name: row.source_name,
        snapshot: row.snapshot,
      });
      setDecisions((current) => current.map((item) =>
        item.molecule === saved.molecule ? saved : item
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update pipeline");
      setDecisions((current) => current.map((item) =>
        item.molecule === row.molecule ? row : item
      ));
    }
  }

  async function removeDecision(molecule: string) {
    const previous = decisions;
    setDecisions((current) => current.filter((item) => item.molecule !== molecule));
    setCompareIds((current) => current.filter((id) => id !== molecule));
    try {
      await api.clearPipelineDecision(molecule);
    } catch (e) {
      setDecisions(previous);
      setError(e instanceof Error ? e.message : "Could not remove molecule");
    }
  }

  function toggleCompare(molecule: string) {
    setCompareIds((current) => {
      if (current.includes(molecule)) return current.filter((id) => id !== molecule);
      if (current.length >= 4) return current;
      return [...current, molecule];
    });
  }

  function openForecast() {
    const molecules = decisions
      .filter((d) => d.decision === "yes" && d.snapshot.in_iqvia)
      .map((d) => d.snapshot);
    if (!molecules.length) return;
    const groups: Record<string, string[]> = {};
    for (const molecule of molecules) {
      const key = molecule.atc1_class || "Unclassified";
      (groups[key] ||= []).push(molecule.molecule);
    }
    const session: ForecastSession = { molecules, molecules_by_atc1: groups };
    localStorage.setItem(FORECAST_SESSION_KEY, JSON.stringify(session));
    router.push("/forecast");
  }

  return (
    <div className="min-h-screen p-8 lg:p-10">
      <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="matthew-eyebrow mb-3">Cross-catalogue evaluation</p>
          <h1 className="matthew-page-title">Pipeline</h1>
          <p className="matthew-lede mt-3">
            The molecules you have triaged across manufacturer catalogues, held in one place for comparison and commercial decisions.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setCompareOpen(true)}
            disabled={compareIds.length < 2}
            className="flex items-center gap-2 rounded-lg border border-surface-300 bg-white px-4 py-2.5 text-xs font-semibold text-surface-700 transition hover:border-pharma-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GitCompareArrows className="h-4 w-4" /> Compare {compareIds.length || ""}
          </button>
          <button
            onClick={openForecast}
            disabled={!counts.yes}
            className="flex items-center gap-2 rounded-lg bg-pharma-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-pharma-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Forecast {counts.yes} selected <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mb-7 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="matthew-stat"><small>Evaluated</small><strong>{decisions.length}</strong></div>
        <div className="matthew-stat"><small>Yes · pursue</small><strong className="!text-emerald-700">{counts.yes}</strong></div>
        <div className="matthew-stat"><small>Maybe · watch</small><strong className="!text-amber-700">{counts.maybe}</strong></div>
        <div className="matthew-stat"><small>Active market value</small><strong className="!text-[22px]">{fmtAed(totalValue)}</strong></div>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-surface-200 bg-white p-1">
          <SlidersHorizontal className="mx-2 h-4 w-4 text-surface-400" />
          {(["all", "yes", "maybe", "no"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                filter === key ? "bg-pharma-50 text-pharma-900" : "text-surface-500 hover:text-surface-800"
              }`}
            >
              {key} {key !== "all" ? counts[key] : decisions.length}
            </button>
          ))}
        </div>
        <p className="text-xs text-surface-400">Select up to four molecules for comparison</p>
      </div>

      {error ? (
        <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="flex min-h-72 items-center justify-center text-surface-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading pipeline…
        </div>
      ) : visible.length === 0 ? (
        <div className="matthew-panel flex min-h-80 flex-col items-center justify-center p-10 text-center">
          <CircleDashed className="mb-4 h-9 w-9 text-surface-300" />
          <h2 className="font-serif text-2xl text-surface-900">No molecules here yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-surface-500">
            Open a catalogue and mark molecules Yes, Maybe, or No. Decisions will appear here automatically.
          </p>
          <button onClick={() => router.push("/analysis")} className="mt-5 rounded-lg bg-pharma-900 px-4 py-2 text-xs font-semibold text-white">
            Go to catalogues
          </button>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((row) => {
            const m = row.snapshot;
            const tier = scoreTier(m.ai_score);
            const selectedForCompare = compareIds.includes(row.molecule);
            return (
              <article key={row.molecule} className="matthew-panel p-5 transition hover:border-pharma-300">
                <div className="flex items-start justify-between gap-4">
                  <button onClick={() => setSelected(m)} className="min-w-0 flex-1 text-left">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`matthew-pill ${decisionMeta[row.decision].tone}`}>{decisionMeta[row.decision].label}</span>
                      <span className="matthew-pill" style={{ color: tier.color, background: `${tier.color}16` }}>{tier.label}</span>
                      <span className="text-[10px] text-surface-400">{row.source_name || "Catalogue"}</span>
                    </div>
                    <h2 className="truncate font-serif text-[22px] font-medium text-surface-900">{row.molecule}</h2>
                    <p className="mt-1 truncate text-xs text-surface-500">{m.atc4_class || m.atc1_class || "Unclassified molecule"}</p>
                  </button>
                  <button
                    onClick={() => toggleCompare(row.molecule)}
                    aria-label={`${selectedForCompare ? "Remove" : "Add"} ${row.molecule} ${selectedForCompare ? "from" : "to"} comparison`}
                    className={`grid h-8 w-8 place-items-center rounded-lg border transition ${
                      selectedForCompare ? "border-pharma-700 bg-pharma-900 text-white" : "border-surface-200 text-surface-400 hover:border-pharma-400 hover:text-pharma-900"
                    }`}
                  >
                    {selectedForCompare ? <Check className="h-4 w-4" /> : <GitCompareArrows className="h-4 w-4" />}
                  </button>
                </div>

                <button onClick={() => setSelected(m)} className="my-5 grid w-full grid-cols-4 gap-3 text-left">
                  <div><span className="matthew-eyebrow">Market value</span><strong className="mt-1.5 block text-sm">{fmtAed(m.market_value_aed)}</strong></div>
                  <div><span className="matthew-eyebrow">Value CAGR</span><strong className="mt-1.5 block text-sm text-emerald-700">{m.value_cagr_pct != null ? `${m.value_cagr_pct > 0 ? "+" : ""}${m.value_cagr_pct.toFixed(1)}%` : "—"}</strong></div>
                  <div><span className="matthew-eyebrow">Competitors</span><strong className="mt-1.5 block text-sm">{m.num_competitors ?? "—"}</strong></div>
                  <div><span className="matthew-eyebrow">Private</span><strong className="mt-1.5 block text-sm">{m.private_pct != null ? `${m.private_pct.toFixed(0)}%` : "—"}</strong></div>
                </button>

                <div className="flex items-center gap-3 border-t border-surface-200 pt-4">
                  <div className="flex-1"><DecisionControl value={row.decision} onChange={(value) => updateDecision(row, value)} /></div>
                  <button onClick={() => removeDecision(row.molecule)} className="grid h-8 w-8 place-items-center rounded-lg text-surface-300 transition hover:bg-rose-50 hover:text-rose-700" aria-label={`Remove ${row.molecule} from pipeline`}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {compareIds.length ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-surface-300 bg-surface-900 px-4 py-3 text-white shadow-xl">
          <GitCompareArrows className="h-4 w-4 text-pharma-300" />
          <p className="text-xs"><strong>{compareIds.length}</strong> selected</p>
          <button onClick={() => setCompareOpen(true)} disabled={compareIds.length < 2} className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-surface-900 disabled:opacity-40">Compare</button>
          <button onClick={() => setCompareIds([])} aria-label="Clear comparison"><X className="h-4 w-4 text-surface-300" /></button>
        </div>
      ) : null}

      {compareOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/55 p-5 backdrop-blur-sm" onClick={() => setCompareOpen(false)}>
          <section role="dialog" aria-modal="true" aria-labelledby="compare-title" className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-xl bg-surface-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-surface-200 bg-surface-50 px-6 py-5">
              <div><p className="matthew-eyebrow mb-2">Decision support</p><h2 id="compare-title" className="font-serif text-3xl">Compare molecules</h2></div>
              <button onClick={() => setCompareOpen(false)} aria-label="Close comparison" className="rounded-lg p-2 text-surface-500 hover:bg-surface-100"><X className="h-5 w-5" /></button>
            </div>
            {compareRows.length < 2 ? (
              <p className="p-10 text-center text-sm text-surface-500">Select at least two molecules to compare.</p>
            ) : (
              <div className="overflow-x-auto p-6">
                <table className="data-table min-w-[820px] overflow-hidden rounded-lg border border-surface-200">
                  <thead><tr><th>Metric</th>{compareRows.map((r) => <th key={r.molecule}>{r.molecule}</th>)}</tr></thead>
                  <tbody>
                    {[
                      ["Decision", (r: PipelineDecision) => decisionMeta[r.decision].label],
                      ["AI score", (r: PipelineDecision) => r.snapshot.ai_score != null ? `${r.snapshot.ai_score}/10` : "Unscored"],
                      ["Therapeutic area", (r: PipelineDecision) => r.snapshot.atc1_class || "—"],
                      ["Market value", (r: PipelineDecision) => fmtAed(r.snapshot.market_value_aed)],
                      ["Value CAGR", (r: PipelineDecision) => r.snapshot.value_cagr_pct != null ? `${r.snapshot.value_cagr_pct.toFixed(1)}%` : "—"],
                      ["Competitors", (r: PipelineDecision) => String(r.snapshot.num_competitors ?? "—")],
                      ["Market leader", (r: PipelineDecision) => r.snapshot.market_leader || "—"],
                      ["Leader share", (r: PipelineDecision) => r.snapshot.leader_share_pct != null ? `${r.snapshot.leader_share_pct.toFixed(1)}%` : "—"],
                      ["Private channel", (r: PipelineDecision) => r.snapshot.private_pct != null ? `${r.snapshot.private_pct.toFixed(1)}%` : "—"],
                      ["MOHAP holders", (r: PipelineDecision) => String(r.snapshot.mohap_manufacturers ?? "—")],
                      ["UPP manufacturers", (r: PipelineDecision) => String(r.snapshot.upp_manufacturers ?? "—")],
                    ].map(([label, getter]) => (
                      <tr key={label as string}>
                        <td className="font-medium text-surface-500">{label as string}</td>
                        {compareRows.map((r) => <td key={r.molecule}>{(getter as (row: PipelineDecision) => string)(r)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      <MoleculeDrawer molecule={selected} isTop5={false} onClose={() => setSelected(null)} />
    </div>
  );
}
