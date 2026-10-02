"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AccountStatus, ShelfStatus, Sku } from "@/lib/types";
import { addDays, addMonths, skuLabel, typeLabel, ymd } from "@/lib/format";
import SkuRows, { type SkuLine } from "@/components/SkuRows";

type NextChoice = "2w" | "1m" | "2m" | "none" | "date";

const SHELF: { v: ShelfStatus; label: string; on: string }[] = [
  { v: "in", label: "In", on: "border-green-700 bg-green-700 text-white" },
  { v: "low", label: "Low", on: "border-amber-500 bg-amber-500 text-white" },
  { v: "out", label: "Out", on: "border-red-700 bg-red-700 text-white" },
];

export default function VisitPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [molecules, setMolecules] = useState<string[]>([]);
  const [samples, setSamples] = useState<SkuLine[]>([]);
  const [order, setOrder] = useState<SkuLine[]>([]);
  const [shelf, setShelf] = useState<Record<string, ShelfStatus>>({});
  const [note, setNote] = useState("");
  const [nextChoice, setNextChoice] = useState<NextChoice>("none");
  const [nextDate, setNextDate] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    sb.from("account_status")
      .select("*")
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setLoadError(error.message);
        else if (!data) setLoadError("Account not found.");
        else setAccount(data as AccountStatus);
      });
    sb.from("inventory_stock")
      .select("pack_key, molecule, strength, form, pack_size, stock_quantity")
      .order("molecule")
      .then(({ data, error }) => {
        if (error) setLoadError(error.message);
        else setSkus((data ?? []) as Sku[]);
      });
  }, [accountId]);

  const moleculeList = useMemo(() => Array.from(new Set(skus.map((s) => s.molecule))).sort(), [skus]);
  const byKey = useMemo(() => new Map(skus.map((s) => [s.pack_key, s])), [skus]);
  const labelOf = (k: string) => {
    const s = byKey.get(k);
    return s ? skuLabel(s) : k;
  };

  const isPharmacy = account?.type === "pharmacy";

  function nextDateValue(): string | null {
    const now = new Date();
    switch (nextChoice) {
      case "2w":
        return ymd(addDays(now, 14));
      case "1m":
        return ymd(addMonths(now, 1));
      case "2m":
        return ymd(addMonths(now, 2));
      case "date":
        return nextDate || null;
      default:
        return null;
    }
  }

  async function save() {
    if (!account || saving) return;
    setSaving(true);
    setError(null);
    const lines = (l: SkuLine[]) => l.filter((x) => x.pack_key && x.quantity > 0);
    const sampleJson = isPharmacy
      ? []
      : lines(samples).map((l) => ({
          pack_key: l.pack_key,
          sku_label: labelOf(l.pack_key),
          quantity: l.quantity,
          ...(l.batch?.trim() ? { batch: l.batch.trim() } : {}),
        }));
    const shelfJson = isPharmacy
      ? Object.entries(shelf).map(([k, status]) => ({ pack_key: k, sku_label: labelOf(k), status }))
      : [];
    const orderJson = isPharmacy
      ? lines(order).map((l) => ({ pack_key: l.pack_key, sku_label: labelOf(l.pack_key), quantity: l.quantity }))
      : [];

    const { error } = await supabase().rpc("log_visit", {
      p_account_id: account.id,
      p_molecules: isPharmacy ? [] : molecules,
      p_note: note.trim() || null,
      p_next_visit_on: nextDateValue(),
      p_samples: sampleJson,
      p_shelf: shelfJson,
      p_order: orderJson,
    });
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    setSaved(true);
    setTimeout(() => router.replace("/"), 900);
  }

  if (loadError) return <p className="text-sm text-red-700">{loadError}</p>;
  if (!account) return <p className="text-surface-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <button aria-label="Back" onClick={() => router.back()} className="flex h-11 w-11 items-center">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-2xl font-bold text-surface-900">{account.name}</h1>
        <p className="text-surface-600">
          {[typeLabel(account.type), account.specialty, account.area_name].filter(Boolean).join(" · ")}
        </p>
        {account.last_note && (
          <p className="mt-2 rounded-xl bg-pharma-50 p-3 text-sm text-pharma-900">Last time: {account.last_note}</p>
        )}
      </div>

      {!isPharmacy && (
        <>
          <section>
            <span className="label">Discussed</span>
            <div className="flex flex-wrap gap-2">
              {moleculeList.map((m) => {
                const on = molecules.includes(m);
                return (
                  <button
                    key={m}
                    className={`chip ${on ? "chip-on" : ""}`}
                    onClick={() => setMolecules(on ? molecules.filter((x) => x !== m) : [...molecules, m])}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <span className="label">Samples</span>
            <SkuRows skus={skus} lines={samples} onChange={setSamples} addLabel="Add sample" withBatch />
          </section>
        </>
      )}

      {isPharmacy && (
        <>
          <section>
            <span className="label">Shelf check</span>
            <div className="space-y-3">
              {skus.map((s) => (
                <div key={s.pack_key} className="card space-y-2">
                  <div className="text-sm font-medium text-surface-800">{skuLabel(s)}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {SHELF.map((o) => {
                      const on = shelf[s.pack_key] === o.v;
                      return (
                        <button
                          key={o.v}
                          className={`chip ${on ? o.on : ""}`}
                          onClick={() =>
                            setShelf((cur) => {
                              const n = { ...cur };
                              if (on) delete n[s.pack_key];
                              else n[s.pack_key] = o.v;
                              return n;
                            })
                          }
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {skus.length === 0 && <p className="text-surface-500">No carried SKUs.</p>}
            </div>
          </section>
          <section>
            <span className="label">Order</span>
            <SkuRows skus={skus} lines={order} onChange={setOrder} addLabel="Add order line" />
          </section>
        </>
      )}

      <section>
        <label className="label" htmlFor="note">
          Note
        </label>
        <textarea
          id="note"
          rows={3}
          className="field !py-3"
          placeholder="Anything worth remembering…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </section>

      {!isPharmacy && (
        <section>
          <span className="label">Next visit</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["2w", "2 weeks"],
                ["1m", "1 month"],
                ["2m", "2 months"],
                ["none", "None"],
                ["date", "Pick date"],
              ] as [NextChoice, string][]
            ).map(([v, label]) => (
              <button key={v} className={`chip ${nextChoice === v ? "chip-on" : ""}`} onClick={() => setNextChoice(v)}>
                {label}
              </button>
            ))}
          </div>
          {nextChoice === "date" && (
            <input
              type="date"
              className="field mt-3"
              min={ymd(new Date())}
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
            />
          )}
        </section>
      )}

      {isPharmacy && (
        <section>
          <span className="label">Next visit</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["2w", "2 weeks"],
                ["1m", "1 month"],
                ["2m", "2 months"],
                ["none", "None"],
              ] as [NextChoice, string][]
            ).map(([v, label]) => (
              <button key={v} className={`chip ${nextChoice === v ? "chip-on" : ""}`} onClick={() => setNextChoice(v)}>
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-xl space-y-2">
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" disabled={saving || saved} onClick={save}>
            {saving ? "Saving…" : "Save visit"}
          </button>
        </div>
      </div>

      {saved && (
        <div className="fixed inset-x-0 top-6 z-50 mx-auto flex w-fit items-center gap-2 rounded-full bg-pharma-900 px-5 py-3 text-white shadow-lg">
          <Check size={18} /> Visit saved
        </div>
      )}
    </div>
  );
}
