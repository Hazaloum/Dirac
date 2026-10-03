"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Check, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { api, type InventoryResponse, type InventorySku, type OrderKind, type SkuOptions, type StockOrder } from "@/lib/api";

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

// ─── New purchase / sales order ───────────────────────────────────────────────
const ORDER_TEXT: Record<OrderKind, { title: string; party: string; placeholder: string; close: string; closed: string }> = {
  purchase: { title: "New purchase order", party: "Supplier", placeholder: "Manufacturer", close: "Received", closed: "received" },
  sales: { title: "New sales order", party: "Customer", placeholder: "Distributor or pharmacy", close: "Delivered", closed: "delivered" },
};

function skuText(s: InventorySku) {
  return `${s.molecule} ${s.strength} · ${formLabel(s.form)} · ${packLabel(s.pack_size)}`;
}

function OrderForm({ kind, skus, onClose, onSaved }: {
  kind: OrderKind; skus: InventorySku[]; onClose: () => void; onSaved: () => void;
}) {
  const text = ORDER_TEXT[kind];
  const [party, setParty] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<{ id: number; pack_key: string; quantity: string }[]>([{ id: 1, pack_key: "", quantity: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const patch = (id: number, p: Partial<{ pack_key: string; quantity: string }>) =>
    setLines((cur) => cur.map((l) => (l.id === id ? { ...l, ...p } : l)));

  async function save() {
    const filled = lines.filter((l) => l.pack_key || l.quantity);
    if (!party.trim()) return setError(`Enter the ${text.party.toLowerCase()}.`);
    if (!filled.length) return setError("Add at least one SKU.");
    if (filled.some((l) => !l.pack_key || !(Number(l.quantity) > 0) || !Number.isInteger(Number(l.quantity))))
      return setError("Each line needs a SKU and a whole number of packs.");
    setSaving(true); setError("");
    try {
      await api.createOrder(kind, {
        party: party.trim(), order_date: date, note: note.trim() || undefined,
        lines: filled.map((l) => ({ pack_key: l.pack_key, quantity: Number(l.quantity) })),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the order");
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border border-surface-300 px-3 py-2 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-surface-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-surface-900">{text.title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-surface-400 hover:text-surface-900"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="text-xs font-medium text-surface-600">{text.party}
              <input className={`${field} mt-1`} placeholder={text.placeholder} value={party} onChange={(e) => setParty(e.target.value)} autoFocus />
            </label>
            <label className="text-xs font-medium text-surface-600">Date
              <input type="date" className={`${field} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-surface-600">SKUs</p>
            {lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <select className={field} value={l.pack_key} onChange={(e) => patch(l.id, { pack_key: e.target.value })}>
                  <option value="">Choose a SKU…</option>
                  {skus.map((s) => <option key={s.pack_key} value={s.pack_key}>{skuText(s)}</option>)}
                </select>
                <input type="number" min="1" step="1" placeholder="Packs" aria-label="Packs" className={`${field} !w-24`}
                  value={l.quantity} onChange={(e) => patch(l.id, { quantity: e.target.value })} />
                <button aria-label="Remove line" onClick={() => setLines((cur) => cur.filter((x) => x.id !== l.id))}
                  className="text-surface-400 hover:text-red-700 disabled:opacity-30" disabled={lines.length === 1}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button onClick={() => setLines((cur) => [...cur, { id: Date.now(), pack_key: "", quantity: "" }])}
              className="flex items-center gap-1 text-xs font-medium text-pharma-700"><Plus className="h-3.5 w-3.5" /> Add SKU</button>
          </div>
          <label className="block text-xs font-medium text-surface-600">Note
            <input className={`${field} mt-1`} placeholder="Optional — reference, terms…" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
        <div className="flex items-center justify-between border-t border-surface-200 px-5 py-3">
          <span className="text-xs text-surface-500">Stock changes when the order is marked {text.closed}.</span>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-pharma-900 px-4 py-2 text-sm font-medium text-white hover:bg-pharma-800 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Create order
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Orders list ──────────────────────────────────────────────────────────────
function OrderList({ orders, onChange, onError }: {
  orders: { purchase: StockOrder[]; sales: StockOrder[] };
  onChange: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const all = [
    ...orders.purchase.map((o) => ({ ...o, kind: "purchase" as OrderKind })),
    ...orders.sales.map((o) => ({ ...o, kind: "sales" as OrderKind })),
  ];
  const open = all.filter((o) => o.status === "open").sort((a, b) => a.order_date.localeCompare(b.order_date));
  const recent = all.filter((o) => o.status !== "open")
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? "")).slice(0, 10);
  if (!all.length) return null;

  async function act(kind: OrderKind, id: number, action: "close" | "cancel") {
    setBusy(`${kind}${id}`); onError("");
    try {
      await (action === "close" ? api.closeOrder(kind, id) : api.cancelOrder(kind, id));
      await onChange();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not update the order"); }
    finally { setBusy(null); }
  }

  const badge = (kind: OrderKind) => (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${kind === "purchase" ? "bg-sky-50 text-sky-800" : "bg-emerald-50 text-emerald-800"}`}>
      {kind === "purchase" ? "IN" : "OUT"}
    </span>
  );

  return (
    <section className="mt-10 space-y-3">
      <h2 className="text-lg font-semibold text-surface-900">Orders</h2>
      {open.length === 0 && <p className="text-sm text-surface-500">No open orders.</p>}
      {open.map((o) => (
        <div key={`${o.kind}${o.id}`} className="rounded-xl border border-surface-300 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            {badge(o.kind)}
            <span className="text-sm font-semibold text-surface-900">{o.number}</span>
            <span className="text-sm text-surface-600">· {o.party}</span>
            <span className="ml-auto text-xs text-surface-400">{o.order_date}</span>
          </div>
          <ul className="mt-2 space-y-0.5 text-sm text-surface-700">
            {o.lines.map((l) => <li key={l.pack_key} className="flex justify-between"><span>{l.sku_label}</span><span className="font-medium">{l.quantity} packs</span></li>)}
          </ul>
          {o.note && <p className="mt-1 text-xs text-surface-500">{o.note}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => act(o.kind, o.id, "cancel")} disabled={!!busy} className="rounded-lg px-3 py-1.5 text-xs text-surface-500 hover:text-red-700 disabled:opacity-40">Cancel</button>
            <button onClick={() => act(o.kind, o.id, "close")} disabled={!!busy}
              className="flex items-center gap-1.5 rounded-lg bg-pharma-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {busy === `${o.kind}${o.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {ORDER_TEXT[o.kind].close}
            </button>
          </div>
        </div>
      ))}
      {recent.length > 0 && (
        <div className="pt-2">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-surface-400">Recent</p>
          <ul className="divide-y divide-surface-100 text-sm">
            {recent.map((o) => (
              <li key={`${o.kind}${o.id}`} className="flex items-center gap-2 py-2 text-surface-600">
                {badge(o.kind)} <span className="font-medium text-surface-800">{o.number}</span> · {o.party}
                <span className="ml-auto text-xs capitalize text-surface-400">{o.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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
  const [orders, setOrders] = useState<{ purchase: StockOrder[]; sales: StockOrder[] }>({ purchase: [], sales: [] });
  const [newOrder, setNewOrder] = useState<OrderKind | null>(null);
  const refresh = useCallback(async () => {
    const [inventory, orderList] = await Promise.all([api.getInventory(), api.getOrders()]);
    setData(inventory);
    setOrders(orderList);
  }, []);
  const carriedSkus = data.molecules.flatMap((m) => m.skus);
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
    <div className="mb-7 flex flex-wrap items-center gap-3"><Boxes className="h-7 w-7 text-pharma-700" />
      <h1 className="text-3xl font-semibold text-surface-900">Inventory</h1>
      <div className="ml-auto flex gap-2">
        {(["sales", "purchase"] as OrderKind[]).map((kind) => (
          <button key={kind} onClick={() => setNewOrder(kind)} disabled={!carriedSkus.length}
            title={carriedSkus.length ? undefined : "Select the SKUs you carry first"}
            className="flex items-center gap-1.5 rounded-lg border border-pharma-700 px-3 py-2 text-sm font-medium text-pharma-800 hover:bg-pharma-50 disabled:opacity-40">
            <Plus className="h-4 w-4" /> {kind === "sales" ? "Sales order" : "Purchase order"}
          </button>
        ))}
      </div>
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
                {(sku.on_order > 0 || sku.committed > 0) && (
                  <span className="block text-xs text-surface-500">
                    {sku.on_order > 0 && <span className="text-sky-700">+{sku.on_order} on order</span>}
                    {sku.on_order > 0 && sku.committed > 0 && " · "}
                    {sku.committed > 0 && <span className="text-emerald-700">{sku.committed} committed</span>}
                  </span>
                )}
              </span>
              <input aria-label={`Stock for ${group.molecule} ${sku.strength} ${sku.form} ${sku.pack_size}`} type="number" min="0" step="1" className="w-24 rounded-lg border border-surface-300 px-2 py-1.5 text-sm" value={drafts[sku.pack_key] ?? String(sku.stock_quantity)}
                onChange={e => setDrafts(prev => ({ ...prev, [sku.pack_key]: e.target.value }))} />
              <button onClick={() => saveStock(sku.pack_key, sku.stock_quantity)} disabled={saving === sku.pack_key || drafts[sku.pack_key] === undefined || drafts[sku.pack_key] === String(sku.stock_quantity)} className="rounded-lg bg-pharma-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">{saving === sku.pack_key ? "Saving…" : "Save"}</button>
            </div>)}
          </div>}
        </section>)}
      </div>}
    {!loading && <OrderList orders={orders} onChange={refresh} onError={setError} />}
    {newOrder && <OrderForm kind={newOrder} skus={carriedSkus} onClose={() => setNewOrder(null)}
      onSaved={() => { setNewOrder(null); refresh().catch((e: Error) => setError(e.message)); }} />}
    {picking && <SkuPicker molecule={picking} onClose={() => setPicking(null)} onSaved={() => { setPicking(null); refresh().catch((e: Error) => setError(e.message)); }} />}
  </main>;
}
