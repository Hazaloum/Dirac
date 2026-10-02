"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AccountStatus } from "@/lib/types";
import AccountRow from "@/components/AccountRow";

/** New visit: pick the client, then go straight to the visit screen. */
export default function NewVisitPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AccountStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase()
      .from("account_status")
      .select("*")
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows((data ?? []) as AccountStatus[]);
      });
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (a) => !needle || [a.name, a.specialty, a.area_name].some((v) => v?.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Back" onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-2xl font-bold text-surface-900">New visit</h1>
      </div>

      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          autoFocus
          className="field !pl-11"
          placeholder="Who are you visiting?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="text-surface-500">Loading…</p>}
      {rows && shown.length === 0 && <p className="text-center text-surface-500">No clients found.</p>}
      <div className="space-y-3">
        {shown.map((a) => (
          <AccountRow key={a.id} a={a} href={`/visit/${a.id}`} />
        ))}
      </div>

      <Link href="/clients/new" className="flex min-h-[48px] items-center justify-center gap-1 text-sm font-semibold text-pharma-800">
        <Plus size={16} /> New client not in the list
      </Link>
    </div>
  );
}
