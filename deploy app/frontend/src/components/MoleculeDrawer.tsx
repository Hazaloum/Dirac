"use client";

import { useEffect } from "react";
import {
  X, TrendingUp, TrendingDown, Users, Building2,
  FlaskConical, Star, Activity, BarChart2, Layers,
  ShieldCheck, ShieldAlert, Minus,
} from "lucide-react";
import { ManufacturerPieChart } from "@/components/IQVIACharts";
import type { MoleculeCard } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAed(v?: number | null) {
  if (v == null) return "N/A";
  if (v >= 1_000_000_000) return `AED ${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000)     return `AED ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `AED ${(v / 1_000).toFixed(0)}K`;
  return `AED ${v.toFixed(0)}`;
}

function fmtPct(v?: number | null, showSign = false) {
  if (v == null) return "N/A";
  return `${showSign && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function fmtNum(v?: number | null) {
  if (v == null) return "N/A";
  return v.toString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, icon, children }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-50 border-surface-200 border border-surface-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-pharma-50 text-pharma-900">{icon}</div>
        <h3 className="text-sm font-semibold text-surface-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function MetricRow({ label, value, highlight, sub }: {
  label: string;
  value: string;
  highlight?: "good" | "bad" | "neutral";
  sub?: string;
}) {
  const valueColor =
    highlight === "good"    ? "text-emerald-700" :
    highlight === "bad"     ? "text-rose-700" :
    highlight === "neutral" ? "text-amber-700" :
    "text-surface-800";
  return (
    <div className="flex items-center justify-between py-2 border-b border-surface-200/40 last:border-0">
      <span className="text-xs text-surface-500">{label}</span>
      <div className="text-right">
        <span className={`text-sm font-medium ${valueColor}`}>{value}</span>
        {sub && <p className="text-[11px] text-surface-400">{sub}</p>}
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    score >= 6 ? "bg-pharma-100 text-pharma-900 font-semibold border-pharma-200" :
    score >= 4 ? "bg-amber-50 text-amber-700 border-amber-200" :
                 "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <div className={`flex items-center gap-1 px-3 py-1 rounded-full border text-sm font-bold ${color}`}>
      {score}<span className="text-xs opacity-70">/10</span>
    </div>
  );
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

interface Props {
  molecule: MoleculeCard | null;
  isTop5: boolean;
  onClose: () => void;
}

export function MoleculeDrawer({ molecule: m, isTop5, onClose }: Props) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = m ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [m]);

  if (!m) return null;

  const cagrPositive  = m.value_cagr_pct != null && m.value_cagr_pct >= 0;
  const deltaPositive = m.cagr_delta != null && m.cagr_delta > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-xl bg-white border-l border-surface-200 z-50 flex flex-col shadow-2xl overflow-hidden animate-slide-in-right">

        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-surface-200/60 shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className="p-1.5 rounded-lg bg-pharma-50 text-pharma-900">
                <FlaskConical className="w-4 h-4" />
              </div>
              {isTop5 && (
                <div className="w-6 h-6 bg-amber-700 rounded-full flex items-center justify-center ring-2 ring-zinc-900 shrink-0">
                  <Star className="w-3.5 h-3.5 text-amber-900 fill-amber-900" />
                </div>
              )}
              {!m.in_iqvia && (
                <span className="text-[10px] bg-surface-100 text-surface-500 border border-surface-300 px-2 py-0.5 rounded">
                  Not in IQVIA
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-surface-900 truncate">{m.molecule}</h2>
            {m.atc4_class && (
              <p className="text-xs text-surface-500 mt-0.5 truncate">{m.atc4_class}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {m.ai_score != null && <ScoreBadge score={m.ai_score} />}
            <button
              onClick={onClose}
              className="p-2 text-surface-500 hover:text-surface-800 hover:bg-surface-100 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── Market Overview ── */}
          {m.in_iqvia && (
            <Section title="Market Overview" icon={<Activity className="w-4 h-4" />}>
              {/* Hero value + CAGR */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-white/60 rounded-xl p-4 text-center">
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">UAE Market Value</p>
                  <p className="text-xl font-bold text-pharma-900">{fmtAed(m.market_value_aed)}</p>
                  {m.launch_year && (
                    <p className="text-[11px] text-surface-400 mt-1">Since {m.launch_year}</p>
                  )}
                </div>
                <div className="bg-white/60 rounded-xl p-4 text-center">
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Value CAGR</p>
                  <div className={`flex items-center justify-center gap-1 ${cagrPositive ? "text-emerald-700" : "text-rose-700"}`}>
                    {cagrPositive
                      ? <TrendingUp className="w-4 h-4" />
                      : <TrendingDown className="w-4 h-4" />}
                    <span className="text-xl font-bold">{fmtPct(m.value_cagr_pct, true)}</span>
                  </div>
                  <p className="text-[11px] text-surface-400 mt-1">
                    Units: {fmtPct(m.unit_cagr_pct, true)}
                  </p>
                </div>
              </div>

              <MetricRow
                label="Price Signal (δCAGR)"
                value={fmtPct(m.cagr_delta, true)}
                highlight={deltaPositive ? "good" : m.cagr_delta != null && m.cagr_delta < 0 ? "bad" : undefined}
                sub={deltaPositive ? "Prices rising vs volume — margin opportunity" : m.cagr_delta != null ? "Price compression / commoditisation" : undefined}
              />
              <MetricRow label="Launch Year" value={m.launch_year ? String(m.launch_year) : "N/A"} />
            </Section>
          )}

          {/* ── Market Structure ── */}
          {m.in_iqvia && (
            <Section title="Market Structure" icon={<Users className="w-4 h-4" />}>
              <MetricRow
                label="Competitors (IQVIA)"
                value={fmtNum(m.num_competitors)}
                highlight={
                  m.num_competitors == null ? undefined :
                  m.num_competitors <= 3 ? "good" :
                  m.num_competitors <= 6 ? "neutral" : "bad"
                }
                sub={
                  m.num_competitors != null && m.num_competitors > 10
                    ? "Disqualifier: >10 competitors"
                    : m.num_competitors != null && m.num_competitors <= 3
                    ? "Low competition — entry viable"
                    : undefined
                }
              />
              <MetricRow
                label="Market Leader"
                value={m.market_leader ?? "N/A"}
                sub={m.leader_share_pct != null ? `${m.leader_share_pct.toFixed(1)}% share` : undefined}
              />
              <MetricRow
                label="Leader Share Change"
                value={m.leader_share_change != null ? fmtPct(m.leader_share_change, true) : "N/A"}
                highlight={
                  m.leader_share_change == null ? undefined :
                  m.leader_share_change < 0 ? "good" : "bad"
                }
                sub={m.leader_share_change != null && m.leader_share_change < 0 ? "Leader losing grip — fragmentation signal" : undefined}
              />
              <MetricRow
                label="Second Player"
                value={m.second_player ?? "N/A"}
              />
              <MetricRow
                label="Top 3 Company Share"
                value={m.top3_company_share != null ? `${m.top3_company_share.toFixed(1)}%` : "N/A"}
                highlight={
                  m.top3_company_share == null ? undefined :
                  m.top3_company_share > 80 ? "bad" :
                  m.top3_company_share < 50 ? "good" : "neutral"
                }
                sub={
                  m.top3_company_share != null && m.top3_company_share > 80
                    ? "Highly concentrated — hard to enter"
                    : m.top3_company_share != null && m.top3_company_share < 50
                    ? "Fragmented — entry viable"
                    : undefined
                }
              />
            </Section>
          )}

          {/* ── Channel Split ── */}
          {m.in_iqvia && m.private_pct != null && (
            <Section title="Channel Split" icon={<BarChart2 className="w-4 h-4" />}>
              {/* Visual bar */}
              <div className="mb-4">
                <div className="flex rounded-full overflow-hidden h-3 mb-2">
                  <div
                    className="bg-pharma-900 text-white font-medium transition-all"
                    style={{ width: `${m.private_pct}%` }}
                  />
                  <div
                    className="bg-zinc-600 transition-all"
                    style={{ width: `${m.lpo_pct ?? 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-surface-500">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-pharma-900 text-white font-medium inline-block" />
                    Private {m.private_pct.toFixed(0)}%
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-zinc-600 inline-block" />
                    LPO {(m.lpo_pct ?? 0).toFixed(0)}%
                  </span>
                </div>
              </div>
              <MetricRow
                label="Private Channel"
                value={fmtPct(m.private_pct)}
                highlight={m.private_pct >= 60 ? "good" : m.private_pct >= 40 ? "neutral" : "bad"}
                sub={m.private_pct >= 60 ? "Favourable for COMIX (target >60%)" : "Below COMIX threshold of 60%"}
              />
              <MetricRow label="LPO / Government" value={fmtPct(m.lpo_pct)} />
            </Section>
          )}

          {/* ── ATC Classification ── */}
          {(m.atc1_class || m.atc3_class || m.atc4_class) && (
            <Section title="ATC Classification" icon={<Layers className="w-4 h-4" />}>
              {m.atc1_class && <MetricRow label="ATC1 (Therapeutic Area)" value={m.atc1_class} />}
              {m.atc3_class && <MetricRow label="ATC3 (Pharmacological)" value={m.atc3_class} />}
              {m.atc4_class && <MetricRow label="ATC4 (Chemical Subgroup)" value={m.atc4_class} />}
            </Section>
          )}

          {/* ── UAE Registrations ── */}
          <Section title="UAE Registrations" icon={<Building2 className="w-4 h-4" />}>
            <MetricRow
              label="Manufacturers in UPP"
              value={fmtNum(m.upp_manufacturers)}
              highlight={
                m.upp_manufacturers == null ? undefined :
                m.upp_manufacturers <= 3 ? "good" :
                m.upp_manufacturers <= 6 ? "neutral" : "bad"
              }
            />
            <MetricRow
              label="Holders in MOHAP"
              value={fmtNum(m.mohap_manufacturers)}
              highlight={
                m.mohap_manufacturers == null ? undefined :
                m.mohap_manufacturers <= 3 ? "good" :
                m.mohap_manufacturers <= 6 ? "neutral" : "bad"
              }
            />
          </Section>

          {/* ── Manufacturer Pie Chart ── */}
          {m.in_iqvia && (
            <Section title="Manufacturer Breakdown" icon={<BarChart2 className="w-4 h-4" />}>
              <ManufacturerPieChart molecule={m.molecule} />
            </Section>
          )}

          {/* ── AI Score & Reasoning ── */}
          {m.ai_score != null && (
            <Section title="AI Scoring" icon={<ShieldCheck className="w-4 h-4" />}>
              <div className="flex items-center gap-4 mb-4">
                <ScoreBadge score={m.ai_score} />
                <div className="flex-1 bg-white/60 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      m.ai_score >= 8 ? "bg-emerald-500" :
                      m.ai_score >= 6 ? "bg-pharma-900 text-white font-medium" :
                      m.ai_score >= 4 ? "bg-amber-500" : "bg-rose-500"
                    }`}
                    style={{ width: `${m.ai_score * 10}%` }}
                  />
                </div>
              </div>
              {m.ai_reasoning ? (
                <p className="text-sm text-surface-700 leading-relaxed border-l-2 border-pharma-200 pl-3">
                  {m.ai_reasoning}
                </p>
              ) : (
                <p className="text-xs text-surface-500">No reasoning captured for this molecule.</p>
              )}
            </Section>
          )}

          {/* ── IQVIA context ── */}
          {m.context && (
            <Section title="Source Context" icon={<ShieldAlert className="w-4 h-4" />}>
              <p className="text-xs text-surface-600 leading-relaxed font-mono bg-white/60 rounded-xl p-3">
                {m.context}
              </p>
            </Section>
          )}

          {/* Not in IQVIA fallback */}
          {!m.in_iqvia && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-surface-100 border border-surface-300">
              <Minus className="w-4 h-4 text-surface-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-surface-600">Not found in UAE IQVIA data</p>
                <p className="text-xs text-surface-400 mt-1">
                  This molecule was extracted from the catalogue but has no UAE market data.
                  Score conservatively — maximum 4 per COMIX rules.
                </p>
              </div>
            </div>
          )}

          {/* Bottom padding */}
          <div className="h-4" />
        </div>
      </div>
    </>
  );
}
