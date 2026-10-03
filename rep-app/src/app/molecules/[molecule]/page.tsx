"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ResearchCard, Sku } from "@/lib/types";
import { shortDate } from "@/lib/format";

const formLabel = (form: string | null) => (form ? form.charAt(0) + form.slice(1).toLowerCase() : "");
const packLabel = (size: string | null) => (size && /^\d+$/.test(size) ? `Pack of ${size}` : size ?? "");

export default function MoleculePage() {
  const params = useParams<{ molecule: string }>();
  const molecule = decodeURIComponent(params.molecule);
  const router = useRouter();
  const [packs, setPacks] = useState<Sku[]>([]);
  const [cards, setCards] = useState<ResearchCard[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    const { data, error } = await supabase()
      .from("molecule_research")
      .select("*")
      .eq("molecule", molecule)
      .order("rank");
    if (error) setError(error.message);
    const rows = (data ?? []) as ResearchCard[];
    setCards(rows);
    return rows;
  }, [molecule]);

  /** Ask the backend to pull PubMed and write fresh cards (~30 s). */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const api = process.env.NEXT_PUBLIC_API_URL;
      if (!api) throw new Error("Research isn't set up yet (NEXT_PUBLIC_API_URL is missing).");
      const { data } = await supabase().auth.getSession();
      const res = await fetch(`${api.replace(/\/$/, "")}/api/rep/research/${encodeURIComponent(molecule)}/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Couldn't refresh research (error ${res.status}).`);
      await loadCards();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't refresh research.");
    } finally {
      setRefreshing(false);
    }
  }, [molecule, loadCards]);

  useEffect(() => {
    supabase()
      .from("inventory_stock")
      .select("pack_key, molecule, strength, form, pack_size, stock_quantity")
      .eq("molecule", molecule)
      .then(({ data }) => setPacks((data ?? []) as Sku[]));
    // First visit for this molecule: write the cards straight away.
    loadCards().then((rows) => { if (rows.length === 0) refresh(); });
  }, [molecule, loadCards, refresh]);

  const updated = cards?.[0]?.created_at;

  return (
    <div className="space-y-5">
      <div>
        <button aria-label="Back" onClick={() => router.back()} className="flex h-11 w-11 items-center">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-2xl font-bold text-surface-900">{molecule.charAt(0) + molecule.slice(1).toLowerCase()}</h1>
        <ul className="mt-1 space-y-0.5 text-sm text-surface-600">
          {packs.map((p) => (
            <li key={p.pack_key}>
              <span className="font-medium text-surface-800">{p.strength}</span> · {formLabel(p.form)} · {packLabel(p.pack_size)}
            </li>
          ))}
        </ul>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="label !mb-0">Latest research</span>
          <button onClick={refresh} disabled={refreshing}
            className="flex min-h-[36px] items-center gap-1.5 text-xs font-medium text-pharma-800 disabled:opacity-50">
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {updated && !refreshing ? `Updated ${shortDate(updated)}` : refreshing ? "Updating…" : "Refresh"}
          </button>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {refreshing && !cards?.length && (
          <p className="card text-sm text-surface-600">Reading the latest studies on PubMed… this takes about 30 seconds.</p>
        )}
        {cards && cards.length === 0 && !refreshing && !error && (
          <p className="text-sm text-surface-500">No research cards yet.</p>
        )}

        {cards?.map((c) => (
          <article key={c.pmid} className="card space-y-2">
            <div>
              <p className="text-xs text-surface-500">
                {[c.study, c.journal, c.published_on && shortDate(c.published_on)].filter(Boolean).join(" · ")}
              </p>
              <h3 className="mt-0.5 text-sm font-semibold leading-snug text-surface-900">{c.title}</h3>
            </div>
            <p className="text-sm text-surface-800">{c.finding}</p>
            {c.say && (
              <p className="rounded-xl bg-pharma-50 p-3 text-sm text-pharma-900">
                <span className="font-semibold">Say: </span>“{c.say}”
              </p>
            )}
            {c.caution && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                <span className="font-semibold">Careful: </span>{c.caution}
              </p>
            )}
            <a href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`} target="_blank" rel="noreferrer"
              className="inline-flex min-h-[36px] items-center gap-1 text-xs font-medium text-pharma-800">
              Read on PubMed <ExternalLink size={12} />
            </a>
          </article>
        ))}
      </section>
    </div>
  );
}
