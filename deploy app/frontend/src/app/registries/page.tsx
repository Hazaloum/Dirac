"use client";

import { useEffect, useState } from "react";
import { Database, ExternalLink, Loader2, Search } from "lucide-react";
import { api, type RegistryRow, type RegistrySearch, type RegistrySource } from "@/lib/api";
import { ddmmyy } from "@/lib/dates";
import { AllRegistriesSearch } from "@/components/AllRegistriesSearch";

const COUNTRY: Record<string, string> = {
  AE: "UAE", BE: "Belgium", BG: "Bulgaria", CZ: "Czechia", ES: "Spain", FR: "France", HU: "Hungary", IE: "Ireland",
  IT: "Italy", NL: "Netherlands", OM: "Oman", PL: "Poland", RO: "Romania", SE: "Sweden", SK: "Slovakia", US: "United States",
};
const PAGE = 50;

const molecules = (r: RegistryRow) => (r.combo_key ? r.combo_key.split("+").join(" + ") : r.molecule_raw || "—");

export default function RegistriesPage() {
  const [sources, setSources] = useState<RegistrySource[] | null>(null);
  const [registry, setRegistry] = useState("");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("active");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<RegistrySearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getRegistries().then((rows) => { setSources(rows); if (rows.length) setRegistry(rows[0].key); })
      .catch((err: Error) => setError(err.message));
  }, []);

  // debounce typing into the search term
  useEffect(() => {
    const t = setTimeout(() => { setTerm(query.trim()); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!registry) return;
    let cancelled = false;
    setLoading(true); setError("");
    api.searchRegistry(registry, term, status, offset, PAGE)
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [registry, term, status, offset]);

  const source = sources?.find((s) => s.key === registry);
  const total = result?.total ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Database className="h-7 w-7 text-pharma-700" />
        <h1 className="text-3xl font-semibold text-surface-900">Registries</h1>
      </div>

      <AllRegistriesSearch />

      <h2 className="mb-3 text-lg font-semibold text-surface-900">Browse one registry</h2>

      {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!sources && !error && <p className="text-surface-500">Loading registries…</p>}

      <div className="mb-6 flex flex-wrap gap-2">
        {sources?.map((s) => (
          <button key={s.key} onClick={() => { setRegistry(s.key); setOffset(0); }} aria-pressed={registry === s.key}
            className={`grid gap-0.5 rounded-xl border px-4 py-2 text-left transition-colors ${registry === s.key ? "border-pharma-700 bg-pharma-50" : "border-surface-300 bg-white hover:border-pharma-300"}`}>
            <span className="text-sm font-semibold text-surface-900">{COUNTRY[s.country] ?? s.country}</span>
            <span className="text-xs text-surface-500">{(s.row_count ?? 0).toLocaleString()} products</span>
            {s.snapshot_date && <span className="text-xs text-surface-400">updated {ddmmyy(s.snapshot_date)}</span>}
          </button>
        ))}
      </div>

      {source && (
        <>
          <p className="mb-4 text-xs text-surface-500">
            {source.name} · updated {ddmmyy(source.snapshot_date)}
            {source.company_field ? ` · company = ${source.company_field}` : ""}
            {source.source_url && (
              <> · <a href={source.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-pharma-700 hover:underline">source <ExternalLink className="h-3 w-3" /></a></>
            )}
          </p>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search product, company, molecule, ATC or registration number"
                className="w-full rounded-xl border border-surface-300 bg-white py-2.5 pl-9 pr-4 text-sm text-surface-900 focus:border-pharma-300 focus:outline-none" />
            </label>
            <div className="flex gap-1 rounded-lg bg-surface-100 p-1">
              {[["active", "Active"], ["withdrawn", "Withdrawn"], ["all", "All"]].map(([k, label]) => (
                <button key={k} onClick={() => { setStatus(k); setOffset(0); }}
                  className={`rounded-md px-3 py-1 text-xs ${status === k ? "bg-white font-medium text-surface-900 shadow-sm" : "text-surface-600"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between text-xs text-surface-500">
            <span className="flex items-center gap-2">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {total.toLocaleString()} {total === 1 ? "product" : "products"}
              {total > 0 && ` · showing ${(offset + 1).toLocaleString()}–${Math.min(offset + PAGE, total).toLocaleString()}`}
            </span>
            <span className="flex gap-2">
              <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(offset - PAGE, 0))}
                className="rounded-lg border border-surface-300 px-3 py-1 disabled:opacity-40">Previous</button>
              <button disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}
                className="rounded-lg border border-surface-300 px-3 py-1 disabled:opacity-40">Next</button>
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 text-left text-xs text-surface-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">Molecule</th>
                  <th className="px-3 py-2 font-medium">Strength / form</th>
                  <th className="px-3 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 font-medium">ATC</th>
                  <th className="px-3 py-2 font-medium">Reg. no.</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {result?.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 text-surface-900">{r.product_name}</td>
                    <td className="px-3 py-2 capitalize text-surface-800" title={r.molecule_raw ?? ""}>
                      {molecules(r)}
                      {!r.combo_key && r.molecule_raw && <span className="ml-1 text-[11px] normal-case text-amber-700">(unmatched)</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-surface-600">{[r.strength_raw, r.form_raw].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-surface-800">
                      {r.company_name || r.company_raw || "—"}
                      {r.company_name && r.company_raw && r.company_raw.toLowerCase() !== r.company_name.toLowerCase() && (
                        <span className="block text-[11px] text-surface-500">as {r.company_raw}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-surface-600">{r.atc || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-surface-600">{r.registration_no || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        r.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : r.status === "withdrawn" ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-surface-200 bg-surface-50 text-surface-600"}`}>
                        {r.status === "unknown" ? "listed" : r.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {result && !result.rows.length && !loading && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-surface-500">No products match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
