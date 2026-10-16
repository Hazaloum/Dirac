"use client";

import {
  AlertTriangle, BarChart2, Building2,
} from "lucide-react";
import { MarketBreakdownChart } from "@/components/MarketBreakdownChart";
import type { MoleculeCard, MoleculeSlices } from "@/lib/api";

function fmtPct(v?: number | null, showSign = false) {
  if (v == null) return "N/A";
  return `${showSign && v > 0 ? "+" : ""}${v.toFixed(1)}%`;
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

export function MoleculeDashboard({ molecule: m, slices }: { molecule: MoleculeCard; slices?: MoleculeSlices | null }) {
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
          <MarketBreakdownChart molecule={m.molecule} initial={slices} />
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
