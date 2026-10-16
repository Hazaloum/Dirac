"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChevronDown,
  FlaskConical,
  Handshake,
  Loader2,
  Radar,
  Search as SearchIcon,
  Sparkles,
  X,
} from "lucide-react";
import { MoleculeDashboard, VerdictStrip } from "@/components/MoleculeDashboard";
import { MoleculeDrawer } from "@/components/MoleculeDrawer";
import { api, type MoleculeCard, type MoleculeProfile, type MoleculeSlices, type ProfileCompany } from "@/lib/api";

const shortcuts = [
  { href: "/analysis", icon: BookOpenText, title: "Evaluate a Catalogue", blurb: "Upload a supplier list and score every molecule" },
  { href: "/deal-tracker", icon: Handshake, title: "Track Deals", blurb: "Every shortlisted molecule, stage by stage" },
  { href: "/forecast", icon: ChartNoAxesCombined, title: "Build a Forecast", blurb: "Y1–Y3 units and revenue per pack" },
  { href: "/portfolio", icon: BriefcaseBusiness, title: "Evaluate a Portfolio", blurb: "Open and manage your saved portfolio" },
  { href: "/outreach", icon: Radar, title: "Find Manufacturers", blurb: "Source partners and BD contacts by country" },
];

function fmtAed(v: number) {
  if (v >= 1_000_000_000) return `AED ${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `AED ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `AED ${(v / 1_000).toFixed(0)}K`;
  return `AED ${Math.round(v)}`;
}

function fmtUnits(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M packs`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k packs`;
  return `${Math.round(v)} packs`;
}

const fmtCagr = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

// Manufacturer, with the parent corporation when it's a different name (Janssen · Johnson & Johnson).
function Company({ c }: { c: ProfileCompany }) {
  const mfr = c.manufacturer ?? "";
  const corp = c.corporation ?? "";
  const same = !corp || mfr.toLowerCase().startsWith(corp.toLowerCase()) || corp.toLowerCase().startsWith(mfr.toLowerCase());
  return (
    <>
      {mfr || corp}
      {!same && <span className="text-surface-400"> · {corp}</span>}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-surface-500">{label}</dt>
      <dd className="min-w-0 text-surface-900">{children}</dd>
    </>
  );
}

function MoleculeFacts({ p }: { p: MoleculeProfile }) {
  return (
    <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
      <Row label="Leading brand">
        {p.leading_brand ? <>{p.leading_brand.product} <span className="text-surface-500">— <Company c={p.leading_brand} /></span></> : "—"}
      </Row>
      <Row label="First launch">
        {p.first_launch ? <>{p.first_launch.date} <span className="text-surface-500">· {p.first_launch.product}</span></> : "—"}
      </Row>
      <Row label="First generic">
        {p.first_generic
          ? <>{p.first_generic.product} <span className="text-surface-500">— <Company c={p.first_generic} /> · {p.first_generic.date}</span></>
          : <span className="text-surface-500">No generic yet</span>}
      </Row>
    </dl>
  );
}

function MarketFacts({ p }: { p: MoleculeProfile }) {
  const m = p.market;
  const split = (pct: number | null) => (pct == null ? "—" : `${Math.round(pct)}% / ${Math.round(100 - pct)}%`);
  const since = m.value_cagr_since ?? m.units_cagr_since;
  return (
    <div>
      <p className="matthew-eyebrow mb-3 text-surface-500">Market · UAE {m.end_year}</p>
      <dl className="grid grid-cols-[170px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm">
        <Row label="Market value">{fmtAed(m.value)} <span className="text-surface-500">· CAGR {fmtCagr(m.value_cagr)}</span></Row>
        <Row label="Units">{fmtUnits(m.units)} <span className="text-surface-500">· CAGR {fmtCagr(m.units_cagr)}</span></Row>
        <Row label="Private / LPO by value">{split(m.private_value_pct)}</Row>
        <Row label="Private / LPO by units">{split(m.private_units_pct)}</Row>
      </dl>
      <p className="mt-3 text-[11px] text-surface-400">
        UAE IQVIA · CAGR {since ?? ""}–{m.end_year} · launch dates are month-level
      </p>
    </div>
  );
}

