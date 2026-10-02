"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AccountStatus } from "@/lib/types";
import { addDays, today, ymd } from "@/lib/format";
import AccountRow from "@/components/AccountRow";

export default function TodayPage() {
  const [rows, setRows] = useState<AccountStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const t = today();

  useEffect(() => {
    supabase()
      .from("account_status")
      .select("*")
      .not("due_on", "is", null)
      .lte("due_on", ymd(addDays(new Date(), 7)))
      .order("due_on", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRows((data ?? []) as AccountStatus[]);
      });
  }, []);

  const due = (rows ?? []).filter((a) => a.due_on! <= t);
  const upcoming = (rows ?? []).filter((a) => a.due_on! > t);
  const dateText = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-4">
      <header>
        <p className="text-sm text-surface-600">{dateText}</p>
        <h1 className="text-2xl font-bold text-surface-900">
          {rows ? `${due.length} ${due.length === 1 ? "visit" : "visits"} due` : "Today"}
        </h1>
      </header>

      <Link href="/accounts" className="btn-primary flex items-center justify-center">
        Unplanned visit
      </Link>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="text-surface-500">Loading…</p>}
      {rows && due.length === 0 && (
        <p className="card text-center text-surface-600">Nothing due today. Nice work.</p>
      )}

      <div className="space-y-3">
        {due.map((a) => (
          <AccountRow key={a.id} a={a} href={`/visit/${a.id}`} overdue={a.due_on! < t} />
        ))}
      </div>

      {upcoming.length > 0 && (
        <section>
          <button
            className="flex min-h-[48px] w-full items-center justify-between text-sm font-semibold text-surface-700"
            onClick={() => setShowUpcoming((v) => !v)}
          >
            <span>Coming up ({upcoming.length})</span>
            <ChevronDown size={18} className={showUpcoming ? "rotate-180" : ""} />
          </button>
          {showUpcoming && (
            <div className="space-y-3">
              {upcoming.map((a) => (
                <AccountRow key={a.id} a={a} href={`/visit/${a.id}`} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
