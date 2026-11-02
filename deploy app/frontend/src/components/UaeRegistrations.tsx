"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { api, type UaeRegistrationCompany } from "@/lib/api";

function fmtPrice(v: number | null) {
  return v == null ? "" : `AED ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** One UAE registry count in the molecule drawer (MOHAP holders / UPP manufacturers),
 *  with an Open button that lists the companies and their products. */
export function UaeRegistrationRow({ molecule, source, label, count }: {
  molecule: string;
  source: "mohap" | "upp";
  label: string;
  count: number | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<UaeRegistrationCompany[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const color =
    count == null ? "text-surface-800" :
    count <= 3 ? "text-emerald-700" :
    count <= 6 ? "text-amber-700" : "text-rose-700";

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || companies) return;
    setLoading(true); setError("");
    try {
      setCompanies((await api.getUaeRegistrations(molecule, source)).companies);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the list");
    } finally {
      setLoading(false);
    }
  }

  const products = companies?.reduce((s, c) => s + c.products.length, 0) ?? 0;

  return (
    <div className="border-b border-surface-200/40 py-2 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-surface-500">{label}</span>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${color}`}>{count == null ? "N/A" : count}</span>
          <button type="button" onClick={toggle} disabled={!count} aria-expanded={open}
            className="flex items-center gap-1 rounded-lg border border-surface-300 px-2 py-1 text-[11px] font-medium text-surface-700 hover:border-pharma-300 hover:bg-pharma-50 hover:text-pharma-900 disabled:cursor-not-allowed disabled:opacity-40">
            {open ? "Close" : "Open"}
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {loading && (
            <p className="flex items-center gap-2 text-xs text-surface-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading {source.toUpperCase()} list…
            </p>
          )}
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {companies && companies.length === 0 && (
            <p className="text-xs text-surface-500">No {source.toUpperCase()} products found.</p>
          )}
          {companies && companies.length > 0 && (
            <>
              <p className="text-[11px] text-surface-400">
                {companies.length} compan{companies.length === 1 ? "y" : "ies"} · {products} product{products === 1 ? "" : "s"}
                {source === "upp" ? " · active only" : ""}
              </p>
              {companies.map((c) => (
                <div key={c.company} className="rounded-lg border border-surface-200 bg-surface-50/60">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
                    <span className="text-xs font-semibold text-surface-900">{c.company}</span>
                    <span className="text-[11px] text-surface-500">
                      {c.products.length} product{c.products.length === 1 ? "" : "s"}
                      {c.agents.length > 0 && <> · agent {c.agents.join(", ")}</>}
                    </span>
                  </div>
                  <ul className="divide-y divide-surface-200/60 border-t border-surface-200/60">
                    {c.products.map((p, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[11px]">
                        <span className="min-w-0">
                          <span className="font-medium text-surface-800">{p.name || "—"}</span>
                          <span className="text-surface-500">
                            {[p.strength, p.form, p.pack && `pack ${p.pack}`].filter(Boolean).map((t) => ` · ${t}`).join("")}
                          </span>
                          {p.ingredient && <span className="block truncate text-surface-400">{p.ingredient}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-surface-600">{fmtPrice(p.price)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
