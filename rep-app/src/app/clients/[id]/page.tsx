"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, MapPin, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { OUTCOME_LABEL, type AccountStatus, type VisitRow } from "@/lib/types";
import { lastSeen, shortDate, typeLabel } from "@/lib/format";

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [a, setA] = useState<AccountStatus | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    sb.from("account_status")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error) return setError(error.message);
        if (!data) return setError("Client not found.");
        const acc = data as AccountStatus;
        setA(acc);
        if (acc.parent_id) {
          const { data: p } = await sb.from("accounts").select("name").eq("id", acc.parent_id).maybeSingle();
          setParent((p as { name: string } | null)?.name ?? null);
        }
      });
    sb.from("visits")
      .select("id, account_id, visited_at, note, molecules, outcome")
      .eq("account_id", id)
      .order("visited_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setVisits((data ?? []) as VisitRow[]));
  }, [id]);

  return (
    <div className="space-y-4">
      <button aria-label="Back" onClick={() => router.back()} className="flex h-11 w-11 items-center">
        <ArrowLeft size={22} />
      </button>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {a && (
        <>
          <div>
            <h1 className="text-2xl font-bold text-surface-900">{a.name}</h1>
            <p className="text-surface-600">
              {[typeLabel(a.type), a.specialty, parent].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="card space-y-2 text-sm text-surface-700">
            {a.area_name && (
              <div className="flex items-center gap-2">
                <MapPin size={16} /> {a.area_name}
                {a.address ? ` · ${a.address}` : ""}
              </div>
            )}
            {a.phone && (
              <a href={`tel:${a.phone}`} className="flex min-h-[44px] items-center gap-2 text-pharma-800">
                <Phone size={16} /> {a.phone}
              </a>
            )}
            <div>{lastSeen(a.last_visited_at)}</div>
            <div>Visit every {a.cadence_days ?? a.visit_every_days ?? "–"} days</div>
          </div>
          <Link href={`/visit/${a.id}`} className="btn-primary flex items-center justify-center">
            Log visit
          </Link>
          <section className="space-y-2">
            <h2 className="label">Recent visits</h2>
            {visits.length === 0 && <p className="text-surface-500">No visits yet.</p>}
            {visits.map((v) => (
              <Link key={v.id} href={`/clients/${id}/visits/${v.id}`} className="card flex items-center gap-3 active:bg-surface-50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-semibold text-surface-800">{shortDate(v.visited_at)}</span>
                    <span className={`text-xs font-medium ${v.outcome === "not_available" || v.outcome === "cancelled" ? "text-amber-700" : "text-pharma-700"}`}>
                      {OUTCOME_LABEL[v.outcome]}
                    </span>
                  </div>
                  <div className="truncate text-sm text-surface-600">
                    {v.note || (v.molecules?.length ? v.molecules.join(", ") : "No note")}
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-surface-400" />
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
