"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  OUTCOMES,
  REASONS,
  STANCES,
  type AccountStatus,
  type Feedback,
  type Outcome,
  type Reason,
  type ShelfStatus,
  type Sku,
  type Stance,
} from "@/lib/types";
import { addDays, addMonths, shortDate, skuLabel, typeLabel, ymd } from "@/lib/format";
import SkuRows, { type SkuLine } from "@/components/SkuRows";

type NextChoice = "2w" | "1m" | "2m" | "none" | "date";

const SHELF: { v: ShelfStatus; label: string; on: string }[] = [
  { v: "in", label: "In", on: "border-green-700 bg-green-700 text-white" },
  { v: "low", label: "Low", on: "border-amber-500 bg-amber-500 text-white" },
  { v: "out", label: "Out", on: "border-red-700 bg-red-700 text-white" },
];

const STANCE_ON: Record<Stance, string> = {
  prescribing: "border-green-700 bg-green-700 text-white",
  will_try: "border-amber-500 bg-amber-500 text-white",
  not_interested: "border-red-700 bg-red-700 text-white",
};

const stanceLabel = (s: Stance) => STANCES.find((x) => x.v === s)?.label ?? s;
const reasonLabel = (r: Reason) => REASONS.find((x) => x.v === r)?.label ?? r;

/** The latest stance per molecule from earlier visits to this client. */
type LastFeedback = Feedback & { visited_at: string };

