"use client";

import { useEffect, useState } from "react";
import { api, type MoleculeLineage } from "@/lib/api";

// Step fills deepen toward the molecule; the last step is the brand green.
const FILLS = ["#E1F5EE", "#B9E9D6", "#8ADBBD", "#4CC29A", "#0F6E56"];

function fmtM(v: number) {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(Math.round(v));
}

function fmtCagr(v: number | null) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function AtcCascade({ molecule }: { molecule: string }) {
  const [lineage, setLineage] = useState<MoleculeLineage | null>(null);

  useEffect(() => {
    setLineage(null);
    api.getMoleculeLineage(molecule)
      .then((data) => setLineage(data.found ? data : null))
      .catch(() => setLineage(null));
  }, [molecule]);

  if (!lineage || !lineage.levels.length) return null;

  const steps = [
    ...lineage.levels.map((lv) => ({
      tag: lv.level,
      code: lv.code,
      name: lv.name,
      value: lv.value,
      cagr: lv.cagr_pct,
      rank: lv.rank,
      count: lv.molecule_count,
      kept: lv.child_share_pct,
    })),
    {
      tag: "MOL",
      code: "",
      name: lineage.molecule,
      value: lineage.molecule_value,
      cagr: lineage.molecule_cagr_pct,
      rank: null,
      count: null,
      kept: null,
    },
  ];

  // Log scale — a linear axis would flatten every step after ATC1.
  const logs = steps.map((s) => Math.log10(Math.max(s.value, 1)));
  const maxLog = Math.max(...logs);
  const minLog = Math.min(...logs);
  const heightPct = (v: number) => {
    if (maxLog === minLog) return 100;
    return 18 + ((Math.log10(Math.max(v, 1)) - minLog) / (maxLog - minLog)) * 82;
  };

  return (
    <div className="flex min-w-0 flex-col">
      <p className="matthew-eyebrow mb-3">Class position · {lineage.year}</p>
      <div className="flex h-40 items-end">
        {steps.map((s, i) => {
          const isMolecule = i === steps.length - 1;
          return (
            <div key={s.tag} className="flex h-full min-w-0 flex-1 flex-col justify-end px-1">
              <p className="mb-1 truncate text-center text-[11px] font-semibold leading-tight text-surface-800">
                {isMolecule ? "AED " : ""}{fmtM(s.value)}
                <span className={`ml-1 font-medium ${s.cagr != null && s.cagr < 10 ? "text-amber-700" : "text-emerald-700"}`}>{fmtCagr(s.cagr)}</span>
              </p>
              <div className="relative rounded-t-md" style={{ height: `${heightPct(s.value)}%`, background: FILLS[i] }}>
                {s.kept != null && (
                  <span className="absolute -right-3 top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-full border border-surface-200 bg-white px-1.5 py-px text-[9px] font-medium text-surface-500">
                    {s.kept}% →
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex">
        {steps.map((s, i) => {
          const isMolecule = i === steps.length - 1;
          return (
            <div key={s.tag} className="min-w-0 flex-1 px-1 text-center">
              <p className="font-mono text-[8px] uppercase tracking-[.06em] text-surface-400">
                {s.tag}{s.code ? ` · ${s.code}` : ""}
              </p>
              <p className="mt-0.5 truncate text-[10px] font-semibold leading-tight text-surface-800" title={s.name}>
                {s.name}
              </p>
              {s.rank != null && s.count != null ? (
                <p className={`mt-0.5 text-[9px] font-semibold ${s.rank === 1 ? "text-emerald-700" : "text-surface-400"}`}>
                  #{s.rank} of {s.count}
                </p>
              ) : (
                <p className="mt-0.5 text-[9px] text-surface-400">{isMolecule ? "this molecule" : ""}</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-surface-400">Bar height is log-scaled · % is how much of each level the next one keeps</p>
    </div>
  );
}
