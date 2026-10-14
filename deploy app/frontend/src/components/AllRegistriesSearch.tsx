"use client";

import { useEffect, useState } from "react";
import { Building2, FlaskConical, Loader2, Search, X } from "lucide-react";
import { api, type ExhibitorPortfolio, type RegistryCompany, type RegistryMolecule } from "@/lib/api";
import { RegistryHolders } from "@/components/RegistryHolders";
import { RegistryPortfolio } from "@/components/RegistryPortfolio";

const country = (c: string) => (c === "AE" ? "UAE" : c);
const molName = (k: string) => k.split("+").join(" + ");

type Picked =
  | { kind: "company"; id: number; name: string; wholeGroup: boolean }
  | { kind: "molecule"; key: string };

/** Search across every loaded registry: a company → its portfolio, or a molecule → the companies holding it. */
export function AllRegistriesSearch() {
  const [mode, setMode] = useState<"company" | "molecule">("company");
  const [query, setQuery] = useState("");
  const [companies, setCompanies] = useState<RegistryCompany[]>([]);
  const [molecules, setMolecules] = useState<RegistryMolecule[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [portfolio, setPortfolio] = useState<ExhibitorPortfolio | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setCompanies([]); setMolecules([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      const run = mode === "company"
        ? api.searchRegistryCompanies(q).then((r) => { if (!cancelled) setCompanies(r); })
        : api.searchRegistryMolecules(q).then((r) => { if (!cancelled) setMolecules(r); });
      run.catch(() => undefined).finally(() => { if (!cancelled) setSearching(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, mode]);

  useEffect(() => {
    if (picked?.kind !== "company") { setPortfolio(null); return; }
    let cancelled = false;
    setPortfolio(null); setError("");
    api.getCompanyPortfolio(picked.id, picked.wholeGroup)
      .then((d) => { if (!cancelled) setPortfolio(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [picked]);

  const choose = (p: Picked) => { setPicked(p); setOpen(false); setQuery(""); setExpanded(null); };
  const switchMode = (m: "company" | "molecule") => { setMode(m); setQuery(""); setPicked(null); setOpen(false); };

  return (
    <section className="mb-8 rounded-xl border border-surface-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-surface-900">Search all registries</h2>
        <div className="flex gap-1 rounded-lg bg-surface-100 p-1">
          {([["company", "By company", Building2], ["molecule", "By molecule", FlaskConical]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => switchMode(k)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm ${mode === k ? "bg-white font-medium text-surface-900 shadow-sm" : "text-surface-600"}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-surface-500">
          {mode === "company" ? "A company's portfolio across every registry, by therapy area." : "Every company holding a molecule, and the combinations it's in."}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
        <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={mode === "company" ? "Company, e.g. Adalvo" : "Molecule, e.g. amlodipine"}
          className="w-full rounded-xl border border-surface-300 bg-white py-2 pl-9 pr-9 text-sm focus:border-pharma-300 focus:outline-none" />
        {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-surface-400" />}
        {open && query.trim().length >= 2 && (
          <ul className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-surface-200 bg-white py-1 shadow-lg">
            {mode === "company" && companies.map((c) => (
              <li key={c.group_key}>
                <div className="flex items-center hover:bg-pharma-50">
                  <button type="button" onMouseDown={(e) => { e.preventDefault(); choose({ kind: "company", id: c.members[0].id, name: c.name, wholeGroup: true }); }}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-2 text-left text-sm">
                    <span className="truncate text-surface-900">{c.name}</span>
                    <span className="shrink-0 text-xs text-surface-500">{c.products.toLocaleString()} products · {c.countries.length} {c.countries.length === 1 ? "country" : "countries"}</span>
                  </button>
                  {c.members.length > 1 && (
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); setExpanded(expanded === c.group_key ? null : c.group_key); }}
                      className="shrink-0 px-3 py-2 text-xs font-medium text-pharma-900" title="Show the companies in this group">
                      {c.members.length} {expanded === c.group_key ? "▾" : "▸"}
                    </button>
                  )}
                </div>
                {expanded === c.group_key && (
                  <ul className="border-y border-surface-100 bg-surface-50">
                    {c.members.map((m) => (
                      <li key={m.id}>
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); choose({ kind: "company", id: m.id, name: m.name, wholeGroup: false }); }}
                          className="flex w-full justify-between gap-3 py-1.5 pl-8 pr-4 text-left text-xs hover:bg-pharma-50">
                          <span className="truncate text-surface-700">{m.name}</span>
                          <span className="shrink-0 text-surface-500">{m.products} · {m.countries.map(country).join(" ")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {mode === "molecule" && molecules.map((m) => (
              <li key={m.combo_key}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); choose({ kind: "molecule", key: m.combo_key }); }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-pharma-50">
                  <span className="truncate capitalize text-surface-900">{molName(m.combo_key)}</span>
                  <span className="shrink-0 text-xs text-surface-500">
                    {m.companies.toLocaleString()} companies · {m.countries} {m.countries === 1 ? "country" : "countries"}{m.in_uae ? " · in UAE" : ""}
                  </span>
                </button>
              </li>
            ))}
            {!searching && (mode === "company" ? !companies.length : !molecules.length) && (
              <li className="px-4 py-2 text-sm text-surface-500">Nothing found.</li>
            )}
          </ul>
        )}
      </div>

      {picked && (
        <div className="mt-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-semibold capitalize text-surface-900">
                {picked.kind === "company" ? (portfolio?.company?.name ?? picked.name) : molName(picked.key)}
              </h3>
              {picked.kind === "company" && portfolio?.company && (
                <p className="text-xs text-surface-500">
                  {portfolio.company.products.toLocaleString()} products · {portfolio.company.molecules.toLocaleString()} molecules · registered in{" "}
                  {portfolio.company.countries.map(country).join(", ")}
                  {portfolio.company.entities && portfolio.company.entities.length > 1 && (
                    <span title={portfolio.company.entities.join("\n")}> · whole group: {portfolio.company.entities.length} companies</span>
                  )}
                </p>
              )}
            </div>
            <button onClick={() => setPicked(null)} aria-label="Clear" className="rounded-lg p-1 text-surface-500 hover:bg-surface-100"><X className="h-4 w-4" /></button>
          </div>
          {picked.kind === "molecule" && <RegistryHolders molecule={picked.key} />}
          {picked.kind === "company" && error && <p className="text-sm text-rose-700">{error}</p>}
          {picked.kind === "company" && !portfolio && !error && (
            <p className="flex items-center gap-2 text-sm text-surface-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading portfolio…</p>
          )}
          {picked.kind === "company" && portfolio?.matched && <RegistryPortfolio data={portfolio} />}
        </div>
      )}
    </section>
  );
}
