"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { VisitRow } from "@/lib/types";
import { addDays, shortDate, shortTime, weekStart } from "@/lib/format";

export default function WeekPage() {
  const { rep, signOut } = useAuth();
  const [visits, setVisits] = useState<VisitRow[] | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [samples, setSamples] = useState(0);
  const [orders, setOrders] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    const from = weekStart();
    const fromIso = from.toISOString();
    const toIso = addDays(from, 7).toISOString();

    (async () => {
      const { data: v, error: vErr } = await sb
        .from("visits")
        .select("id, account_id, visited_at, note, molecules")
        .gte("visited_at", fromIso)
        .lt("visited_at", toIso)
        .order("visited_at", { ascending: false });
      if (vErr) return setError(vErr.message);
      const vs = (v ?? []) as VisitRow[];
      setVisits(vs);

      const accIds = Array.from(new Set(vs.map((x) => x.account_id)));
      const visitIds = vs.map((x) => x.id);
      const [acc, drops, ords] = await Promise.all([
        accIds.length ? sb.from("accounts").select("id, name").in("id", accIds) : Promise.resolve({ data: [] }),
        visitIds.length ? sb.from("sample_drops").select("quantity").in("visit_id", visitIds) : Promise.resolve({ data: [] }),
        sb.from("orders").select("id", { count: "exact", head: true }).gte("created_at", fromIso).lt("created_at", toIso),
      ]);
      setNames(Object.fromEntries(((acc.data ?? []) as { id: number; name: string }[]).map((a) => [a.id, a.name])));
      setSamples(((drops.data ?? []) as { quantity: number }[]).reduce((s, d) => s + (d.quantity ?? 0), 0));
      setOrders("count" in ords ? ords.count ?? 0 : 0);
    })();
  }, []);

  const stat = (n: number | string, label: string) => (
    <div className="card text-center">
      <div className="text-2xl font-bold text-pharma-900">{n}</div>
      <div className="text-xs text-surface-600">{label}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-surface-600">{rep?.name}</p>
        <h1 className="text-2xl font-bold text-surface-900">My week</h1>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {stat(visits?.length ?? "–", "Visits")}
        {stat(visits ? samples : "–", "Samples")}
        {stat(visits ? orders : "–", "Orders")}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!visits && !error && <p className="text-surface-500">Loading…</p>}
      {visits && visits.length === 0 && <p className="text-center text-surface-500">No visits yet this week.</p>}

      <div className="space-y-3">
        {visits?.map((v) => (
          <div key={v.id} className="card">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold text-surface-900">{names[v.account_id] ?? "Client"}</span>
              <span className="shrink-0 text-xs text-surface-500">
                {shortDate(v.visited_at)} · {shortTime(v.visited_at)}
              </span>
            </div>
            {v.note && <p className="mt-1 line-clamp-2 text-sm text-surface-600">{v.note}</p>}
          </div>
        ))}
      </div>

      <button className="btn-secondary" onClick={() => signOut()}>
        Sign out
      </button>
    </div>
  );
}
