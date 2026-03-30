"use client";

import { TrendingUp, TrendingDown, Users, Building2, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { MoleculeCard as MoleculeCardType } from "@/lib/api";

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
    score >= 6 ? "bg-pharma-500/20 text-pharma-400 border-pharma-500/30" :
    score >= 4 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                 "bg-rose-500/20 text-rose-400 border-rose-500/30";
  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold ${color}`}>
      <span>{score}</span>
      <span className="text-[10px] opacity-70">/10</span>
    </div>
  );
}

function StatRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-zinc-800/40 last:border-0">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-xs font-medium ${highlight ? "text-pharma-400" : "text-zinc-300"}`}>{value}</span>
    </div>
  );
}

function fmt(v?: number | null, decimals = 1) {
  if (v == null) return "N/A";
  return v.toFixed(decimals);
}

function fmtAed(v?: number | null) {
  if (v == null) return "N/A";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

interface Props {
  molecule: MoleculeCardType;
  onClick?: () => void;
}

export function MoleculeCard({ molecule: m, onClick }: Props) {
  const [showReasoning, setShowReasoning] = useState(false);
  const cagr = m.value_cagr_pct;
  const cagrPositive = cagr != null && cagr > 0;

  return (
    <div
      onClick={onClick}
      className="rounded-xl bg-surface-800/50 border border-zinc-800/50 p-4 card-hover cursor-pointer flex flex-col gap-3"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100 truncate">{m.molecule}</h3>
          {m.atc4_class && (
            <p className="text-[11px] text-zinc-500 truncate mt-0.5">{m.atc4_class}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {m.ai_score != null && <ScoreBadge score={m.ai_score} />}
          {!m.in_iqvia && (
            <span className="text-[10px] bg-zinc-800 text-zinc-500 border border-zinc-700 px-1.5 py-0.5 rounded">Not in IQVIA</span>
          )}
        </div>
      </div>

      {m.in_iqvia && (
        <>
          {/* Market value + CAGR */}
          <div className="flex items-center justify-between bg-surface-900/50 rounded-lg px-3 py-2">
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Market Value</p>
              <p className="text-lg font-bold text-pharma-400">AED {fmtAed(m.market_value_aed)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">CAGR</p>
              <div className={`flex items-center gap-1 justify-end ${cagrPositive ? "text-emerald-400" : "text-rose-400"}`}>
                {cagrPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span className="text-base font-bold">{fmt(cagr)}%</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="space-y-0.5">
            <StatRow
              label="Competitors (IQVIA)"
              value={m.num_competitors != null ? String(m.num_competitors) : "N/A"}
              highlight={m.num_competitors != null && m.num_competitors <= 4}
            />
            <StatRow label="Market Leader"     value={m.market_leader ? `${m.market_leader} (${fmt(m.leader_share_pct)}%)` : "N/A"} />
            <StatRow label="Private / LPO"     value={`${fmt(m.private_pct, 0)}% / ${fmt(m.lpo_pct, 0)}%`} />
            <StatRow label="UPP / MOHAP Mfrs"  value={`${m.upp_manufacturers ?? 0} / ${m.mohap_manufacturers ?? 0}`} />
            {m.cagr_delta != null && (
              <StatRow
                label="Price signal (δCAGR)"
                value={`${m.cagr_delta > 0 ? "+" : ""}${fmt(m.cagr_delta)}%`}
                highlight={m.cagr_delta > 0}
              />
            )}
          </div>
        </>
      )}

      {/* AI Reasoning toggle */}
      {m.ai_reasoning && (
        <div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowReasoning(!showReasoning); }}
            className="flex items-center gap-1 text-xs text-pharma-400 hover:text-pharma-300 transition-colors"
          >
            {showReasoning ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showReasoning ? "Hide reasoning" : "View reasoning"}
          </button>
          {showReasoning && (
            <p className="mt-2 text-xs text-zinc-400 leading-relaxed border-l-2 border-pharma-500/30 pl-2">
              {m.ai_reasoning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
