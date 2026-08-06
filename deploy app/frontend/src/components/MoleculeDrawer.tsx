"use client";

import { useEffect } from "react";
import {
  X, Users, Building2,
  FlaskConical, Star, Activity, BarChart2, Layers,
  ShieldCheck, Minus, Check, AlertTriangle,
} from "lucide-react";
import { MoleculeTrendPanels } from "@/components/MoleculeTrendPanels";
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, icon, children }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-50 border border-surface-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-1.5 rounded-lg bg-pharma-50 text-pharma-900">{icon}</div>
        <h3 className="text-sm font-semibold text-surface-800">{title}</h3>
      </div>
      {children}
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

// ─── Verdict strip ────────────────────────────────────────────────────────────
// The COMIX decision rules, evaluated visibly. Same thresholds as the scoring
// prompt's hard disqualifiers — keep in sync with prompts/prompt_scoring.txt.

type Verdict = { label: string; pass: boolean; hard?: boolean };

function buildVerdicts(m: MoleculeCard): Verdict[] {
  const verdicts: Verdict[] = [];
  if (m.num_competitors != null) {
    verdicts.push({
      label: `${m.num_competitors} competitors ${m.num_competitors > 10 ? "> 10 — disqualifier" : "≤ 10"}`,
      pass: m.num_competitors <= 10,
      hard: true,
    });
  }
  if (m.market_value_aed != null && m.value_cagr_pct != null) {
    const small = m.market_value_aed < 5_000_000;
    const slow = m.value_cagr_pct < 10;
    verdicts.push({
      label: small && slow
        ? "< 5M AED and < 10% CAGR — disqualifier"
        : `${fmtAed(m.market_value_aed)} · ${fmtPct(m.value_cagr_pct, true)} CAGR`,
      pass: !(small && slow),
      hard: true,
    });
  }
  if (m.private_pct != null) {
    verdicts.push({
      label: `private ${m.private_pct.toFixed(0)}% ${m.private_pct >= 60 ? "≥" : "<"} 60% target`,
      pass: m.private_pct >= 60,
    });
  }
  if (m.top3_company_share != null) {
    verdicts.push({
      label: `top-3 hold ${m.top3_company_share.toFixed(0)}% ${m.top3_company_share > 80 ? "— concentrated" : ""}`.trim(),
      pass: m.top3_company_share <= 80,
    });
  }
  return verdicts;
}

