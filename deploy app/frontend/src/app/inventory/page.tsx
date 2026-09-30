"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Check, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { api, type InventoryResponse, type SkuOptions } from "@/lib/api";

/** 'FILM-COATED TABLETS (MR)' → 'Film-coated tablets (MR)' */
function formLabel(form: string) {
  if (!form) return "Other";
  return (form.charAt(0) + form.slice(1).toLowerCase()).replace("(mr)", "(MR)");
}

/** '30' → 'Pack of 30'; '60 ML' stays as is. */
function packLabel(size: string) {
  return /^\d+$/.test(size) ? `Pack of ${size}` : size;
}

// ─── SKU picker pop-up ────────────────────────────────────────────────────────
function SkuPicker({ molecule, onClose, onSaved }: { molecule: string; onClose: () => void; onSaved: () => void }) {
  const [options, setOptions] = useState<SkuOptions | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeForm, setActiveForm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getInventoryOptions(molecule)
      .then((res) => {
        setOptions(res);
        setSelected(new Set(res.forms.flatMap((f) => f.packs.filter((p) => p.carried).map((p) => p.pack_key))));
        if (res.forms.length === 1) setActiveForm(res.forms[0].form);
      })
      .catch((e: Error) => setError(e.message));
  }, [molecule]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.setInventorySkus(molecule, Array.from(selected));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save SKUs");
      setSaving(false);
    }
  };

  const form = options?.forms.find((f) => f.form === activeForm);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-surface-200 px-5 py-4">
          {form && options && options.forms.length > 1 && (
            <button onClick={() => setActiveForm(null)} aria-label="Back to forms" className="text-surface-500 hover:text-surface-900">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-surface-900">{molecule}</h2>
            <p className="text-xs text-surface-500">{form ? formLabel(form.form) : "Choose a form"}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-surface-400 hover:text-surface-900"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!options && !error && <p className="flex items-center gap-2 text-sm text-surface-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}

          {options && !form && (
            <div className="grid grid-cols-2 gap-3">
              {options.forms.map((f) => {
                const count = f.packs.filter((p) => selected.has(p.pack_key)).length;
                return (
                  <button key={f.form} onClick={() => setActiveForm(f.form)}
                    className={`rounded-xl border p-4 text-left transition-colors ${count ? "border-pharma-300 bg-pharma-50" : "border-surface-200 hover:border-pharma-300"}`}>
                    <p className="text-sm font-medium text-surface-900">{formLabel(f.form)}</p>
                    <p className="mt-1 flex items-center justify-between text-xs text-surface-500">
                      {count ? <span className="font-semibold text-pharma-900">{count} selected</span> : <span>{f.packs.length} option{f.packs.length === 1 ? "" : "s"}</span>}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {form && (
            <div className="divide-y divide-surface-100">
              {form.packs.map((p) => {
                const on = selected.has(p.pack_key);
                return (
                  <button key={p.pack_key} onClick={() => toggle(p.pack_key)} className="flex w-full items-center gap-3 py-2.5 text-left">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-pharma-900 bg-pharma-900 text-white" : "border-surface-300"}`}>
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="w-28 text-sm font-medium text-surface-900">{p.strength || "—"}</span>
                    <span className="text-sm text-surface-600">{packLabel(p.pack_size)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-surface-200 px-5 py-3">
          <span className="text-xs text-surface-500">{selected.size} SKU{selected.size === 1 ? "" : "s"} selected</span>
          <button onClick={save} disabled={!options || saving}
            className="flex items-center gap-2 rounded-lg bg-pharma-900 px-4 py-2 text-sm font-medium text-white hover:bg-pharma-800 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const [data, setData] = useState<InventoryResponse>({ molecules: [], unmatched_molecules: [] });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => setData(await api.getInventory()), []);
  useEffect(() => { refresh().catch((e: Error) => setError(e.message)).finally(() => setLoading(false)); }, [refresh]);

  async function saveStock(packKey: string, current: number) {
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

  return <main className="mx-auto max-w-4xl px-5 py-10">
    <div className="mb-7 flex items-center gap-3"><Boxes className="h-7 w-7 text-pharma-700" />
      <h1 className="text-3xl font-semibold text-surface-900">Inventory</h1>
    </div>
    {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading ? <p className="text-surface-500">Loading inventory…</p> : data.molecules.length === 0 ?
      <div className="rounded-xl border border-surface-300 bg-white p-8 text-center text-surface-600">Add molecules to <Link href="/portfolio" className="text-pharma-700 underline">My Portfolio</Link> first.</div> : <div className="space-y-3">
        {data.molecules.map(group => <section key={group.molecule} className="rounded-xl border border-surface-300 bg-white">
          <button onClick={() => group.option_count && setPicking(group.molecule)} disabled={!group.option_count}
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left disabled:cursor-default">
            <span className="text-sm font-semibold text-surface-900">{group.molecule}</span>
            {group.option_count ? (
              <span className="flex items-center gap-1 text-xs font-medium text-pharma-700">
                {group.skus.length ? <>{group.skus.length} SKU{group.skus.length === 1 ? "" : "s"} · Edit</> : <><Plus className="h-3.5 w-3.5" /> Select SKUs</>}
              </span>
            ) : <span className="text-xs text-surface-400">No IQVIA packs</span>}
          </button>
          {group.skus.length > 0 && <div className="divide-y divide-surface-100 border-t border-surface-200">
            {group.skus.map(sku => <div key={sku.pack_key} className="flex items-center gap-4 px-4 py-2">
              <span className="flex-1 text-sm text-surface-700">
                <span className="font-medium text-surface-900">{sku.strength || "—"}</span> · {formLabel(sku.form)} · {packLabel(sku.pack_size)}
              </span>
              <input aria-label={`Stock for ${group.molecule} ${sku.strength} ${sku.form} ${sku.pack_size}`} type="number" min="0" step="1" className="w-24 rounded-lg border border-surface-300 px-2 py-1.5 text-sm" value={drafts[sku.pack_key] ?? String(sku.stock_quantity)}
                onChange={e => setDrafts(prev => ({ ...prev, [sku.pack_key]: e.target.value }))} />
              <button onClick={() => saveStock(sku.pack_key, sku.stock_quantity)} disabled={saving === sku.pack_key || drafts[sku.pack_key] === undefined || drafts[sku.pack_key] === String(sku.stock_quantity)} className="rounded-lg bg-pharma-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">{saving === sku.pack_key ? "Saving…" : "Save"}</button>
            </div>)}
          </div>}
        </section>)}
      </div>}
    {picking && <SkuPicker molecule={picking} onClose={() => setPicking(null)} onSaved={() => { setPicking(null); refresh().catch((e: Error) => setError(e.message)); }} />}
  </main>;
}
