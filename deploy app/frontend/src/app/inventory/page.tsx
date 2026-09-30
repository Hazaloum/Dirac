"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Boxes } from "lucide-react";
import { api, type InventoryResponse } from "@/lib/api";

export default function InventoryPage() {
  const [data, setData] = useState<InventoryResponse>({ items: [], unmatched_molecules: [] });
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
  return <main className="mx-auto max-w-7xl px-5 py-10">
    <div className="mb-7 flex items-center gap-3"><Boxes className="h-7 w-7 text-pharma-700" />
      <div><h1 className="text-3xl font-semibold text-surface-900">Inventory</h1>
        <p className="text-sm text-surface-500">Every IQVIA product pack for molecules in My Portfolio. Current stock starts at zero and is measured in packs. Product codes are unavailable in the IQVIA file.</p></div>
    </div>
    {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading ? <p className="text-surface-500">Loading inventory…</p> : data.items.length === 0 && data.unmatched_molecules.length === 0 ?
      <div className="rounded-xl border border-surface-300 bg-white p-8 text-center text-surface-600">Add molecules to <Link href="/portfolio" className="text-pharma-700 underline">My Portfolio</Link> to see their IQVIA packs.</div> : <>
        {data.unmatched_molecules.length > 0 && <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No IQVIA pack rows found for: {data.unmatched_molecules.join(", ")}</div>}
        <div className="overflow-x-auto rounded-xl border border-surface-300 bg-white"><table className="min-w-full text-left text-sm">
          <thead className="bg-surface-100 text-xs uppercase tracking-wide text-surface-500"><tr>
            <th className="p-4">Product / molecule</th><th className="p-4">Manufacturer</th><th className="p-4">Product code</th><th className="p-4">Strength</th><th className="p-4">Pack size</th><th className="p-4">Classification</th><th className="p-4">Current stock (packs)</th>
          </tr></thead><tbody>{data.items.map(item => <tr key={item.pack_key} className="border-t border-surface-200">
            <td className="p-4"><div className="font-medium text-surface-900">{item.product_name}</div><div className="text-xs text-surface-500">{item.molecule}</div></td>
            <td className="p-4">{item.manufacturer}</td><td className="p-4 text-surface-400">—</td><td className="p-4">{item.strength}</td><td className="p-4">{item.pack_size}</td><td className="p-4">{item.classification}</td>
            <td className="p-4"><div className="flex items-center gap-2"><input aria-label={`Stock for ${item.product_name} ${item.strength} ${item.pack_size}`} type="number" min="0" step="1" className="w-24 rounded-lg border border-surface-300 px-2 py-1.5 text-sm" value={drafts[item.pack_key] ?? String(item.stock_quantity)}
              onChange={e => setDrafts(prev => ({ ...prev, [item.pack_key]: e.target.value }))} />
              <button onClick={() => save(item.pack_key, item.stock_quantity)} disabled={saving === item.pack_key || drafts[item.pack_key] === undefined || drafts[item.pack_key] === String(item.stock_quantity)} className="rounded-lg bg-pharma-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">{saving === item.pack_key ? "Saving…" : "Save"}</button></div></td>
          </tr>)}</tbody></table></div>
      </>}
  </main>;
}
