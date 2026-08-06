"use client";

import {
  AlertTriangle, BarChart2, Building2, Check,
} from "lucide-react";
import { MarketBreakdownChart } from "@/components/MarketBreakdownChart";
import type { MoleculeCard } from "@/lib/api";

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

export function VerdictStrip({ molecule }: { molecule: MoleculeCard }) {
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

// ─── Building blocks ──────────────────────────────────────────────────────────

function Panel({ title, icon, children }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-surface-200 bg-white p-6 sm:p-7">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-pharma-50 text-pharma-900">{icon}</span>
        <h2 className="font-serif text-xl font-medium tracking-tight text-surface-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
// The molecule's front page: trajectory → competitors → channel → context.

export function MoleculeDashboard({ molecule: m }: { molecule: MoleculeCard }) {
  const registeredNotSelling =
    m.mohap_manufacturers != null && m.num_competitors != null
      ? Math.max(0, m.mohap_manufacturers - m.num_competitors)
      : null;

  return (
    <div className="space-y-5">
      {m.in_iqvia && (
        <Panel title="Market breakdown" icon={<BarChart2 className="h-4 w-4" />}>
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
          <MarketBreakdownChart molecule={m.molecule} />
        </Panel>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Registration pressure" icon={<Building2 className="h-4 w-4" />}>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-surface-50 p-3.5 text-center">
              <p className="text-[10px] uppercase tracking-wider text-surface-400">Selling (IQVIA)</p>
              <p className="mt-1.5 font-serif text-2xl text-surface-900">{m.num_competitors ?? "—"}</p>
            </div>
            <div className="rounded-xl bg-surface-50 p-3.5 text-center">
              <p className="text-[10px] uppercase tracking-wider text-surface-400">MOHAP holders</p>
              <p className="mt-1.5 font-serif text-2xl text-surface-900">{m.mohap_manufacturers ?? "—"}</p>
            </div>
            <div className="rounded-xl bg-surface-50 p-3.5 text-center">
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
        </Panel>
      </div>
    </div>
  );
}
