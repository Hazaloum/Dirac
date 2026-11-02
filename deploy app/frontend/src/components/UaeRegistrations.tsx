"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, X } from "lucide-react";
import { api, type UaeRegistrationCompany } from "@/lib/api";

type Source = "mohap" | "upp";

const TITLES: Record<Source, string> = { mohap: "MOHAP holders", upp: "UPP registered" };

function fmtPrice(v: number | null) {
  return v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Pop-up listing the companies behind a MOHAP / UPP count, with their products. */
export function UaeRegistrationsModal({ molecule, source, onClose }: {
  molecule: string;
  source: Source;
  onClose: () => void;
}) {
  const [companies, setCompanies] = useState<UaeRegistrationCompany[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    api.getUaeRegistrations(molecule, source)
      .then((r) => live && setCompanies(r.companies))
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [molecule, source]);

  // Escape closes only the pop-up, not the molecule drawer underneath (caught first, then stopped)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // A company stays when its name, agent or any product matches; then only matching products show
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!companies || !q) return companies;
    return companies.flatMap((c) => {
      if (c.company.toLowerCase().includes(q) || c.agents.some((a) => a.toLowerCase().includes(q))) return [c];
      const products = c.products.filter((p) =>
        [p.name, p.ingredient, p.strength, p.form].some((t) => t.toLowerCase().includes(q)));
      return products.length ? [{ ...c, products }] : [];
    });
  }, [companies, filter]);

  const products = companies?.reduce((s, c) => s + c.products.length, 0) ?? 0;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-12" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${TITLES[source]} — ${molecule}`} onClick={(ev) => ev.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-surface-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-surface-900">{TITLES[source]} — {molecule}</h2>
            <p className="text-xs text-surface-500">
              {companies
                ? <>{companies.length} compan{companies.length === 1 ? "y" : "ies"} · {products} product{products === 1 ? "" : "s"}
                    {source === "upp" ? " · active UPP products only" : " · MOHAP price list"}</>
                : "Loading…"}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-surface-500 hover:bg-surface-100"><X className="h-5 w-5" /></button>
        </div>

        {companies && companies.length > 0 && (
          <div className="border-b border-surface-200 px-5 py-3">
            <label className="flex items-center gap-2 rounded-lg border border-surface-300 bg-white px-3 py-1.5 focus-within:border-pharma-400">
              <Search className="h-3.5 w-3.5 text-surface-400" aria-hidden="true" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter companies and products"
                placeholder="Filter by company, agent or product" className="w-full bg-transparent text-sm outline-none" />
            </label>
          </div>
        )}

        <div className="overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {!companies && !error && (
            <p className="flex items-center gap-2 text-sm text-surface-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading {TITLES[source]}…</p>
          )}
          {companies && companies.length === 0 && <p className="text-sm text-surface-500">No products found.</p>}
          {shown && shown.length === 0 && companies && companies.length > 0 && (
            <p className="text-sm text-surface-500">Nothing matches “{filter.trim()}”.</p>
          )}
          {shown && shown.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-[10px] uppercase tracking-wider text-surface-500">
                  <th className="py-2 pr-3 font-semibold">Product</th>
                  <th className="py-2 pr-3 font-semibold">Strength</th>
                  <th className="py-2 pr-3 font-semibold">Form</th>
                  <th className="py-2 pr-3 font-semibold">Pack</th>
                  <th className="py-2 text-right font-semibold">Public price (AED)</th>
                </tr>
              </thead>
              {shown.map((c) => (
                <tbody key={c.company} className="border-t border-surface-200">
                  <tr className="bg-surface-50">
                    <td colSpan={5} className="px-2 py-2">
                      <span className="font-semibold text-surface-900">{c.company}</span>
                      <span className="text-surface-500">
                        {" "}· {c.products.length} product{c.products.length === 1 ? "" : "s"}
                        {c.agents.length > 0 && <> · agent {c.agents.join(", ")}</>}
                      </span>
                    </td>
                  </tr>
                  {c.products.map((p, i) => (
                    <tr key={i} className="border-t border-surface-100 align-top">
                      <td className="py-1.5 pl-2 pr-3">
                        <span className="font-medium text-surface-800">{p.name || "—"}</span>
                        {p.ingredient && <span className="block text-[11px] text-surface-400">{p.ingredient}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-surface-700">{p.strength || "—"}</td>
                      <td className="py-1.5 pr-3 text-surface-700">{p.form || "—"}</td>
                      <td className="py-1.5 pr-3 text-surface-700">{p.pack || "—"}</td>
                      <td className="py-1.5 text-right tabular-nums text-surface-700">{fmtPrice(p.price)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** "Open" button that shows the MOHAP / UPP pop-up; disabled when the count is 0. */
export function OpenRegistrations({ molecule, source, count, className = "" }: {
  molecule: string;
  source: Source;
  count: number | null | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={!count}
        aria-label={`Open ${TITLES[source]} list`}
        className={`rounded-lg border border-surface-300 bg-white px-2 py-0.5 text-[11px] font-medium text-surface-700 hover:border-pharma-300 hover:bg-pharma-50 hover:text-pharma-900 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
        Open
      </button>
      {open && <UaeRegistrationsModal molecule={molecule} source={source} onClose={() => setOpen(false)} />}
    </>
  );
}

/** One UAE registry count in the molecule drawer, with its Open button. */
export function UaeRegistrationRow({ molecule, source, label, count }: {
  molecule: string;
  source: Source;
  label: string;
  count: number | null | undefined;
}) {
  const color =
    count == null ? "text-surface-800" :
    count <= 3 ? "text-emerald-700" :
    count <= 6 ? "text-amber-700" : "text-rose-700";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-surface-200/40 py-2 last:border-0">
      <span className="text-xs text-surface-500">{label}</span>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium ${color}`}>{count == null ? "N/A" : count}</span>
        <OpenRegistrations molecule={molecule} source={source} count={count} />
      </div>
    </div>
  );
}