export default function SearchPage() {
  const [allMolecules, setAllMolecules] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<MoleculeCard | null>(null);
  const [slices, setSlices] = useState<MoleculeSlices | null>(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [drawerMolecule, setDrawerMolecule] = useState<MoleculeCard | null>(null);

  useEffect(() => {
    api.getMolecules()
      .then((data) => setAllMolecules(data.molecules))
      .catch(() => setError("The IQVIA molecule list could not be loaded."))
      .finally(() => setListLoading(false));
  }, []);

  const suggestions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return allMolecules
      .filter((molecule) => molecule.toLowerCase().includes(normalized))
      .slice(0, 8);
  }, [allMolecules, query]);

  const submitSearch = async (event?: FormEvent, moleculeOverride?: string) => {
    event?.preventDefault();
    const submittedQuery = moleculeOverride ?? query;
    const normalized = submittedQuery.trim().toLowerCase();
    if (!normalized) {
      setError("Type a molecule name to search.");
      return;
    }

    const exact = allMolecules.find((molecule) => molecule.toLowerCase() === normalized);
    const molecule = exact ?? suggestions[0];
    if (!molecule) {
      setResult(null);
      setError(`No IQVIA molecule matches “${submittedQuery.trim()}”.`);
      return;
    }

    setQuery(molecule);
    setShowSuggestions(false);
    setError("");
    setLoading(true);
    try {
      const [response, trend] = await Promise.all([
        api.enrichMolecules([molecule], molecule),
        api.getMoleculeTrend(molecule).catch(() => null),
      ]);
      const match = response.molecules.find((item) => item.molecule.toUpperCase() === molecule.toUpperCase());
      if (!match) throw new Error("No market record was returned for that molecule.");
      setSlices(trend?.found ? trend : null);
      setResult(match);
    } catch (searchError: unknown) {
      setResult(null);
      setError(searchError instanceof Error ? searchError.message : "The molecule search failed.");
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setResult(null);
    setSlices(null);
    setError("");
    setShowSuggestions(false);
  };


  return (
    <div className={`min-h-[calc(100vh-86px)] px-5 py-8 sm:px-8 lg:px-12 ${result ? "pb-16" : "flex items-center"}`}>
      <div className="mx-auto w-full max-w-6xl">
        <section className={result ? "mb-10" : "text-center"}>
          <div className={result ? "" : "mx-auto max-w-2xl"}>
            <p className="matthew-eyebrow text-pharma-900">IQVIA molecule intelligence</p>
            <h1 className={`mt-4 font-serif font-medium tracking-[-0.045em] text-surface-900 ${result ? "text-4xl sm:text-5xl" : "text-5xl sm:text-6xl lg:text-7xl"}`}>
              Search the market.
            </h1>
            {!result && (
              <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-surface-600 sm:text-base">
                One molecule at a time. Search the IQVIA catalogue and get the UAE market evidence you need in seconds.
              </p>
            )}
          </div>

          <form onSubmit={submitSearch} className={`relative ${result ? "mt-6 max-w-3xl" : "mx-auto mt-10 max-w-3xl"}`}>
            <div className={`flex items-center gap-3 rounded-2xl border bg-white p-2 shadow-[0_15px_50px_rgba(20,33,29,.10)] transition-all focus-within:border-pharma-400 focus-within:shadow-[0_18px_60px_rgba(12,92,76,.14)] ${showSuggestions ? "border-pharma-300" : "border-surface-200"}`}>
              <SearchIcon className="ml-4 h-5 w-5 shrink-0 text-pharma-900" aria-hidden="true" />
              <input
                aria-label="Search IQVIA molecules"
                autoComplete="off"
                autoFocus={!result}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setShowSuggestions(true); setError(""); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => window.setTimeout(() => setShowSuggestions(false), 140)}
                placeholder={listLoading ? "Loading IQVIA molecules..." : "Search a molecule, e.g. METFORMIN"}
                className="min-w-0 flex-1 bg-transparent px-1 py-4 text-base text-surface-900 outline-none placeholder:text-surface-400 sm:text-lg"
              />
              {query && (
                <button type="button" onClick={clearSearch} className="rounded-lg p-2 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-700" aria-label="Clear search">
                  <X className="h-4 w-4" />
                </button>
              )}
              <button type="submit" disabled={loading || !query.trim()} className="flex shrink-0 items-center gap-2 rounded-xl bg-pharma-900 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-pharma-800 disabled:cursor-not-allowed disabled:opacity-45 sm:px-5">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                <span className="hidden sm:inline">{loading ? "Looking up" : "Search"}</span>
              </button>
            </div>

            {showSuggestions && query.trim() && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-surface-200 bg-white text-left shadow-xl">
                <p className="border-b border-surface-100 px-4 py-2.5 font-mono text-[9px] uppercase tracking-[.12em] text-surface-400">IQVIA molecule matches</p>
                {suggestions.map((molecule) => (
                  <button key={molecule} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void submitSearch(undefined, molecule)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm text-surface-700 transition-colors hover:bg-pharma-50 hover:text-pharma-900">
                    <span className="truncate">{molecule}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 -rotate-90 text-surface-300" />
                  </button>
                ))}
              </div>
            )}
          </form>

          {!result && !error && (
            <div className="mt-6 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[.11em] text-surface-400">
              <Sparkles className="h-3.5 w-3.5 text-pharma-900" />
              <span>{allMolecules.length ? `${allMolecules.length.toLocaleString()} IQVIA molecule combinations` : "UAE market evidence"}</span>
            </div>
          )}

          {error && <p role="alert" className="mt-4 text-center text-sm text-rose-700">{error}</p>}

          {!result && (
            <div className="mx-auto mt-9 max-w-3xl">
              <p className="matthew-eyebrow mb-3 text-center">Or start a workflow</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {shortcuts.map(({ href, icon: Icon, title, blurb }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex aspect-square flex-col justify-between rounded-2xl border border-surface-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-pharma-300 hover:shadow-[0_14px_34px_rgba(20,33,29,.10)]"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-pharma-50 text-pharma-900 transition-colors group-hover:bg-pharma-900 group-hover:text-white">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-[13px] font-semibold leading-tight text-surface-900">{title}</span>
                      <span className="mt-1.5 block text-[10px] leading-snug text-surface-500">{blurb}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        {result && (
          <section className="animate-slide-up space-y-5">
            <div className="grid gap-8 rounded-2xl border border-surface-200 bg-white p-6 shadow-sm sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
              <div className="flex min-w-0 flex-col">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="matthew-eyebrow text-pharma-900">Molecule brief</span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[.08em] text-emerald-700">IQVIA matched</span>
                </div>
                <h2 className="mt-3 font-serif text-4xl font-medium tracking-[-.04em] text-surface-900 sm:text-5xl">{result.molecule}</h2>
                <p className="mt-2 text-sm text-surface-500">
                  {result.atc4_class || result.atc3_class || "UAE pharmaceutical market"}
                </p>
                {slices?.profile && (
                  <div className="mt-5">
                    <MoleculeFacts p={slices.profile} />
                  </div>
                )}
                <div className="mt-5">
                  <VerdictStrip molecule={result} />
                </div>
                <div className="mt-auto pt-5">
                  <button type="button" onClick={() => setDrawerMolecule(result)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-surface-300 px-4 py-2.5 text-sm font-semibold text-surface-700 transition-colors hover:border-pharma-300 hover:bg-pharma-50 hover:text-pharma-900">
                    <FlaskConical className="h-4 w-4" /> Open full molecule view
                  </button>
                </div>
              </div>
              {slices?.profile && <MarketFacts p={slices.profile} />}
            </div>

            <MoleculeDashboard molecule={result} slices={slices} />

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pharma-200 bg-pharma-50/70 px-5 py-4 text-sm text-pharma-950">
              <span>One-time lookup complete. No portfolio or scoring workflow was started.</span>
              <button type="button" onClick={clearSearch} className="font-semibold underline decoration-pharma-300 underline-offset-4 hover:text-pharma-700">Search another molecule</button>
            </div>
          </section>
        )}
      </div>

      <MoleculeDrawer molecule={drawerMolecule} isTop5={false} onClose={() => setDrawerMolecule(null)} />
    </div>
  );
}
