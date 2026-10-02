"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AccountStatus, AccountType } from "@/lib/types";
import AccountRow from "@/components/AccountRow";

const FILTERS: { v: AccountType | "all"; label: string }[] = [
  { v: "all", label: "All" },
  { v: "doctor", label: "Doctors" },
  { v: "pharmacy", label: "Pharmacies" },
  { v: "hospital", label: "Hospitals" },
];

export default function ClientsPage() {
  const [rows, setRows] = useState<AccountStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<AccountType | "all">("all");

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
      (a) =>
        (type === "all" || a.type === type) &&
        (!needle || [a.name, a.specialty, a.area_name].some((v) => v?.toLowerCase().includes(needle))),
    );
  }, [rows, q, type]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-surface-900">Clients</h1>
        <Link
          href="/clients/new"
          className="flex min-h-[44px] items-center gap-1 rounded-full bg-pharma-900 px-4 text-sm font-semibold text-white"
        >
          <Plus size={16} /> Add client
        </Link>
      </div>

      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-surface-400" />
        <input
          className="field !pl-11"
          placeholder="Search name, specialty, area"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            className={`chip shrink-0 ${type === f.v ? "chip-on" : ""}`}
            onClick={() => setType(f.v)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="text-surface-500">Loading…</p>}
      {rows && shown.length === 0 && <p className="text-center text-surface-500">No clients found.</p>}
      <div className="space-y-3">
        {shown.map((a) => (
          <AccountRow key={a.id} a={a} href={`/clients/${a.id}`} />
        ))}
      </div>
    </div>
  );
}
