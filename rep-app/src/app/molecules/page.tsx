"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Sku } from "@/lib/types";

/** 'FILM-COATED TABLETS' → 'Film-coated tablets'; '30' → 'Pack of 30'. */
const formLabel = (form: string | null) => (form ? form.charAt(0) + form.slice(1).toLowerCase() : "");
const packLabel = (size: string | null) => (size && /^\d+$/.test(size) ? `Pack of ${size}` : size ?? "");

/** The molecules COMIX carries, with their packs. What reps should know about each is still to come. */
export default function MoleculesPage() {
  const [skus, setSkus] = useState<Sku[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase()
      .from("inventory_stock")
      .select("pack_key, molecule, strength, form, pack_size, stock_quantity")
      .order("molecule")
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setSkus((data ?? []) as Sku[]);
      });
  }, []);

  const molecules = useMemo(() => {
    const groups = new Map<string, Sku[]>();
    for (const s of skus ?? []) groups.set(s.molecule, [...(groups.get(s.molecule) ?? []), s]);
    const term = q.trim().toLowerCase();
    return Array.from(groups.entries()).filter(([m]) => !term || m.toLowerCase().includes(term));
  }, [skus, q]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-surface-900">Molecules</h1>

      <label className="relative block">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
        <input className="field !pl-10" placeholder="Search molecules" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!skus && !error && <p className="text-surface-500">Loading…</p>}
      {skus && molecules.length === 0 && <p className="text-center text-surface-500">No molecules found.</p>}

      <div className="space-y-3">
        {molecules.map(([molecule, packs]) => (
          <section key={molecule} className="card">
            <h2 className="font-semibold text-surface-900">{molecule}</h2>
            <ul className="mt-2 space-y-1 text-sm text-surface-700">
              {packs.map((p) => (
                <li key={p.pack_key}>
                  <span className="font-medium text-surface-900">{p.strength}</span>
                  {" · "}{formLabel(p.form)}{" · "}{packLabel(p.pack_size)}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
