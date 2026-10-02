"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { OUTCOME_LABEL, REASONS, STANCES, type Outcome, type Reason, type ShelfStatus, type Stance } from "@/lib/types";
import { shortDate, shortTime } from "@/lib/format";

interface VisitDetail {
  id: number;
  visited_at: string;
  outcome: Outcome;
  molecules: string[] | null;
  note: string | null;
  next_visit_on: string | null;
  accounts: { name: string } | null;
  visit_feedback: { molecule: string; stance: Stance; reason: Reason | null }[];
  sample_drops: { sku_label: string; quantity: number; batch: string | null }[];
  shelf_checks: { sku_label: string; status: ShelfStatus }[];
  orders: { status: string; order_lines: { sku_label: string; quantity: number }[] }[];
  visit_voice_notes: { transcript: string } | { transcript: string }[] | null;
}

const STANCE_STYLE: Record<Stance, string> = {
  prescribing: "bg-green-100 text-green-800",
  will_try: "bg-amber-100 text-amber-800",
  not_interested: "bg-red-100 text-red-800",
};
const SHELF_STYLE: Record<ShelfStatus, string> = {
  in: "bg-green-100 text-green-800",
  low: "bg-amber-100 text-amber-800",
  out: "bg-red-100 text-red-800",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <span className="label">{title}</span>
      <div className="card divide-y divide-surface-100 !py-1">{children}</div>
    </section>
  );
}

function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-surface-800">{left}</span>
      <span className="shrink-0 text-right">{right}</span>
    </div>
  );
}

export default function VisitDetailPage() {
  const { visitId } = useParams<{ id: string; visitId: string }>();
  const router = useRouter();
  const [v, setV] = useState<VisitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase()
      .from("visits")
      .select(
        "id, visited_at, outcome, molecules, note, next_visit_on, accounts(name), visit_feedback(molecule, stance, reason), sample_drops(sku_label, quantity, batch), shelf_checks(sku_label, status), orders(status, order_lines(sku_label, quantity)), visit_voice_notes(transcript)",
      )
      .eq("id", visitId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else if (!data) setError("Visit not found.");
        else setV(data as unknown as VisitDetail);
      });
  }, [visitId]);

  const stance = (s: Stance) => STANCES.find((x) => x.v === s)?.label ?? s;
  const reason = (r: Reason) => REASONS.find((x) => x.v === r)?.label ?? r;

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!v) return <p className="text-surface-500">Loading…</p>;

  const reached = v.outcome !== "not_available" && v.outcome !== "cancelled";
  const feedbackFor = new Map(v.visit_feedback.map((f) => [f.molecule, f]));
  const discussed = Array.from(new Set([...(v.molecules ?? []), ...v.visit_feedback.map((f) => f.molecule)]));
  const orderLines = v.orders.flatMap((o) => o.order_lines);
  const voice = Array.isArray(v.visit_voice_notes) ? v.visit_voice_notes[0] : v.visit_voice_notes;

  return (
    <div className="space-y-5">
      <div>
        <button aria-label="Back" onClick={() => router.back()} className="flex h-11 w-11 items-center">
          <ArrowLeft size={22} />
        </button>
        <p className="text-sm text-surface-600">{v.accounts?.name}</p>
        <h1 className="text-2xl font-bold text-surface-900">
          {new Date(v.visited_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm">
          <span className="text-surface-600">{shortTime(v.visited_at)}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${reached ? "bg-pharma-50 text-pharma-900" : "bg-amber-100 text-amber-800"}`}>
            {OUTCOME_LABEL[v.outcome]}
          </span>
        </p>
      </div>

      {discussed.length > 0 && (
        <Section title="Discussed">
          {discussed.map((m) => {
            const f = feedbackFor.get(m);
            return (
              <Row
                key={m}
                left={<span className="font-medium">{m}</span>}
                right={
                  f ? (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STANCE_STYLE[f.stance]}`}>
                      {stance(f.stance)}
                      {f.reason ? ` · ${reason(f.reason)}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-surface-400">No stance</span>
                  )
                }
              />
            );
          })}
        </Section>
      )}

      {v.sample_drops.length > 0 && (
        <Section title="Samples">
          {v.sample_drops.map((s, i) => (
            <Row
              key={i}
              left={
                <>
                  {s.sku_label}
                  {s.batch && <span className="block text-xs text-surface-500">Batch {s.batch}</span>}
                </>
              }
              right={<span className="font-semibold">× {s.quantity}</span>}
            />
          ))}
        </Section>
      )}

      {v.shelf_checks.length > 0 && (
        <Section title="Shelf check">
          {v.shelf_checks.map((s, i) => (
            <Row
              key={i}
              left={s.sku_label}
              right={<span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${SHELF_STYLE[s.status]}`}>{s.status}</span>}
            />
          ))}
        </Section>
      )}

      {orderLines.length > 0 && (
        <Section title="Order">
          {orderLines.map((l, i) => (
            <Row key={i} left={l.sku_label} right={<span className="font-semibold">{l.quantity} packs</span>} />
          ))}
        </Section>
      )}

      <section>
        <span className="label">Note</span>
        <p className="card whitespace-pre-wrap text-sm text-surface-800">{v.note || <span className="text-surface-400">No note</span>}</p>
      </section>

      {v.next_visit_on && (
        <p className="text-sm text-surface-600">
          Next visit planned for <span className="font-semibold text-surface-900">{shortDate(v.next_visit_on)}</span>
        </p>
      )}

      {voice?.transcript && (
        <section>
          <span className="label">Voice note</span>
          <p className="card whitespace-pre-wrap text-sm italic text-surface-700">“{voice.transcript}”</p>
        </section>
      )}
    </div>
  );
}
