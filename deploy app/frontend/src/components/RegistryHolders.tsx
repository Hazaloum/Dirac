"use client";

import { useEffect, useState } from "react";
import { api, type MoleculeHolders } from "@/lib/api";

// ─── Registry holders: companies with a registration for this molecule ───────

export function RegistryHolders({ molecule }: { molecule: string }) {
  const [data, setData] = useState<MoleculeHolders | null>(null);
  const [error, setError] = useState(false);
  const [notUae, setNotUae] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState<"exact" | "combination">("exact");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(false); setShowAll(false); setTab("exact"); setOpen(null);
    api.getMoleculeHolders(molecule)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [molecule]);

  if (error) return <p className="text-xs text-rose-700">Could not load registry holders.</p>;
  if (!data) return <p className="text-xs text-surface-500">Loading…</p>;
  if (!data.combo_key) return <p className="text-xs text-surface-500">This molecule isn&apos;t matched in the master registry yet.</p>;
  if (!data.companies.length && !data.combination_companies.length)
    return <p className="text-xs text-surface-500">No company holds an active registration for it in the loaded registries.</p>;

  const source = tab === "exact" ? data.companies : data.combination_companies;
  const list = source.filter((c) => !notUae || !c.in_uae);
  const shown = showAll ? list : list.slice(0, 12);
  return (
    <div className="space-y-3">
      <p className="text-xs text-surface-600">
        <span className="font-semibold text-surface-800">{data.companies.length}</span> company groups across{" "}
        <span className="font-semibold text-surface-800">{data.countries.length}</span> registries ·{" "}
        <span className="font-semibold text-surface-800">{data.in_uae}</span> registered in the UAE
      </p>
      <div className="flex gap-1 p-1 bg-surface-100 rounded-lg w-fit">
        {([["exact", `This molecule (${data.companies.length})`], ["combination", `In combinations (${data.combination_companies.length})`]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setShowAll(false); }}
            className={`text-xs px-3 py-1 rounded-md ${tab === k ? "bg-white shadow-sm text-surface-900 font-medium" : "text-surface-600"}`}>
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-surface-700 cursor-pointer">
        <input type="checkbox" checked={notUae} onChange={(e) => setNotUae(e.target.checked)} />
        Not registered in the UAE only
      </label>
      <ul className="divide-y divide-surface-200">
        {shown.map((c) => {
          const many = c.members.length > 1;
          return (
            <li key={c.group_key} className="py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-surface-900 truncate" title={c.product_names.join(", ")}>{c.name}</p>
                  {c.combos?.length ? <p className="text-xs text-surface-700 capitalize">{c.combos.join(" · ")}</p> : null}
                  <p className="text-xs text-surface-500">
                    {c.countries.join(" · ")} · {c.products} product{c.products === 1 ? "" : "s"}
                    {many && (
                      <>
                        {" · "}
                        <button type="button" onClick={() => setOpen(open === c.group_key ? null : c.group_key)}
                          className="text-pharma-900 font-medium">
                          {c.members.length} companies {open === c.group_key ? "▾" : "▸"}
                        </button>
                      </>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${
                  c.in_uae ? "bg-surface-100 text-surface-600 border-surface-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                  {c.in_uae ? "In UAE" : "Not in UAE"}
                </span>
              </div>
              {many && open === c.group_key && (
                <ul className="mt-1.5 ml-3 border-l border-surface-200 pl-3 space-y-1">
                  {c.members.map((m) => (
                    <li key={m.company_id} className="text-xs text-surface-600 flex justify-between gap-3">
                      <span className="truncate">{m.name}</span>
                      <span className="shrink-0 text-surface-500">{m.countries.join(" · ")} · {m.products}{m.in_uae ? " · UAE" : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {list.length > 12 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-pharma-900 font-medium">
          {showAll ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