export default function VisitPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [lastFeedback, setLastFeedback] = useState<LastFeedback[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [molecules, setMolecules] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Record<string, { stance?: Stance; reason?: Reason }>>({});
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
        else if (!data) setLoadError("Client not found.");
        else setAccount(data as AccountStatus);
      });
    sb.from("inventory_stock")
      .select("pack_key, molecule, strength, form, pack_size, stock_quantity")
      .order("molecule")
      .then(({ data, error }) => {
        if (error) setLoadError(error.message);
        else setSkus((data ?? []) as Sku[]);
      });
    sb.from("visit_feedback")
      .select("molecule, stance, reason, visits!inner(account_id, visited_at)")
      .eq("visits.account_id", accountId)
      .then(({ data }) => {
        type Row = Feedback & { visits: { visited_at: string } };
        const latest = new Map<string, LastFeedback>();
        for (const r of (data ?? []) as unknown as Row[]) {
          const cur = latest.get(r.molecule);
          if (!cur || r.visits.visited_at > cur.visited_at)
            latest.set(r.molecule, { molecule: r.molecule, stance: r.stance, reason: r.reason, visited_at: r.visits.visited_at });
        }
        const rows = Array.from(latest.values()).sort((a, b) => a.molecule.localeCompare(b.molecule));
        setLastFeedback(rows);
        // Whatever the doctor said they'd try comes up again by default.
        setMolecules(rows.filter((r) => r.stance === "will_try").map((r) => r.molecule));
      });
  }, [accountId]);

  const moleculeList = useMemo(() => Array.from(new Set(skus.map((s) => s.molecule))).sort(), [skus]);
  const byKey = useMemo(() => new Map(skus.map((s) => [s.pack_key, s])), [skus]);
  const labelOf = (k: string) => {
    const s = byKey.get(k);
    return s ? skuLabel(s) : k;
  };

  const isPharmacy = account?.type === "pharmacy";
  const met = outcome === "met";
  const showSamples = outcome === "met" || outcome === "not_available";
  const showShelf = outcome === "order_taken" || outcome === "no_order";
  const showOrder = outcome === "order_taken";

  function toggleMolecule(m: string) {
    setMolecules((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  function setStance(m: string, stance: Stance) {
    setFeedback((cur) => {
      const prev = cur[m];
      if (prev?.stance === stance) {
        const next = { ...cur };
        delete next[m];
        return next;
      }
      return { ...cur, [m]: { stance, reason: stance === "not_interested" ? prev?.reason : undefined } };
    });
  }

  function setReason(m: string, reason: Reason) {
    setFeedback((cur) => ({ ...cur, [m]: { ...cur[m], reason: cur[m]?.reason === reason ? undefined : reason } }));
  }

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
    if (!outcome) {
      setError("Pick what happened on the visit first.");
      return;
    }
    const lines = (l: SkuLine[]) => l.filter((x) => x.pack_key && x.quantity > 0);
    if (showOrder && lines(order).length === 0) {
      setError("Add at least one order line, or choose “No order”.");
      return;
    }
    setSaving(true);
    setError(null);
    const discussed = met ? molecules : [];
    const sampleJson = showSamples
      ? lines(samples).map((l) => ({
          pack_key: l.pack_key,
          sku_label: labelOf(l.pack_key),
          quantity: l.quantity,
          ...(l.batch?.trim() ? { batch: l.batch.trim() } : {}),
        }))
      : [];
    const feedbackJson = discussed
      .filter((m) => feedback[m]?.stance)
      .map((m) => ({ molecule: m, stance: feedback[m].stance, reason: feedback[m].reason ?? null }));
    const shelfJson = showShelf
      ? Object.entries(shelf).map(([k, status]) => ({ pack_key: k, sku_label: labelOf(k), status }))
      : [];
    const orderJson = showOrder
      ? lines(order).map((l) => ({ pack_key: l.pack_key, sku_label: labelOf(l.pack_key), quantity: l.quantity }))
      : [];

    const { error } = await supabase().rpc("save_visit", {
      p_account_id: account.id,
      p_outcome: outcome,
      p_molecules: discussed,
      p_note: note.trim() || null,
      p_next_visit_on: nextDateValue(),
      p_samples: sampleJson,
      p_shelf: shelfJson,
      p_order: orderJson,
      p_feedback: feedbackJson,
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

      {!isPharmacy && lastFeedback.length > 0 && (
        <section className="card space-y-2">
          <span className="label !mb-1">Where they stand</span>
          {lastFeedback.map((f) => (
            <div key={f.molecule} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-surface-900">{f.molecule}</span>
              <span className="text-right text-surface-600">
                {stanceLabel(f.stance)}
                {f.reason ? ` · ${reasonLabel(f.reason)}` : ""} · {shortDate(f.visited_at)}
              </span>
            </div>
          ))}
          {lastFeedback.some((f) => f.stance === "will_try") && (
            <p className="pt-1 text-sm font-medium text-amber-700">
              Ask: did they try {lastFeedback.filter((f) => f.stance === "will_try").map((f) => f.molecule).join(", ")}?
            </p>
          )}
        </section>
      )}

      <section>
        <span className="label">What happened?</span>
        <div className="grid grid-cols-3 gap-2">
          {OUTCOMES[isPharmacy ? "pharmacy" : "clinic"].map((o) => (
            <button
              key={o.v}
              className={`chip !px-2 ${outcome === o.v ? "chip-on" : ""}`}
              onClick={() => {
                setOutcome(o.v);
                setError(null);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {met && (
        <section>
          <span className="label">Discussed</span>
          <div className="flex flex-wrap gap-2">
            {moleculeList.map((m) => (
              <button key={m} className={`chip ${molecules.includes(m) ? "chip-on" : ""}`} onClick={() => toggleMolecule(m)}>
                {m}
              </button>
            ))}
          </div>
        </section>
      )}

      {met && molecules.length > 0 && (
        <section>
          <span className="label">Doctor’s stance</span>
          <div className="space-y-3">
            {molecules.map((m) => {
              const f = feedback[m];
              return (
                <div key={m} className="card space-y-2">
                  <div className="text-sm font-semibold text-surface-900">{m}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {STANCES.map((s) => (
                      <button
                        key={s.v}
                        className={`chip !px-2 ${f?.stance === s.v ? STANCE_ON[s.v] : ""}`}
                        onClick={() => setStance(m, s.v)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {f?.stance === "not_interested" && (
                    <div>
                      <span className="mb-1 block text-xs text-surface-500">Why?</span>
                      <div className="flex flex-wrap gap-2">
                        {REASONS.map((r) => (
                          <button
                            key={r.v}
                            className={`chip ${f.reason === r.v ? "chip-on" : ""}`}
                            onClick={() => setReason(m, r.v)}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!isPharmacy && showSamples && (
        <section>
          <span className="label">{met ? "Samples" : "Samples left"}</span>
          <SkuRows skus={skus} lines={samples} onChange={setSamples} addLabel="Add sample" withBatch />
        </section>
      )}

      {isPharmacy && showShelf && (
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
      )}

      {isPharmacy && showOrder && (
        <section>
          <span className="label">Order</span>
          <SkuRows skus={skus} lines={order} onChange={setOrder} addLabel="Add order line" />
        </section>
      )}

      {outcome && (
        <>
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
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-xl space-y-2">
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" disabled={saving || saved || !outcome} onClick={save}>
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
