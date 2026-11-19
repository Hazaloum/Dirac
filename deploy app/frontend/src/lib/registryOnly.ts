import { useEffect, useState } from "react";
import { api, type AnalysisResult, type MoleculeCard } from "@/lib/api";

/** Registry key of a catalogue card: the matched combo key, else its name as sorted lower-case INNs. */
function cardKey(c: MoleculeCard): string {
  if (c.registry_combo_key) return c.registry_combo_key;
  return (c.registry_name ?? c.molecule).toLowerCase().split("+").map((p) => p.trim()).filter(Boolean).sort().join("+");
}

/** "amlodipine+valsartan" → "AMLODIPINE + VALSARTAN" (IQVIA spelling). */
const iqviaName = (key: string) => key.split("+").map((p) => p.trim().toUpperCase()).join(" + ");

const BATCH = 25;

export interface RegistryOnly {
  /** The molecules as an AnalysisResult, so the catalogue's card grid can show them; null until the list is known. */
  result: AnalysisResult | null;
  /** Molecules enriched so far / to enrich (only those in UAE IQVIA are enriched; the rest are plain cards). */
  loaded: number;
  total: number;
  companyName: string;
  error: string;
}

/**
 * Upload catalogue, "In registry only": what the picked company (or its group) holds in the official registries
 * but didn't list in this catalogue. Rows known only from uploaded catalogues (country "Uploaded") are left out.
 * Loads once `enabled` turns true; molecules in UAE IQVIA are enriched in batches so cards appear as they come.
 */
export function useRegistryOnly(companyId: number | undefined, wholeGroup: boolean, catalogue: MoleculeCard[],
                                enabled: boolean): RegistryOnly {
  const [state, setState] = useState<RegistryOnly>({ result: null, loaded: 0, total: 0, companyName: "", error: "" });
  // Once asked for, keep loading (and keep the result) when the view is switched back
  const [wanted, setWanted] = useState(false);
  useEffect(() => { if (enabled) setWanted(true); }, [enabled]);
  const runKey = companyId == null ? null : `${companyId}:${wholeGroup}:${catalogue.map((c) => c.molecule).join("|")}`;

  useEffect(() => {
    if (!wanted || runKey == null || companyId == null) return;
    let live = true;
    setState({ result: null, loaded: 0, total: 0, companyName: "", error: "" });

    (async () => {
      try {
        const portfolio = await api.getCompanyPortfolio(companyId, wholeGroup);
        const inCatalogue = new Set(catalogue.map(cardKey));
        const molecules = portfolio.groups.flatMap((g) => g.molecules)
          .filter((m) => m.matched && m.countries.some((c) => c !== "Uploaded") && !inCatalogue.has(m.molecule));
        const inIqvia = molecules.filter((m) => m.market_value_aed != null).map((m) => iqviaName(m.molecule));
        const plain: MoleculeCard[] = molecules.filter((m) => m.market_value_aed == null)
          .map((m) => ({ molecule: iqviaName(m.molecule), in_iqvia: false }));
        const companyName = portfolio.company?.name ?? "";
        const catalogueNames = new Set(catalogue.map((c) => c.molecule.toUpperCase()));

        const merged: AnalysisResult = {
          companies: [], molecules: [...plain], molecules_by_atc1: {}, molecule_metrics: {},
          enriched_data: "", atc4_context: "", stats: { total: plain.length, matched_iqvia: 0 },
        };
        const publish = (loaded: number) => live && setState({
          result: { ...merged, molecules: [...merged.molecules], molecules_by_atc1: { ...merged.molecules_by_atc1 } },
          loaded, total: inIqvia.length, companyName, error: "",
        });
        publish(0);

        for (let i = 0; i < inIqvia.length; i += BATCH) {
          const res = await api.enrichMolecules(inIqvia.slice(i, i + BATCH), companyName || "Registry");
          if (!live) return;
          const seen = new Set(merged.molecules.map((m) => m.molecule.toUpperCase()));
          // An IQVIA name can come back for two registry spellings, or be one the catalogue already has
          const fresh = res.molecules.filter((m) => !seen.has(m.molecule.toUpperCase()) && !catalogueNames.has(m.molecule.toUpperCase()));
          const freshNames = new Set(fresh.map((m) => m.molecule.toUpperCase()));
          merged.molecules.push(...fresh);
          for (const [atc1, names] of Object.entries(res.molecules_by_atc1)) {
            const keep = names.filter((n) => freshNames.has(n.toUpperCase()));
            if (keep.length) merged.molecules_by_atc1[atc1] = [...(merged.molecules_by_atc1[atc1] ?? []), ...keep];
          }
          Object.assign(merged.molecule_metrics, res.molecule_metrics);
          merged.stats = { total: merged.molecules.length, matched_iqvia: merged.molecules.filter((m) => m.in_iqvia).length };
          publish(Math.min(i + BATCH, inIqvia.length));
        }
      } catch (e) {
        if (live) setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Couldn't load the registry portfolio" }));
      }
    })();
    return () => { live = false; };
  }, [wanted, runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
