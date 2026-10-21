"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Handshake, Loader2 } from "lucide-react";
import { api, type DealRef } from "@/lib/api";

/** "Add to Deal Tracker" for one molecule; once it has a deal, a link to it showing its stage. */
export function AddToDeal({ molecule }: { molecule: string }) {
  const [deal, setDeal] = useState<DealRef | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [partner, setPartner] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDeal(undefined); setOpen(false); setPartner(""); setError(""); setAdded(false);
    api.getDealForMolecule(molecule)
      .then((r) => { if (!cancelled) setDeal(r.deal); })
      .catch(() => { if (!cancelled) setDeal(null); });
    return () => { cancelled = true; };
  }, [molecule]);

  const add = async () => {
    setSaving(true); setError("");
    try {
      const d = await api.createDeal({ molecule, partner: partner.trim(), stage: "interested" });
      setDeal({ id: d.id, stage: d.stage, stage_name: "Shortlisted · Interested", partner: d.partner, status: d.status });
      setAdded(true); setOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't add it to the Deal Tracker");
    } finally {
      setSaving(false);
    }
  };

  const btn = "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors";

  if (deal === undefined) return null;
  if (deal) {
    return (
      <Link href={`/deal-tracker?deal=${deal.id}`}
        className={`${btn} border border-pharma-200 bg-pharma-50 text-pharma-900 hover:border-pharma-300`}>
        {added ? <Check className="h-4 w-4" /> : <Handshake className="h-4 w-4" />}
        {added ? "Added" : "In Deal Tracker"} · {deal.stage_name}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${btn} bg-pharma-900 text-white hover:bg-pharma-800`}>
        <Handshake className="h-4 w-4" /> Add to Deal Tracker
      </button>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="flex flex-wrap items-center gap-2">
      <input autoFocus value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="Partner (optional)"
        className="w-48 rounded-xl border border-surface-300 bg-white px-3 py-2.5 text-sm text-surface-900 focus:border-pharma-300 focus:outline-none" />
      <button type="submit" disabled={saving} className={`${btn} bg-pharma-900 text-white hover:bg-pharma-800 disabled:opacity-50`}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />} Add as Interested
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-2 text-sm text-surface-500 hover:text-surface-800">Cancel</button>
      {error && <p className="w-full text-xs text-rose-700">{error}</p>}
    </form>
  );
}
