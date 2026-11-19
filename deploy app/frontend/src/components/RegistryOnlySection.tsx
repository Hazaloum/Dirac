"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Landmark, Loader2 } from "lucide-react";
import { api, type ExhibitorPortfolio, type MoleculeCard } from "@/lib/api";
import { RegistryPortfolio } from "@/components/RegistryPortfolio";

/** Registry key of a catalogue card: the matched combo key, else its name as sorted lower-case INNs. */
function cardKey(c: MoleculeCard): string {
  if (c.registry_combo_key) return c.registry_combo_key;
  return (c.registry_name ?? c.molecule).toLowerCase().split("+").map((p) => p.trim()).filter(Boolean).sort().join("+");
}

/** "amlodipine+valsartan" → "AMLODIPINE + VALSARTAN" (IQVIA spelling). */
const iqviaName = (key: string) => key.split("+").map((p) => p.trim().toUpperCase()).join(" + ");

/**
 * Upload catalogue: "In registry" — what the picked company holds in the official registries but didn't list in this
 * catalogue. Molecules known only from uploaded catalogues (registry "Uploaded") are left out.
 */
export function RegistryOnlySection({ companyId, wholeGroup, cards, onMoleculeOpen }: {
  companyId: number;
  wholeGroup: boolean;
  cards: MoleculeCard[];
  onMoleculeOpen: (card: MoleculeCard) => void;
}) {
  const [data, setData] = useState<ExhibitorPortfolio | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null); setError("");
    api.getCompanyPortfolio(companyId, wholeGroup)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [companyId, wholeGroup]);

  const onlyInRegistry = useMemo<ExhibitorPortfolio | null>(() => {
    if (!data) return null;
    const inCatalogue = new Set(cards.map(cardKey));
    const groups = data.groups.map((g) => {
      const molecules = g.molecules
        .map((m) => {
          const countries = m.countries.filter((c) => c !== "Uploaded");
          return { ...m, countries, in_uae: countries.includes("AE") };
        })
        .filter((m) => m.countries.length > 0 && !inCatalogue.has(m.molecule));
      return { ...g, molecules, market_value_aed: molecules.reduce((s, m) => s + (m.market_value_aed ?? 0), 0) };
    }).filter((g) => g.molecules.length > 0);
    return { ...data, groups };
  }, [data, cards]);

  const count = onlyInRegistry?.groups.reduce((s, g) => s + g.molecules.length, 0) ?? 0;

  async function openMolecule(key: string) {
    const name = iqviaName(key);
    setOpening(key);
    try {
      const res = await api.enrichMolecules([name], name);
      const card = res.molecules[0];
      if (card) onMoleculeOpen(card);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the molecule");
    } finally {
      setOpening(null);
    }
  }

  return (
    <section className="rounded-xl border border-surface-200 bg-white p-5">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-3 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-surface-500" /> : <ChevronRight className="h-4 w-4 text-surface-500" />}
        <Landmark className="h-4 w-4 text-pharma-900" />
        <h2 className="text-base font-semibold text-surface-900">In registry</h2>
        <span className="text-xs text-surface-500">
          {data ? `${count} molecule${count === 1 ? "" : "s"} ${data.company?.name ?? "this company"} holds in official registries but didn't list in this catalogue` : "Loading…"}
        </span>
        {(!data && !error) || opening ? <Loader2 className="h-3.5 w-3.5 animate-spin text-surface-400" /> : null}
      </button>
      {open && (
        <div className="mt-4">
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          {onlyInRegistry && count === 0 && (
            <p className="text-sm text-surface-500">Nothing else: every molecule it holds in the registries is in this catalogue.</p>
          )}
          {onlyInRegistry && count > 0 && (
            <RegistryPortfolio data={onlyInRegistry} onMoleculeClick={openMolecule}
              note="From the official registries (EU, US, GCC); molecules known only from uploaded catalogues are left out. Click a molecule to open it." />
          )}
        </div>
      )}
    </section>
  );
}
