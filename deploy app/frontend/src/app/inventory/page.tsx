"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Boxes } from "lucide-react";
import { api, type InventoryResponse } from "@/lib/api";

export default function InventoryPage() {
  const [data, setData] = useState<InventoryResponse>({ molecules: [], unmatched_molecules: [] });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => setData(await api.getInventory()), []);
  useEffect(() => { refresh().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);

  async function save(packKey: string, current: number) {
    const quantity = Number(drafts[packKey] ?? current);
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647) { setError("Stock must be a non-negative whole number."); return; }
    setSaving(packKey); setError("");
    try {
      await api.setInventoryStock(packKey, quantity);
      await refresh();
      setDrafts(prev => { const next = { ...prev }; delete next[packKey]; return next; });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update stock"); }
    finally { setSaving(null); }
  }

  return <main className="mx-auto max-w-5xl px-5 py-10">
    <div className="mb-7 flex items-center gap-3"><Boxes className="h-7 w-7 text-pharma-700" />
      <div><h1 className="text-3xl font-semibold text-surface-900">Inventory</h1>
        <p className="text-sm text-surface-500">The unique packs of each molecule in My Portfolio. Stock is measured in packs.</p></div>
    </div>
    {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading ? <p className="text-surface-500">Loading inventory…</p> : data.molecules.length === 0 && data.unmatched_molecules.length === 0 ?
      <div className="rounded-xl border border-surface-300 bg-white p-8 text-center text-surface-600">Add molecules to <Link href="/portfolio" className="text-pharma-700 underline">My Portfolio</Link> to see their packs.</div> : <div className="space-y-5">
        {data.unmatched_molecules.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No IQVIA packs found for: {data.unmatched_molecules.join(", ")}</div>}
        {data.molecules.map(group => <section key={group.molecule} className="overflow-hidden rounded-xl border border-surface-300 bg-white">
          <div className="flex items-baseline justify-between gap-4 border-b border-surface-200 bg-surface-50 px-4 py-3">
            <h2 className="text-sm font-semibold text-surface-900">{group.molecule}</h2>
            <span className="truncate text-xs text-surface-500">{group.classification} · {group.packs.length} pack{group.packs.length === 1 ? "" : "s"}</span>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-surface-500"><tr>
              <th className="px-4 py-2 font-medium">Strength</th><th className="px-4 py-2 font-medium">Form</th><th className="px-4 py-2 font-medium">Pack size</th><th className="px-4 py-2 font-medium">Stock (packs)</th>
            </tr></thead>
            <tbody>{group.packs.map(pack => <tr key={pack.pack_key} className="border-t border-surface-100">
              <td className="px-4 py-2.5 font-medium text-surface-900">{pack.strength || "—"}</td>
              <td className="px-4 py-2.5 text-surface-700">{pack.form ? pack.form.charAt(0) + pack.form.slice(1).toLowerCase() : "—"}</td>
              <td className="px-4 py-2.5 text-surface-700">{pack.pack_size}</td>
              <td className="px-4 py-2.5"><div className="flex items-center gap-2">
                <input aria-label={`Stock for ${group.molecule} ${pack.strength} ${pack.form} ${pack.pack_size}`} type="number" min="0" step="1" className="w-24 rounded-lg border border-surface-300 px-2 py-1.5 text-sm" value={drafts[pack.pack_key] ?? String(pack.stock_quantity)}
                  onChange={e => setDrafts(prev => ({ ...prev, [pack.pack_key]: e.target.value }))} />
                <button onClick={() => save(pack.pack_key, pack.stock_quantity)} disabled={saving === pack.pack_key || drafts[pack.pack_key] === undefined || drafts[pack.pack_key] === String(pack.stock_quantity)} className="rounded-lg bg-pharma-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">{saving === pack.pack_key ? "Saving…" : "Save"}</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </section>)}
      </div>}
  </main>;
}