function VerdictStrip({ molecule }: { molecule: MoleculeCard }) {
  const verdicts = buildVerdicts(molecule);
  if (!verdicts.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {verdicts.map((v) => (
        <span
          key={v.label}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
            v.pass
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : v.hard
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {v.pass ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {v.label}
        </span>
      ))}
    </div>
  );
}

// ─── Class context ────────────────────────────────────────────────────────────

function ClassRow({ name, valueAed, cagr, rank, pct }: {
  name: string;
  valueAed?: number;
  cagr?: number;
  rank?: string;
  pct?: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 border-b border-surface-200/40 last:border-0">
      <span className="min-w-0 flex-1 truncate text-xs text-surface-600">{name}</span>
      <span className="flex items-baseline gap-3 font-mono text-[11px] text-surface-500">
        <span>{fmtAed(valueAed)}</span>
        <span className={cagr != null && cagr < 0 ? "text-rose-700" : "text-emerald-700"}>{fmtPct(cagr, true)}</span>
        {rank && <span className="font-sans text-xs font-semibold text-surface-800">rank {rank}</span>}
        {pct != null && <span>{pct.toFixed(0)}% of class</span>}
      </span>
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

  const registeredNotSelling =
    m.mohap_manufacturers != null && m.num_competitors != null
      ? Math.max(0, m.mohap_manufacturers - m.num_competitors)
      : null;

  return (
    <>
      {/* Backdrop — above the floating nav pill (z-60) */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70]"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-white border-l border-surface-200 z-[80] flex flex-col shadow-2xl overflow-hidden animate-slide-in-right">

        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-surface-200/60 shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className="p-1.5 rounded-lg bg-pharma-50 text-pharma-900">
                <FlaskConical className="w-4 h-4" />
              </div>
              {isTop5 && (
                <div className="w-6 h-6 bg-amber-400 rounded-full flex items-center justify-center ring-2 ring-surface-50 shrink-0">
                  <Star className="w-3.5 h-3.5 text-amber-950 fill-amber-950" />
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
            {m.in_iqvia && (
              <div className="mt-3">
                <VerdictStrip molecule={m} />
              </div>
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

          {/* ── Trend panels: trajectory → competitors → channel ── */}
          {m.in_iqvia && (
            <MoleculeTrendPanels
              molecule={m.molecule}
              render={({ trajectory, competitors, channel }) => (
                <>
                  <Section title="Market Trajectory" icon={<Activity className="w-4 h-4" />}>
                    {trajectory}
                  </Section>
                  <Section title="Competitive Structure" icon={<Users className="w-4 h-4" />}>
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-xs text-surface-500">
                      <span>
                        Leader <strong className="text-surface-800">{m.market_leader ?? "N/A"}</strong>
                        {m.leader_share_pct != null && ` · ${m.leader_share_pct.toFixed(1)}%`}
                        {m.leader_share_change != null && (
                          <span className={m.leader_share_change < 0 ? "text-emerald-700" : "text-surface-500"}>
                            {" "}({fmtPct(m.leader_share_change, true)} share)
                          </span>
                        )}
                      </span>
                      {m.top3_company_share != null && <span>Top 3 hold {m.top3_company_share.toFixed(1)}%</span>}
                    </div>
                    {competitors}
                  </Section>
                  <Section title="Route to Market" icon={<BarChart2 className="w-4 h-4" />}>
                    {channel}
                  </Section>
                </>
              )}
            />
          )}

          {/* ── Class context ── */}
          {m.in_iqvia && (m.atc4_class || m.atc3_class) && (
            <Section title="Class Context" icon={<Layers className="w-4 h-4" />}>
              {m.atc4_class && (
                <ClassRow
                  name={m.atc4_class}
                  valueAed={m.atc4_class_value_aed}
                  cagr={m.atc4_class_cagr}
                  rank={m.atc4_value_rank}
                  pct={m.atc4_value_pct}
                />
              )}
              {m.atc3_class && (
                <ClassRow
                  name={m.atc3_class}
                  valueAed={m.atc3_class_value_aed}
                  cagr={m.atc3_class_cagr}
                  rank={m.atc3_value_rank}
                  pct={m.atc3_value_pct}
                />
              )}
              {m.atc1_class && (
                <p className="mt-2 text-[11px] text-surface-400">{m.atc1_class}</p>
              )}
            </Section>
          )}

          {/* ── Registration pressure ── */}
          <Section title="Registration Pressure" icon={<Building2 className="w-4 h-4" />}>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-white/60 p-3.5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-surface-400">Selling (IQVIA)</p>
                <p className="mt-1.5 font-serif text-2xl text-surface-900">{m.num_competitors ?? "—"}</p>
              </div>
              <div className="rounded-xl bg-white/60 p-3.5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-surface-400">MOHAP holders</p>
                <p className="mt-1.5 font-serif text-2xl text-surface-900">{m.mohap_manufacturers ?? "—"}</p>
              </div>
              <div className="rounded-xl bg-white/60 p-3.5 text-center">
                <p className="text-[10px] uppercase tracking-wider text-surface-400">UPP registered</p>
                <p className="mt-1.5 font-serif text-2xl text-surface-900">{m.upp_manufacturers ?? "—"}</p>
              </div>
            </div>
            {registeredNotSelling != null && registeredNotSelling > 0 && (
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {registeredNotSelling} registered holder{registeredNotSelling === 1 ? "" : "s"} not yet selling —
                potential entrants already through MOHAP.
              </p>
            )}
          </Section>

          {/* ── AI Score & Reasoning ── */}
          {m.ai_score != null && (
            <Section title="AI Scoring" icon={<ShieldCheck className="w-4 h-4" />}>
              <div className="flex items-center gap-4 mb-4">
                <ScoreBadge score={m.ai_score} />
                <div className="flex-1 bg-white/60 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      m.ai_score >= 8 ? "bg-emerald-500" :
                      m.ai_score >= 6 ? "bg-pharma-900" :
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
